/* js/data/source-telemetry.js — anti-fantasma: só fontes ATIVAS no raciocínio
 *
 * Princípio: o agente recebe UMA linha limpa do que REALMENTE entrou no contexto
 * e o benefício de cada uma. Fontes vazias NÃO viram lacuna, NÃO poluem o prompt.
 *
 * Telemetria (UI/debug): globalThis._phase1Telemetry + lastPhase1SourcesHuman().
 */

const SOURCE_META = {
  af: { label: 'API-Football', role: 'cascata' },
  af_b: { label: 'API-Football (técnico/escalação)', role: 'pré-jogo' },
  fd: { label: 'football-data.org', role: 'cascata' },
  espn: { label: 'ESPN', role: 'base ao vivo' },
  tsdb: { label: 'TheSportsDB', role: 'validação cruzada' },
  openfootball: { label: 'OpenFootball', role: 'calendário/placares' },
  scorebat: { label: 'Scorebat', role: 'highlights recentes' },
  openliga: { label: 'OpenLigaDB', role: 'tabela DE' },
  fpl: { label: 'FPL oficial', role: 'métricas de jogador EPL' },
  statsbomb: { label: 'StatsBomb Open', role: 'histórico (temporada passada)' },
  memory: { label: 'Memória local', role: 'fatos já coletados nesta app' },
};

const _COV_PT = { high: 'alta', medium: 'média', low: 'baixa' };
const _COV_SCORE = { high: 3, medium: 2, low: 1 };

