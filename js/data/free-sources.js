/* js/data/free-sources.js — fontes estruturadas GRÁTIS (registry)
 *
 * Providers independentes da cascata paga FD→ESPN→AF:
 *   1) TheSportsDB (getTsdbContext em espn.js) — multi-liga
 *   2) OpenFootball (GitHub football.json) — calendário/placares
 *   3) Scorebat Free — highlights recentes (filtro estrito por liga)
 *   4) OpenLigaDB — só se COMPETITIONS.openliga estiver mapeado (senão no-op)
 *   5) FPL (Fantasy Premier League) — só EPL + Worker (sem CORS direto); métricas C
 *   6) StatsBomb Open — só modo HISTÓRICO (query nomeia temporada que existe no open-data)
 *
 * Padrão: fetch → parse → texto → orçamento/dedupe → join.
 */
const FREE_SRC_TTL = 20 * 60 * 1000;
const OF_BASE = 'https://raw.githubusercontent.com/openfootball/football.json/master';
const SCOREBAT_URL = 'https://www.scorebat.com/video-api/v1/';
const OPENLIGA_BASE = 'https://api.openligadb.de';
const FPL_TTL = 6 * 60 * 60 * 1000; // bootstrap-static é pesado e muda devagar
const SB_OPEN_BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';
const SB_OPEN_TTL = 7 * 24 * 60 * 60 * 1000; // open-data é estático
/** teto de chars por fonte / total free (input tokens) */
const FREE_CAP_EACH = 3800;
const FREE_CAP_TOTAL = 9000;

function _freeCompId(compId) {
  return compId || (typeof _activeCompId !== 'undefined' ? _activeCompId : 'brsa');
}

function _freeGetComp(id) {
  return typeof getComp === 'function' ? getComp(id) : null;
}

function _freeLabel(id) {
  return typeof compLabel === 'function' ? compLabel(id) : id;
}

async function _freeJson(url, cacheKey, ttl) {
  if (typeof cachedJsonFetch === 'function') {
    return cachedJsonFetch(url, cacheKey, { ttl: ttl || FREE_SRC_TTL, timeout: 9000 });
  }
  // fallback mínimo se cached-fetch não carregou
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function _ofSeasonCandidates(compId) {
  const c = _freeGetComp(compId);
  if (!c || !c.openfootball) return [];
  const stem = c.openfootball;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const out = [];
  if (c.calendar === 'european') {
    const cur = m >= 8 ? y : y - 1;
    out.push(cur + '-' + String(cur + 1).slice(-2) + '/' + stem + '.json');
    out.push(cur - 1 + '-' + String(cur).slice(-2) + '/' + stem + '.json');
  } else {
    out.push(y + '/' + stem + '.json');
    out.push(y - 1 + '/' + stem + '.json');
  }
  return out;
}

/** Dedup linhas de placar por chave home|away|date. */
function _dedupeScoreLines(lines) {
  const seen = new Set();
  const out = [];
  (lines || []).forEach((line) => {
    const k = String(line)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\sx×\-–.]/gi, '')
      .slice(0, 80);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(line);
  });
  return out;
}

async function getOpenFootballContext(compId) {
  const id = _freeCompId(compId);
  const paths = _ofSeasonCandidates(id);
  if (!paths.length) return '';
  let data = null;
  let used = '';
  for (const p of paths) {
    const d = await _freeJson(
      OF_BASE + '/' + p,
      'meridian_of_' + id + '_' + p.replace(/[^\w.-]/g, '_'),
      FREE_SRC_TTL
    );
    if (d && Array.isArray(d.matches) && d.matches.length) {
      data = d;
      used = p;
      break;
    }
  }
  if (!data) return '';
  const today = new Date().toISOString().slice(0, 10);
  const withScore = [];
  const upcoming = [];
  (data.matches || []).forEach((m) => {
    const ft = m.score && m.score.ft;
    const lineBase =
      (m.date || '') +
      ' · ' +
      (m.team1 || '?') +
      (ft ? ' ' + ft[0] + 'x' + ft[1] + ' ' : ' x ') +
      (m.team2 || '?') +
      (m.round ? ' (' + m.round + ')' : '');
    if (ft && ft.length >= 2) withScore.push(lineBase);
    else if ((m.date || '') >= today) upcoming.push(lineBase);
  });
  const L = [
    '=== RESULTADOS / CALENDÁRIO (OpenFootball · ' +
      (data.name || _freeLabel(id)) +
      ' · ' +
      used +
      ') ===',
  ];
  _dedupeScoreLines(withScore.slice(-16)).forEach((x) => L.push(x));
  if (upcoming.length) {
    L.push('--- Próximos (OpenFootball) ---');
    upcoming.slice(0, 10).forEach((x) => L.push(x));
  }
  return L.length > 1 ? L.join('\n') : '';
}

