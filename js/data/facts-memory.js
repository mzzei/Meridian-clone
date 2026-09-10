/* js/data/facts-memory.js — memória local de fatos básicos (por time + liga)
 *
 * Economia de web_search: reutiliza técnico/xG/etc. JÁ coletados nesta app.
 * NÃO é memória de treino do modelo.
 *
 * Invariante de skip (code-review ultra):
 *   dimensões de TIME (técnico, escalação, …) só entram em "coberto"
 *   se TODOS os times do confronto tiverem entrada fresca.
 *   Sem times parseados → NUNCA skip de dimensão de time (fail-safe).
 */
const FACTS_MEM_STORE = 'meridian_facts_mem_v1';

/** TTLs por dimensão (ms). */
const FACTS_MEM_TTL = {
  tabela: 6 * 60 * 60 * 1000,
  resultados: 2 * 60 * 60 * 1000,
  forma: 4 * 60 * 60 * 1000,
  tecnico: 24 * 60 * 60 * 1000,
  ranking: 6 * 60 * 60 * 1000,
  xg: 12 * 60 * 60 * 1000,
  estilo: 24 * 60 * 60 * 1000,
  escanteios: 12 * 60 * 60 * 1000,
  escalacao: 3 * 60 * 60 * 1000,
  desfalques: 3 * 60 * 60 * 1000,
  /** trechos reais de API (não placeholder) — liga */
  api_tabela: 6 * 60 * 60 * 1000,
  api_resultados: 2 * 60 * 60 * 1000,
};

const FACTS_MEM_TEAM_DIMS = [
  'tecnico',
  'xg',
  'estilo',
  'escanteios',
  'escalacao',
  'desfalques',
  'ranking',
  'resultados',
  'forma',
];
const FACTS_MEM_LEAGUE_DIMS = ['tabela', 'api_tabela', 'api_resultados'];

function _fmNow() {
  return Date.now();
}