/** Benefícios detectados no texto (só o que o bloco realmente contém). */
function detectSourceBenefits(text) {
  const t = String(text || '');
  const b = [];
  if (/classifica|standings|Pts:|pontos/i.test(t)) b.push('classificação');
  if (/\d+\s*[xX\-–]\s*\d+|resultado|confirmados|scoreboard/i.test(t)) b.push('resultados');
  if (/pr[oó]xim/i.test(t)) b.push('próximos jogos');
  if (/ao vivo|LIVE/i.test(t)) b.push('ao vivo');
  if (/highlight/i.test(t)) b.push('highlights');
  if (/calend[aá]rio|OpenFootball/i.test(t) && !b.includes('resultados')) b.push('calendário');
  if (/MEMÓRIA LOCAL|t[eé]cnico/i.test(t) && /MEMÓRIA/i.test(t)) b.push('técnico/forma cache');
  if (/TÉCNICOS ATUAIS|API-Football · confirmado/i.test(t)) b.push('técnico API');
  if (/ESCALAÇÕES CONFIRMADAS/i.test(t)) b.push('escalação API');
  if (/MÉTRICAS DE JOGADOR|xG \d|expected goals/i.test(t)) b.push('métricas de jogador');
  if (/HISTÓRICO \(StatsBomb/i.test(t)) b.push('histórico de temporada passada');
  if (!b.length && t.trim().length > 40) b.push('contexto estruturado');
  return b;
}

/**
 * Score de cobertura A/B/C da coleta estruturada (antes do web_search).
 * A = campeonato (tabela/jogos) · B = time (técnico/escalação) · C = analítico (xG/métricas)
 * Orienta o agente: onde confiar e onde gastar busca — sem inventar lacunas fantasma.
 *
 * @param {{active?:array, apiText?:string, memoryText?:string, afMeta?:object}} opts
 */
function computeCoverageScore(opts) {
  opts = opts || {};
  const active = opts.active || [];
  const blob = [opts.apiText || '', opts.memoryText || '', opts.afText || '']
    .join('\n')
    .toLowerCase();
  const benefits = new Set();
  active.forEach((a) => (a.benefits || []).forEach((b) => benefits.add(String(b).toLowerCase())));

  const hasTable =
    benefits.has('classificação') ||
    /classifica|standings|pts:/.test(blob);
  const hasGames =
    benefits.has('resultados') ||
    benefits.has('próximos jogos') ||
    benefits.has('ao vivo') ||
    /\d+\s*[x\-–]\s*\d+/.test(blob) ||
    /pr[oó]xim/.test(blob);

  let aLevel = 'low';
  let aDetail = 'sem tabela/jogos estruturados — busque classificação se precisar';
  if (hasTable && hasGames) {
    aLevel = 'high';
    aDetail = 'classificação + jogos/próximos nos blocos ativos';
  } else if (hasTable || hasGames) {
    aLevel = 'medium';
    aDetail = hasTable ? 'classificação ok; jogos parciais' : 'jogos ok; tabela parcial';
  }

  const af = opts.afMeta || {};
  const hasCoach =
    !!af.coaches ||
    benefits.has('técnico api') ||
    /t[eé]cnicos atuais \(api-football/.test(blob) ||
    (/tecnico|t[eé]cnico/.test(blob) && /mem[oó]ria local|api-football/.test(blob));
  const hasLu =
    !!af.lineups ||
    benefits.has('escalação api') ||
    /escala[cç][oõ]es confirmadas/.test(blob);

  let bLevel = 'low';
  let bDetail = 'técnico/escalação ainda dependem de web_search';
  if (hasCoach && hasLu) {
    bLevel = 'high';
    bDetail = 'técnico + escalação confirmados (API)';
  } else if (hasCoach) {
    bLevel = 'medium';
    bDetail = 'técnico OK; escalação/desfalques via busca se faltarem';
  } else if (hasLu) {
    bLevel = 'medium';
    bDetail = 'escalação OK; técnico via busca se faltar';
  }

  let cLevel = 'low';
  let cDetail = 'xG e métricas de jogador: priorize web_search (Sofascore/FBref)';
  if (
    benefits.has('métricas de jogador') ||
    /xg|expected goals|finaliza[cç]|rating/.test(blob)
  ) {
    cLevel = 'medium';
    cDetail = 'há sinais analíticos no contexto; complete com busca se incompleto';
  }

  const avg =
    (_COV_SCORE[aLevel] + _COV_SCORE[bLevel] + _COV_SCORE[cLevel]) / 3;
  const overall = avg >= 2.5 ? 'alta' : avg >= 1.7 ? 'média' : 'baixa';

  const coverage = {
    A: { level: aLevel, label: 'Campeonato', detail: aDetail },
    B: { level: bLevel, label: 'Time / pré-jogo', detail: bDetail },
    C: { level: cLevel, label: 'Analítico', detail: cDetail },
    overall,
    summaryHuman:
      'Cobertura: A ' +
      _COV_PT[aLevel] +
      ' · B ' +
      _COV_PT[bLevel] +
      ' · C ' +
      _COV_PT[cLevel],
    afMeta: af,
  };
  coverage.agentBlock = buildCoverageAgentBlock(coverage);
  return coverage;
}

/** Bloco para o agente: orquestra busca com benefício, sem lacunas fantasma. */
function buildCoverageAgentBlock(cov) {
  if (!cov || !cov.A) return '';
  const row = (key) => {
    const x = cov[key];
    return (
      '• ' +
      key +
      ' ' +
      x.label +
      ': ' +
      _COV_PT[x.level].toUpperCase() +
      ' — ' +
      x.detail
    );
  };
  return [
    '=== COBERTURA DE DADOS (oriente a busca; confie no que está ALTA/MÉDIA nos blocos) ===',
    row('A'),
    row('B'),
    row('C'),
    'Regra: se A alta, NÃO gaste busca em tabela/forma. Se B alta, NÃO re-busque técnico/onze. Use web_search no que estiver BAIXA (tipicamente C e partes de B).',
  ].join('\n');
}

/** Níveis B/C observáveis nos rawFacts (produto da Fase 1 já com web_search). */
function coverageLevelsFromRawFacts(rawFacts) {
  const teams = [rawFacts && rawFacts.mandante, rawFacts && rawFacts.visitante].filter(Boolean);
  if (!teams.length) return { B: 'low', C: 'low' };
  const hasVal = (v) => v !== null && v !== undefined && v !== '';
  const teamXg = (t) => hasVal(t.xg_marcado) || hasVal(t.xg_sofrido);
  const hasXg = teams.some(teamXg);
  const bothXg = teams.length === 2 && teams.every(teamXg);
  const hasPlayerStats = teams.some((t) =>
    (Array.isArray(t.jogadores_chave) ? t.jogadores_chave : []).some(
      (p) =>
        p &&
        typeof p === 'object' &&
        (hasVal(p.rating_medio) || hasVal(p.gols) || hasVal(p.finalizacoes_por_jogo))
    )
  );
  let C = 'low';
  if (bothXg && hasPlayerStats) C = 'high';
  else if (hasXg || hasPlayerStats) C = 'medium';

  const coaches =
    teams.length === 2 && teams.every((t) => hasVal(t.tecnico) && String(t.tecnico).trim());
  const lineup = teams.some(
    (t) =>
      (Array.isArray(t.onze_provavel) &&
        t.onze_provavel.filter((p) => (typeof p === 'string' ? p.trim() : p && hasVal(p.nome)))
          .length >= 7) ||
      (hasVal(t.escalacao_provavel) && String(t.escalacao_provavel).trim().length > 20)
  );
  let B = 'low';
  if (coaches && lineup) B = 'high';
  else if (coaches || lineup) B = 'medium';
  return { B, C };
}

/**
 * Score pós-web_search: a busca da Fase 1 pode cobrir o que a coleta estruturada
 * não tinha (xG/métricas → C; técnico/escalação → B). Só SOBE nível, nunca rebaixa
 * (os blocos estruturados continuam valendo) — e re-pinta badge + telemetria para
 * a UI mostrar a cobertura REAL da análise, não só a da coleta.
 */
function updateCoverageAfterSearch(rawFacts) {
  if (!rawFacts || typeof rawFacts !== 'object') return null;
  let prev = null;
  try {
    prev = globalThis._phase1Coverage || null;
  } catch {}
  const base = prev && prev.A ? prev : computeCoverageScore({});
  const post = coverageLevelsFromRawFacts(rawFacts);
  const lift = (cur, next) => (_COV_SCORE[next] > _COV_SCORE[cur] ? next : cur);
  const bLevel = lift(base.B.level, post.B);
  const cLevel = lift(base.C.level, post.C);
  const cov = {
    A: { ...base.A },
    B: { ...base.B, level: bLevel },
    C: { ...base.C, level: cLevel },
    afMeta: base.afMeta || {},
    postSearch: true,
  };
  if (bLevel !== base.B.level) cov.B.detail = 'técnico/escalação obtidos na busca web desta análise';
  if (cLevel !== base.C.level) cov.C.detail = 'xG/métricas obtidos na busca web desta análise';
  const avg = (_COV_SCORE[cov.A.level] + _COV_SCORE[bLevel] + _COV_SCORE[cLevel]) / 3;
  cov.overall = avg >= 2.5 ? 'alta' : avg >= 1.7 ? 'média' : 'baixa';
  cov.summaryHuman =
    'Cobertura (pós-busca): A ' +
    _COV_PT[cov.A.level] +
    ' · B ' +
    _COV_PT[bLevel] +
    ' · C ' +
    _COV_PT[cLevel];
  cov.agentBlock = buildCoverageAgentBlock(cov);
  try {
    globalThis._phase1Coverage = cov;
    if (globalThis._phase1Telemetry) globalThis._phase1Telemetry.coverage = cov;
  } catch {}
  try {
    renderCoverageBadge(cov);
  } catch {}
  try {
    const raw = sessionStorage.getItem('meridian_phase1_sources_v1');
    if (raw) {
      const j = JSON.parse(raw);
      j.coverage = { overall: cov.overall, A: cov.A.level, B: bLevel, C: cLevel, postSearch: true };
      sessionStorage.setItem('meridian_phase1_sources_v1', JSON.stringify(j));
    }
  } catch {}
  return cov;
}

/** Pinta badge de cobertura no dock (anti-fantasma visual). */
function renderCoverageBadge(coverage) {
  const el = document.getElementById('data-coverage');
  if (!el) return;
  if (!coverage || !coverage.A) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const pill = (key) => {
    const x = coverage[key];
    const lv = x.level || 'low';
    return (
      '<span class="cov-pill cov-' +
      lv +
      '" title="' +
      String(x.detail || '').replace(/"/g, '&quot;') +
      '"><b>' +
      key +
      '</b> ' +
      _COV_PT[lv] +
      '</span>'
    );
  };
  el.style.display = 'flex';
  el.innerHTML =
    '<span class="cov-title">Dados</span>' +
    pill('A') +
    pill('B') +
    pill('C') +
    '<span class="cov-overall cov-o-' +
    (coverage.overall === 'alta' ? 'high' : coverage.overall === 'média' ? 'medium' : 'low') +
    '">' +
    coverage.overall +
    '</span>';
}

function hideCoverageBadge() {
  const el = document.getElementById('data-coverage');
  if (el) {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

function sourceLabel(id) {
  return (SOURCE_META[id] && SOURCE_META[id].label) || id;
}

/**
 * Monta linha de raciocínio LIMPA — só ativos com benefício.
 * @param {{id:string,chars:number,benefits?:string[],text?:string}[]} active
 * @returns {string} bloco curto p/ o topo de DADOS DA API (ou '' se nada)
 */
function buildAgentSourceLine(active) {
  const rows = (active || []).filter((a) => a && a.chars > 0);
  if (!rows.length) return '';
  const L = [
    '=== REPERTOIRE ESTRUTURADO ATIVO (use os blocos abaixo; NÃO re-busque o que estas fontes já cobrem; ignore fontes que não estão listadas) ===',
  ];
  rows.forEach((a) => {
    const benefits =
      Array.isArray(a.benefits) && a.benefits.length
        ? a.benefits.join(', ')
        : detectSourceBenefits(a.text || '').join(', ') || 'dados estruturados';
    const role = (SOURCE_META[a.id] && SOURCE_META[a.id].role) || '';
    L.push(
      '• ' +
        sourceLabel(a.id) +
        (role ? ' (' + role + ')' : '') +
        ' — ' +
        benefits +
        ' · ~' +
        a.chars +
        'c'
    );
  });
  return L.join('\n');
}

/** Status humano curto p/ UI (thinking bar). */
function formatSourcesStatusHuman(active) {
  const rows = (active || []).filter((a) => a && a.chars > 0);
  if (!rows.length) return 'Sem fontes estruturadas';
  return (
    'Fontes: ' +
    rows
      .map((a) => sourceLabel(a.id))
      .join(' · ')
  );
}

/**
 * Persiste telemetria da última coleta (anti-fantasma auditável).
 * @param {object} telemetry
 */
function recordPhase1Telemetry(telemetry) {
  const t = telemetry || {};
  const active = Array.isArray(t.active) ? t.active : [];
  const coverage =
    t.coverage ||
    computeCoverageScore({
      active,
      apiText: t.apiText,
      memoryText: t.memoryText,
      afMeta: t.afMeta,
      afText: t.afText,
    });
  const payload = {
    ts: Date.now(),
    compId: t.compId || null,
    cascade: t.cascade || null,
    active: active.map((a) => ({
      id: a.id,
      label: sourceLabel(a.id),
      chars: a.chars || 0,
      benefits: a.benefits || detectSourceBenefits(a.text || ''),
    })),
    // ghosts = tentados e vazios — NÃO vão pro prompt do agente
    silent: Array.isArray(t.silent) ? t.silent : [],
    freeChars: t.freeChars || 0,
    apiChars: t.apiChars || 0,
    memoryChars: t.memoryChars || 0,
    teams: t.teams || [],
    agentLine: t.agentLine || buildAgentSourceLine(active),
    coverage,
  };
  try {
    globalThis._phase1Telemetry = payload;
    globalThis._phase1Coverage = coverage;
  } catch {}
  try {
    renderCoverageBadge(coverage);
  } catch {}
  try {
    sessionStorage.setItem(
      'meridian_phase1_sources_v1',
      JSON.stringify({
        ts: payload.ts,
        compId: payload.compId,
        active: payload.active,
        silent: payload.silent,
        teams: payload.teams,
        coverage: {
          overall: coverage.overall,
          A: coverage.A && coverage.A.level,
          B: coverage.B && coverage.B.level,
          C: coverage.C && coverage.C.level,
        },
      })
    );
  } catch {}
  return payload;
}

function lastPhase1SourcesHuman() {
  try {
    const t = globalThis._phase1Telemetry;
    if (!t) return '';
    return formatSourcesStatusHuman(t.active);
  } catch {
    return '';
  }
}

function getPhase1Telemetry() {
  try {
    return globalThis._phase1Telemetry || null;
  } catch {
    return null;
  }
}

// ── Contador de falhas silenciosas ─────────────────────────────
// O bug de streaming do 129 ficou invisível por MUITOS shells porque morria num
// catch{} vazio. Padrão do app: degradar em silêncio. Este contador é o meio-termo:
// os catches continuam não-fatais, mas cada um soma num mapa por local, exposto no
// painel avançado — "sumiu texto do chat" vira um número que sobe, não um mistério.
// Uso nos catches: globalThis.meridianFail?.('tag') — opcional, nunca lança, nunca loga.
var _failCounts = {};
function meridianFail(tag) {
  try {
    _failCounts[tag] = (_failCounts[tag] || 0) + 1;
    var el = document.getElementById('fail-counters');
    if (el) el.textContent = meridianFailText();
  } catch (_) {}
}
function meridianFailText() {
  var ks = Object.keys(_failCounts).sort();
  if (!ks.length) return 'nenhuma nesta sessão';
  return ks.map(function (k) { return k + ': ' + _failCounts[k]; }).join(' · ');
}