function _scorebatKeys(id) {
  if (typeof scorebatKeys === 'function') return scorebatKeys(id);
  const c = _freeGetComp(id);
  return (c && Array.isArray(c.scorebat) && c.scorebat) || [];
}

function _scorebatMatchComp(item, keys) {
  const name = String((item && item.competition && item.competition.name) || '').toLowerCase();
  if (!name) return false;
  return keys.some((k) => name.includes(String(k).toLowerCase()));
}

/** Scorebat: só hits da competição. Sem fallback de outras ligas. */
async function getScorebatContext(compId) {
  const id = _freeCompId(compId);
  const keys = _scorebatKeys(id);
  if (!keys.length) return '';
  const feed = await _freeJson(SCOREBAT_URL, 'meridian_scorebat_v1', 15 * 60 * 1000);
  if (!Array.isArray(feed) || !feed.length) return '';
  const hits = feed.filter((x) => _scorebatMatchComp(x, keys)).slice(0, 15);
  if (!hits.length) return ''; // vazio honesto — não poluir com PL/Ligue1 no contexto BR
  const L = [
    '=== RESULTADOS RECENTES / HIGHLIGHTS (Scorebat Free · ' + _freeLabel(id) + ') ===',
  ];
  hits.forEach((it) => {
    const comp = (it.competition && it.competition.name) || '';
    const date = (it.date || '').slice(0, 10);
    L.push((date ? date + ' · ' : '') + (it.title || '?') + (comp ? ' [' + comp + ']' : ''));
  });
  return L.join('\n');
}

function _openligaSeasonYear() {
  const d = new Date();
  const m = d.getMonth() + 1;
  return m >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}

/** OpenLigaDB: no-op se openliga não estiver no catálogo (sem teatro). */
async function getOpenLigaContext(compId) {
  const id = _freeCompId(compId);
  const shortcut =
    typeof openligaShortcut === 'function'
      ? openligaShortcut(id)
      : (_freeGetComp(id) && _freeGetComp(id).openliga) || null;
  if (!shortcut) return '';
  const season = _openligaSeasonYear();
  const [table, matches] = await Promise.all([
    _freeJson(
      OPENLIGA_BASE + '/getbltable/' + shortcut + '/' + season,
      'meridian_oldb_tbl_' + shortcut + '_' + season
    ),
    _freeJson(
      OPENLIGA_BASE + '/getmatchdata/' + shortcut + '/' + season,
      'meridian_oldb_md_' + shortcut + '_' + season
    ),
  ]);
  const L = [];
  if (Array.isArray(table) && table.length) {
    L.push(
      '=== CLASSIFICAÇÃO (OpenLigaDB · ' +
        _freeLabel(id) +
        ' · ' +
        shortcut +
        ' ' +
        season +
        ') ==='
    );
    table.slice(0, 18).forEach((t, i) => {
      L.push(
        '  ' +
          (i + 1) +
          '. ' +
          (t.teamName || t.shortName || '?') +
          ' — Pts:' +
          (t.points ?? '?') +
          ' J:' +
          (t.matches ?? '?') +
          ' V:' +
          (t.won ?? '?') +
          ' E:' +
          (t.draw ?? '?') +
          ' D:' +
          (t.lost ?? '?')
      );
    });
  }
  if (Array.isArray(matches) && matches.length) {
    const finished = matches
      .filter((m) => m.matchIsFinished)
      .slice(-12)
      .map((m) => {
        const r =
          (m.matchResults || []).find((x) => x.resultTypeID === 2) ||
          (m.matchResults || [])[0];
        const sc =
          r && r.pointsTeam1 != null ? r.pointsTeam1 + 'x' + r.pointsTeam2 : '—';
        return (
          (m.matchDateTime || '').slice(0, 10) +
          ' · ' +
          (m.team1 && m.team1.teamName) +
          ' ' +
          sc +
          ' ' +
          (m.team2 && m.team2.teamName)
        );
      });
    if (finished.length) {
      L.push('=== RESULTADOS (OpenLigaDB) ===');
      finished.forEach((x) => L.push(x));
    }
  }
  return L.join('\n');
}