function _fmNormEntity(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function _fmLoad() {
  try {
    return JSON.parse(localStorage.getItem(FACTS_MEM_STORE) || '{}') || {};
  } catch {
    return {};
  }
}

function _fmSave(db) {
  try {
    localStorage.setItem(FACTS_MEM_STORE, JSON.stringify(db));
  } catch { globalThis.meridianFail?.('facts-mem-write'); } // memória que não persiste deixa rastro
}

function _fmKey(compId, dim, entity) {
  return [compId || 'brsa', dim, _fmNormEntity(entity) || '_liga'].join('::');
}

function factsMemGet(compId, dim, entity) {
  const db = _fmLoad();
  const k = _fmKey(compId, dim, entity);
  const e = db[k];
  if (!e || e.v == null || e.v === '') return null;
  const ttl = FACTS_MEM_TTL[dim] || 6 * 60 * 60 * 1000;
  if (_fmNow() - (e.ts || 0) > ttl) return null;
  return e.v;
}

function factsMemIsFresh(compId, dim, entity) {
  return factsMemGet(compId, dim, entity) != null;
}

function factsMemSet(compId, dim, value, entity) {
  if (value == null || value === '') return;
  // rejeita placeholders legados / vazios
  const v = typeof value === 'string' ? value.trim() : value;
  if (v === 'presente_no_bloco_estruturado') return;
  const db = _fmLoad();
  const k = _fmKey(compId, dim, entity);
  db[k] = {
    ts: _fmNow(),
    v: v,
    dim: dim,
    label: String(entity || '_liga').trim() || '_liga',
  };
  const week = 7 * 24 * 60 * 60 * 1000;
  const now = _fmNow();
  Object.keys(db).forEach((key) => {
    if (now - (db[key].ts || 0) > week) delete db[key];
  });
  _fmSave(db);
}

/** Resolve entrada fresca por nome de time (match normalizado / includes). */
function factsMemGetForTeam(compId, dim, teamName) {
  const direct = factsMemGet(compId, dim, teamName);
  if (direct != null) return direct;
  const want = _fmNormEntity(teamName);
  if (!want || want.length < 2) return null;
  const db = _fmLoad();
  const prefix = (compId || 'brsa') + '::' + dim + '::';
  const now = _fmNow();
  const ttl = FACTS_MEM_TTL[dim] || 6 * 60 * 60 * 1000;
  let best = null;
  Object.keys(db).forEach((k) => {
    if (!k.startsWith(prefix)) return;
    const e = db[k];
    if (!e || now - (e.ts || 0) > ttl) return;
    const ent = k.slice(prefix.length);
    if (ent === want || ent.includes(want) || want.includes(ent)) {
      best = e.v;
    }
  });
  return best;
}

function factsMemTeamHas(compId, dim, teamName) {
  return factsMemGetForTeam(compId, dim, teamName) != null;
}

/**
 * Dimensões cobertas COM segurança:
 * - liga: hasStructured (API real nesta run) OU api_* fresco
 * - time: TODOS os teams[] têm a dim fresca; se teams vazio → nenhuma dim de time
 */
function factsMemCoveredDims(compId, hasStructured, teams) {
  const covered = new Set();
  const teamList = Array.isArray(teams) ? teams.filter((t) => String(t || '').trim()) : [];

  // (review local): hasStructured era um booleano ÚNICO ("veio ALGUM bloco") e
  // cobria tabela E resultados/forma de uma vez — com só a CLASSIFICAÇÃO na mão, resultados
  // e forma eram marcados como cobertos, as buscas eram puladas E o prompt ainda mandava o
  // modelo confiar nos "DADOS DA API" que nunca chegaram. Agora, quando o chamador passa o
  // TEXTO estruturado, a cobertura é por marcador de bloco. Booleano segue aceito (legado).
  const _hasDim = (dim) => {
    if (typeof hasStructured !== 'string') return !!hasStructured;
    return dim === 'tabela'
      ? /===\s*CLASSIFICAÇÃO/i.test(hasStructured)
      : /===\s*RESULTADOS/i.test(hasStructured);
  };
  if (_hasDim('tabela') || factsMemIsFresh(compId, 'api_tabela', '_liga')) {
    covered.add('tabela');
  }
  if (_hasDim('resultados') || factsMemIsFresh(compId, 'api_resultados', '_liga')) {
    covered.add('resultados');
    covered.add('forma');
  }

  if (teamList.length >= 2) {
    FACTS_MEM_TEAM_DIMS.forEach((d) => {
      if (teamList.every((t) => factsMemTeamHas(compId, d, t))) covered.add(d);
    });
  }
  return covered;
}

/**
 * Bloco MEMÓRIA LOCAL focado nos times do jogo (+ fatos de liga).
 * Nunca re-injeta structured_blob inteiro (evita eco circular).
 */
function factsMemBuildKnownBlock(compId, teams) {
  const teamList = Array.isArray(teams) ? teams.filter(Boolean) : [];
  const L = [];
  const push = (dim, who, val, ageMin) => {
    if (val == null || val === '') return;
    const s = typeof val === 'string' ? val : JSON.stringify(val);
    L.push('[' + dim + ' · ' + who + (ageMin != null ? ' · ~' + ageMin + 'min' : '') + '] ' + String(s).slice(0, 350));
  };

  // liga
  ['api_tabela', 'api_resultados', 'tabela'].forEach((dim) => {
    const v = factsMemGet(compId, dim, '_liga');
    if (v) push(dim, 'liga', v, null);
  });

  // times do confronto
  teamList.forEach((team) => {
    FACTS_MEM_TEAM_DIMS.forEach((dim) => {
      const v = factsMemGetForTeam(compId, dim, team);
      if (v != null) push(dim, team, v, null);
    });
  });

  if (!L.length) return '';
  return (
    '=== MEMÓRIA LOCAL (fatos já coletados NESTA app p/ estes times — NÃO é memória de treino; reutilize; só busque lacunas/atualizações) ===\n' +
    L.slice(0, 40).join('\n')
  );
}

/**
 * Filtra tópicos de web_search.
 * @param {string[]} topics
 * @param {string} compId
 * @param {boolean} hasStructured
 * @param {string[]} [teams]
 */
function factsMemFilterTopics(topics, compId, hasStructured, teams) {
  const covered = factsMemCoveredDims(compId, hasStructured, teams);
  const skipped = [];
  const kept = [];

  (topics || []).forEach((t) => {
    const low = String(t).toLowerCase();
    let drop = false;

    // tópico só de classificação (sem técnico/lesões/xG)
    if (
      covered.has('tabela') &&
      covered.has('resultados') &&
      /classifica[cç][aã]o|tabela estat/i.test(low) &&
      !/t[eé]cnico|les[oõ]es|escala[cç]|xg|desfalque|vulnerab/i.test(low)
    ) {
      drop = true;
      skipped.push('tabela');
    }

    // tópico de técnico/escalação/desfalques: só drop se os 3 dims cobertos p/ AMBOS os times
    if (
      covered.has('tecnico') &&
      covered.has('escalacao') &&
      covered.has('desfalques') &&
      /t[eé]cnico|escala[cç]|desfalque|les[oõ]es|suspens/i.test(low) &&
      !/xg|expected|fbref|vulnerab/i.test(low)
    ) {
      drop = true;
      skipped.push('tecnico/escalacao/desfalques');
    }

    // tópico puro de xG/estilo
    if (
      covered.has('xg') &&
      covered.has('estilo') &&
      /xg|expected goals|estilo t[aá]tico/i.test(low) &&
      !/les[oõ]es|escala|t[eé]cnico/i.test(low)
    ) {
      drop = true;
      skipped.push('xg/estilo');
    }

    if (!drop) kept.push(t);
  });

  // fail-safe: nunca zerar buscas
  if (!kept.length && topics && topics.length) {
    kept.push(
      '"[Mandante] [Visitante] atualizações de última hora lesões escalação" — Sofascore, imprensa (memória local cobriu o resto — só lacunas)'
    );
  }

  return {
    topics: kept,
    skippedDims: [...new Set(skipped)],
    coveredDims: [...covered],
    maxUsesHint: Math.max(1, kept.length),
  };
}

/**
 * Ingere texto de APIs estruturadas (SEM bloco de memória).
 * Guarda trechos reais, não flags booleanas.
 */
function factsMemIngestStructured(compId, apiText) {
  if (!apiText || !String(apiText).trim()) return;
  const text = String(apiText);
  // não ingerir se o caller passou memória por engano
  if (/===\s*MEMÓRIA LOCAL/i.test(text) && text.length < 500) return;

  if (/classifica|standings|Pts:|pontos/i.test(text)) {
    const snip = text
      .split('\n')
      .filter((l) => /pts:|pontos|classifica|standings|\d+\.\s/i.test(l))
      .slice(0, 25)
      .join('\n')
      .slice(0, 2000);
    if (snip) factsMemSet(compId, 'api_tabela', snip, '_liga');
  }
  if (/\d+\s*[xX\-–]\s*\d+|resultado|confirmados|scoreboard/i.test(text)) {
    const snip = text
      .split('\n')
      .filter((l) => /\d+\s*[xX\-–]\s*\d+|·.*x\s/i.test(l))
      .slice(0, 25)
      .join('\n')
      .slice(0, 2000);
    if (snip) factsMemSet(compId, 'api_resultados', snip, '_liga');
  }
}

/** Após Fase 1: grava fatos por time (entidade = nome do clube). */
function factsMemIngestRawFacts(compId, rawFacts) {
  if (!rawFacts || typeof rawFacts !== 'object') return;
  const saveTeam = (tm) => {
    if (!tm || !tm.nome) return;
    const ent = String(tm.nome).trim();
    if (tm.tecnico) factsMemSet(compId, 'tecnico', String(tm.tecnico), ent);
    if (tm.ranking_fifa) factsMemSet(compId, 'ranking', String(tm.ranking_fifa), ent);
    if (tm.xg_marcado != null || tm.xg_sofrido != null) {
      factsMemSet(
        compId,
        'xg',
        'marc=' + (tm.xg_marcado ?? '?') + ' sofr=' + (tm.xg_sofrido ?? '?'),
        ent
      );
    }
    if (tm.estilo_ofensivo) factsMemSet(compId, 'estilo', String(tm.estilo_ofensivo), ent);
    if (tm.escanteios_por_jogo != null) {
      factsMemSet(
        compId,
        'escanteios',
        'fav=' + tm.escanteios_por_jogo + ' sof=' + (tm.escanteios_sofridos_por_jogo ?? '?'),
        ent
      );
    }
    if (tm.escalacao_provavel || (Array.isArray(tm.onze_provavel) && tm.onze_provavel.length)) {
      const esc =
        tm.escalacao_provavel ||
        (tm.onze_provavel || [])
          .map((p) => (p && p.nome) || '')
          .filter(Boolean)
          .join(', ');
      if (esc) factsMemSet(compId, 'escalacao', String(esc).slice(0, 500), ent);
    }
    if (Array.isArray(tm.desfalques) && tm.desfalques.length) {
      factsMemSet(compId, 'desfalques', tm.desfalques.join(', ').slice(0, 400), ent);
    }
    if (Array.isArray(tm.resultados_recentes) && tm.resultados_recentes.length) {
      const js = JSON.stringify(tm.resultados_recentes).slice(0, 600);
      factsMemSet(compId, 'resultados', js, ent);
      factsMemSet(compId, 'forma', js.slice(0, 400), ent);
    }
  };
  saveTeam(rawFacts.mandante);
  saveTeam(rawFacts.visitante);
  if (rawFacts.grupo_classificacao) {
    factsMemSet(compId, 'tabela', String(rawFacts.grupo_classificacao).slice(0, 400), '_liga');
  }
}

function factsMemClear(compId) {
  if (!compId) {
    try {
      localStorage.removeItem(FACTS_MEM_STORE);
    } catch {}
    return;
  }
  const db = _fmLoad();
  const prefix = compId + '::';
  Object.keys(db).forEach((k) => {
    if (k.startsWith(prefix)) delete db[k];
  });
  _fmSave(db);
}

function factsMemListFresh(compId) {
  const db = _fmLoad();
  const prefix = (compId || 'brsa') + '::';
  const now = _fmNow();
  const out = [];
  Object.keys(db).forEach((k) => {
    if (!k.startsWith(prefix)) return;
    const e = db[k];
    if (!e) return;
    const dim = e.dim || k.split('::')[1];
    const ttl = FACTS_MEM_TTL[dim] || 6 * 60 * 60 * 1000;
    if (now - (e.ts || 0) > ttl) return;
    out.push({
      dim,
      entity: e.label || k.split('::')[2] || '_liga',
      value: e.v,
      ageMin: Math.round((now - e.ts) / 60000),
    });
  });
  return out;
}

function factsMemStats(compId) {
  const rows = factsMemListFresh(compId);
  return { count: rows.length, dims: [...new Set(rows.map((r) => r.dim))], rows: rows.slice(0, 30) };
}