// ─── FPL (Fantasy Premier League) — métricas de jogador da EPL (camada C) ────
// API oficial sem chave, mas SEM CORS: só funciona via Worker ({worker}/fpl/*).
// bootstrap-static traz gols, assists, xG/xA, forma, minutos e lesões/dúvidas.
function _fplNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/** Formata bootstrap-static (puro/testável). teams = ['Arsenal','Chelsea'] opcional. */
function _fplFormatContext(data, teams) {
  if (!data || !Array.isArray(data.elements) || !Array.isArray(data.teams)) return '';
  const teamById = {};
  data.teams.forEach((t) => {
    if (t && t.id != null) teamById[t.id] = t.name || t.short_name || '?';
  });
  const wanted = (teams || []).map(_fplNorm).filter(Boolean);
  const matchTeam = (name) => {
    if (!wanted.length) return true;
    const n = _fplNorm(name);
    return wanted.some((w) => n.includes(w) || w.includes(n));
  };
  const els = data.elements.filter(
    (p) => p && (p.minutes || 0) > 0 && matchTeam(teamById[p.team] || '')
  );
  if (!els.length) return '';
  const byTeam = {};
  els.forEach((p) => {
    const tn = teamById[p.team] || '?';
    (byTeam[tn] = byTeam[tn] || []).push(p);
  });
  const L = ['=== MÉTRICAS DE JOGADOR (FPL oficial · Premier League) ==='];
  const teamNames = Object.keys(byTeam);
  // com times do jogo: até 6 jogadores por time; sem times: só líderes da liga
  const capPerTeam = wanted.length ? 6 : 0;
  if (capPerTeam) {
    teamNames.forEach((tn) => {
      const top = byTeam[tn]
        .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
        .slice(0, capPerTeam)
        .map(
          (p) =>
            `${p.web_name} — ${p.goals_scored || 0}g ${p.assists || 0}a · xG ${p.expected_goals || '0'} xA ${p.expected_assists || '0'} · forma ${p.form || '0'} · ${p.minutes || 0}min`
        );
      if (top.length) L.push(tn + ': ' + top.join('; '));
    });
    const flagged = els.filter((p) => ['i', 'd', 's'].includes(p.status) && (p.news || '').trim());
    if (flagged.length) {
      L.push('Lesões/dúvidas (FPL): ' + flagged.slice(0, 8).map((p) => `${p.web_name} (${teamById[p.team] || '?'}): ${p.news}`).join(' · '));
    }
  } else {
    const leaders = els
      .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
      .slice(0, 8)
      .map((p) => `${p.web_name} (${teamById[p.team] || '?'}) — ${p.goals_scored || 0}g ${p.assists || 0}a · xG ${p.expected_goals || '0'}`);
    L.push('Líderes da liga: ' + leaders.join('; '));
  }
  return L.length > 1 ? L.join('\n') : '';
}
/**
 * Enriquecimento leve: element-summary dos 2–3 top pontuadores de cada time do jogo.
 * Só EPL + Worker; cache 6h; máx ~6 fetches (economiza).
 */
async function _fplElementSummaries(workerBase, elements, teamById, teams) {
  const wanted = (teams || []).map(_fplNorm).filter(Boolean);
  if (!wanted.length || !Array.isArray(elements)) return '';
  const byTeam = {};
  elements.forEach((p) => {
    if (!p || !(p.minutes > 0)) return;
    const tn = teamById[p.team] || '';
    const n = _fplNorm(tn);
    if (!wanted.some((w) => n.includes(w) || w.includes(n))) return;
    (byTeam[tn] = byTeam[tn] || []).push(p);
  });
  const picks = [];
  Object.keys(byTeam).forEach((tn) => {
    byTeam[tn]
      .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
      .slice(0, 2)
      .forEach((p) => picks.push(p));
  });
  if (!picks.length) return '';
  const base = workerBase.replace(/\/+$/, '');
  const lines = [];
  // sequencial leve (Worker free); cada summary cacheado
  for (const p of picks.slice(0, 6)) {
    try {
      const sum = await _freeJson(
        base + '/fpl/element-summary/' + p.id + '/',
        'meridian_fpl_el_' + p.id + '_v1',
        FPL_TTL
      );
      const hist = Array.isArray(sum && sum.history) ? sum.history : [];
      const last = hist.slice(-3);
      if (!last.length) continue;
      const bits = last.map((h) => {
        const g = h.goals_scored || 0;
        const a = h.assists || 0;
        const pts = h.total_points || 0;
        const opp = h.was_home ? 'H' : 'A';
        return `GW${h.round || '?'}:${pts}pts ${g}g${a}a ${opp}`;
      });
      lines.push(
        (p.web_name || '?') +
          ' (' +
          (teamById[p.team] || '?') +
          ') últimos GWs: ' +
          bits.join(' · ')
      );
    } catch {}
  }
  if (!lines.length) return '';
  return 'Forma recente (FPL element-summary): ' + lines.join('; ');
}

async function getFplContext(compId, teams) {
  const id = _freeCompId(compId);
  if (id !== 'epl') return '';
  const w = typeof getWorkerUrl === 'function' ? getWorkerUrl() : '';
  if (!w) return ''; // sem Worker não há CORS — silent, nunca lacuna no prompt
  const data = await _freeJson(
    w.replace(/\/+$/, '') + '/fpl/bootstrap-static/',
    'meridian_fpl_bootstrap_v1',
    FPL_TTL
  );
  let text = _fplFormatContext(data, teams);
  if (!text || !data) return text;
  // só enriquece quando há times do jogo (evita 6 fetches em toda análise genérica)
  if (teams && teams.length >= 2) {
    const teamById = {};
    (data.teams || []).forEach((t) => {
      if (t && t.id != null) teamById[t.id] = t.name || t.short_name || '?';
    });
    const extra = await _fplElementSummaries(w, data.elements, teamById, teams);
    if (extra) text = text + '\n' + extra;
  }
  return text;
}

// ─── StatsBomb Open — SÓ modo histórico (não live) ───────────────────────────
// Ativa apenas quando a query nomeia um ano/temporada que EXISTE no open-data da
// competição (ex.: "La Liga 2015"). Nunca entra em análise de temporada atual.
const _SB_OPEN_COMP = { laliga: 'La Liga', epl: 'Premier League', ucl: 'Champions League' };
/** Anos de 4 dígitos citados na query (puro/testável). */
function _sbOpenYearsFromQuery(q) {
  const out = [];
  const re = /\b(19[6-9]\d|20[0-3]\d)\b/g;
  let m;
  while ((m = re.exec(String(q || ''))) !== null) out.push(m[1]);
  return [...new Set(out)];
}
/** Casa anos citados contra season_name do open-data (puro/testável). */
function _sbOpenPickSeason(seasons, years) {
  if (!Array.isArray(seasons) || !years || !years.length) return null;
  for (const y of years) {
    const hit = seasons.find((s) => String((s && s.season_name) || '').includes(y));
    if (hit) return hit;
  }
  return null;
}
async function getStatsbombOpenContext(compId, query) {
  const id = _freeCompId(compId);
  const compName = _SB_OPEN_COMP[id];
  if (!compName) return '';
  const years = _sbOpenYearsFromQuery(query);
  if (!years.length) return ''; // sem temporada citada → não é modo histórico
  const comps = await _freeJson(
    SB_OPEN_BASE + '/competitions.json',
    'meridian_sbopen_comps_v1',
    SB_OPEN_TTL
  );
  if (!Array.isArray(comps)) return '';
  const seasons = comps.filter((c) => c && c.competition_name === compName);
  const season = _sbOpenPickSeason(seasons, years);
  if (!season) return ''; // temporada citada não existe no open-data → silent
  const matches = await _freeJson(
    SB_OPEN_BASE + '/matches/' + season.competition_id + '/' + season.season_id + '.json',
    'meridian_sbopen_m_' + season.competition_id + '_' + season.season_id,
    SB_OPEN_TTL
  );
  if (!Array.isArray(matches) || !matches.length) return '';
  let teams = [];
  try {
    if (typeof parseMatchTeamsFromQuery === 'function') teams = parseMatchTeamsFromQuery(query) || [];
  } catch {}
  const norm = _fplNorm;
  const wanted = teams.map(norm);
  const involves = (m) => {
    if (!wanted.length) return true;
    const h = norm(m.home_team && m.home_team.home_team_name);
    const a = norm(m.away_team && m.away_team.away_team_name);
    return wanted.some((w) => (h && (h.includes(w) || w.includes(h))) || (a && (a.includes(w) || w.includes(a))));
  };
  const rows = matches
    .filter((m) => m && m.home_score != null && involves(m))
    .sort((a, b) => String(a.match_date || '').localeCompare(String(b.match_date || '')))
    .slice(-18)
    .map(
      (m) =>
        `${m.match_date || '?'} · ${m.home_team.home_team_name} ${m.home_score}x${m.away_score} ${m.away_team.away_team_name}` +
        (m.competition_stage && m.competition_stage.name && m.competition_stage.name !== 'Regular Season' ? ` (${m.competition_stage.name})` : '')
    );
  if (!rows.length) return '';
  return [
    `=== HISTÓRICO (StatsBomb Open · ${compName} ${season.season_name}) — dados de TEMPORADA PASSADA; NUNCA use como estado atual de elenco/tabela ===`,
    ...rows,
  ].join('\n');
}

/**
 * Registry de fontes independentes (paralelo) — anti-fantasma.
 * Retorna { text, active[], silent[] }:
 *   active = só quem devolveu texto útil (entra no agente)
 *   silent = tentados e vazios (NÃO vão pro prompt; só telemetria)
 * TSDB vive em espn.js.
 */
async function getFreeSourcesBundle(compId, teams, query) {
  const id = _freeCompId(compId);
  const providers = [
    {
      id: 'tsdb',
      run: () =>
        typeof getTsdbContext === 'function' ? getTsdbContext(id) : Promise.resolve(''),
    },
    { id: 'openfootball', run: () => getOpenFootballContext(id) },
    { id: 'scorebat', run: () => getScorebatContext(id) },
    { id: 'openliga', run: () => getOpenLigaContext(id) },
    { id: 'fpl', run: () => getFplContext(id, teams) },
    { id: 'statsbomb', run: () => getStatsbombOpenContext(id, query) },
  ];
  const settled = await Promise.all(
    providers.map(async (p) => {
      try {
        const text = await p.run();
        const t = text && String(text).trim() ? String(text).trim() : '';
        if (!t) return { id: p.id, ok: false, text: '', chars: 0 };
        return { id: p.id, ok: true, text: t, chars: t.length };
      } catch {
        return { id: p.id, ok: false, text: '', chars: 0 };
      }
    })
  );
  const active = settled
    .filter((r) => r.ok)
    .map((r) => ({
      id: r.id,
      text: r.text,
      chars: r.chars,
      benefits:
        typeof detectSourceBenefits === 'function' ? detectSourceBenefits(r.text) : [],
    }));
  const silent = settled.filter((r) => !r.ok).map((r) => r.id);
  const blocks = active.map((a) => a.text);
  const text =
    typeof joinContextBlocks === 'function'
      ? joinContextBlocks(blocks, { maxTotal: FREE_CAP_TOTAL, maxEach: FREE_CAP_EACH })
      : blocks.join('\n\n').slice(0, FREE_CAP_TOTAL);
  return { text, active, silent };
}

/** Compat: só o texto (quem não precisa de telemetria). */
async function getFreeSourcesContext(compId) {
  const b = await getFreeSourcesBundle(compId);
  return b.text || '';
}

/** Ids ativos (telemetria). */
async function getFreeSourcesMeta(compId) {
  const b = await getFreeSourcesBundle(compId);
  return (b.active || []).map((a) => a.id);
}
