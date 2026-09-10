/* js/data/source-health.js — probe periódico de saúde das fontes
 *
 * INVARIANTE: saúde de fonte é UI/telemetria — NUNCA entra no prompt do agente
 * (anti-fantasma: o agente só vê fontes ATIVAS da coleta real, via REPERTOIRE).
 *
 * O probe usa os MESMOS getters da coleta (com cache TTL), então o custo de rede
 * é baixo e o resultado reflete o que a coleta realmente conseguiria agora.
 * Auto-roda no load (atrasado) + a cada 30 min + botão "Testar fontes" nos settings.
 */
const SOURCE_HEALTH_STORE = 'meridian_source_health_v1';
const SOURCE_HEALTH_INTERVAL = 30 * 60 * 1000;

function _shActiveComp() {
  return typeof _activeCompId !== 'undefined' ? _activeCompId : 'brsa';
}

async function _shProbeOne(id, fn, naNote) {
  if (naNote) return { id, ok: null, ms: 0, note: naNote }; // não aplicável ≠ falha
  const t0 = Date.now();
  try {
    const r = await fn();
    const s = typeof r === 'string' ? r.trim() : '';
    const chars = typeof r === 'string' ? s.length : r ? 1 : 0;
    // mensagem curta (ex.: "75 temporadas no open-data") vale mais que a contagem
    const note = chars > 0 ? (s && chars < 60 && !s.includes('===') ? s : '~' + chars + ' chars') : 'vazio agora';
    return { id, ok: chars > 0, ms: Date.now() - t0, note };
  } catch (e) {
    return { id, ok: false, ms: Date.now() - t0, note: 'erro: ' + ((e && e.message) || '?') };
  }
}

function _shSetStatus(elId, res) {
  const el = document.getElementById(elId);
  if (!el || !res) return;
  el.className = 'ds-status' + (res.ok === true ? ' ok' : res.ok === false ? ' err' : '');
  el.textContent = res.ok === true ? 'OK · ' + res.note + ' · ' + res.ms + 'ms' : res.note;
}

/**
 * Probe leve AF/FD via Worker (não substitui loadAfData — só saúde no botão Testar).
 * NUNCA mexe no prompt.
 */
async function _shProbeWorkerKeyed(kind) {
  const worker = typeof getWorkerUrl === 'function' ? getWorkerUrl() : '';
  if (!worker) return { id: kind, ok: null, ms: 0, note: 'precisa Worker URL' };
  const t0 = Date.now();
  const base = worker.replace(/\/+$/, '');
  try {
    if (kind === 'af') {
      // /status da AF não conta na cota diária
      const r = await fetch(base + '/af/status', { signal: AbortSignal.timeout(10000) });
      const ms = Date.now() - t0;
      if (!r.ok) return { id: 'af', ok: false, ms, note: 'HTTP ' + r.status };
      const d = await r.json().catch(() => ({}));
      const acc = d.response || d;
      const cur = acc && (acc.requests || acc.account);
      const used =
        (acc && acc.requests && acc.requests.current) != null
          ? acc.requests.current
          : cur && cur.requests && cur.requests.current;
      const lim =
        (acc && acc.requests && acc.requests.limit_day) != null
          ? acc.requests.limit_day
          : 100;
      if (used != null) {
        return { id: 'af', ok: true, ms, note: 'Worker OK · ' + used + '/' + lim + ' req hoje' };
      }
      return { id: 'af', ok: true, ms, note: 'Worker OK · /status' };
    }
    if (kind === 'fd') {
      const r = await fetch(base + '/fd/competitions', { signal: AbortSignal.timeout(10000) });
      const ms = Date.now() - t0;
      if (!r.ok) return { id: 'fd', ok: false, ms, note: 'HTTP ' + r.status };
      const d = await r.json().catch(() => ({}));
      const n = Array.isArray(d.competitions) ? d.competitions.length : d.count || 0;
      return { id: 'fd', ok: n > 0, ms, note: n > 0 ? n + ' competições via Worker' : 'vazio/sem secret' };
    }
  } catch (e) {
    return { id: kind, ok: false, ms: Date.now() - t0, note: 'erro: ' + ((e && e.message) || '?') };
  }
  return { id: kind, ok: null, ms: 0, note: '?' };
}

/**
 * Proba free + AF/FD via Worker.
 * Resultado → settings rows + sessionStorage + globalThis._sourceHealth. Nada no prompt.
 */
/**
 * @param {{includeKeyed?:boolean}} [opts] includeKeyed=true atualiza AF/FD (botão manual).
 * Auto-probe periódico NÃO sobrescreve status rico do loadAfData/loadFdData.
 */
async function probeSourcesHealth(opts) {
  const includeKeyed = !!(opts && opts.includeKeyed);
  const id = _shActiveComp();
  const worker = typeof getWorkerUrl === 'function' ? getWorkerUrl() : '';
  const btn = document.getElementById('btn-probe-sources');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Testando fontes…';
  }
  const probes = await Promise.all([
    _shProbeOne('tsdb', () =>
      typeof getTsdbContext === 'function' ? getTsdbContext(id) : ''
    ),
    _shProbeOne('openfootball', () =>
      typeof getOpenFootballContext === 'function' ? getOpenFootballContext(id) : ''
    ),
    _shProbeOne('scorebat', () =>
      typeof getScorebatContext === 'function' ? getScorebatContext(id) : ''
    ),
    _shProbeOne(
      'openliga',
      () => (typeof getOpenLigaContext === 'function' ? getOpenLigaContext(id) : ''),
      typeof openligaShortcut === 'function' && !openligaShortcut(id)
        ? 'não mapeado p/ esta liga'
        : ''
    ),
    _shProbeOne(
      'fpl',
      () => (typeof getFplContext === 'function' ? getFplContext('epl', []) : ''),
      id !== 'epl' ? 'só Premier League' : !worker ? 'precisa Worker URL (CORS)' : ''
    ),
    _shProbeOne('statsbomb', async () => {
      if (typeof cachedJsonFetch !== 'function') return '';
      const comps = await cachedJsonFetch(
        'https://raw.githubusercontent.com/statsbomb/open-data/master/data/competitions.json',
        'meridian_sbopen_comps_v1',
        { ttl: 7 * 24 * 60 * 60 * 1000, timeout: 9000 }
      );
      if (!Array.isArray(comps)) return '';
      return comps.length + ' temporadas no open-data';
    }),
    includeKeyed ? _shProbeWorkerKeyed('af') : Promise.resolve(null),
    includeKeyed ? _shProbeWorkerKeyed('fd') : Promise.resolve(null),
  ]);
  const payload = {
    ts: Date.now(),
    compId: id,
    probes: probes.filter(Boolean),
    includeKeyed,
  };
  try {
    globalThis._sourceHealth = payload;
  } catch {}
  try {
    sessionStorage.setItem(SOURCE_HEALTH_STORE, JSON.stringify(payload));
  } catch {}
  _shSetStatus('tsdb-status', probes[0]);
  _shSetStatus('of-status', probes[1]);
  _shSetStatus('scorebat-status', probes[2]);
  _shSetStatus('openliga-status', probes[3]);
  _shSetStatus('fpl-status', probes[4]);
  _shSetStatus('sbopen-status', probes[5]);
  if (includeKeyed) {
    if (probes[6]) _shSetStatus('af-status', probes[6]);
    if (probes[7]) _shSetStatus('fd-status', probes[7]);
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Testar fontes agora';
  }
  return payload;
}

/** Clique do botão — inclui AF/FD via Worker. */
function probeSourcesHealthFull() {
  return probeSourcesHealth({ includeKeyed: true });
}

// Auto: load atrasado (não compete com o boot) + periódico. Cache TTL segura o custo.
(function initSourceHealth() {
  try {
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      probeSourcesHealth().catch(() => {});
    }, 4000);
    setInterval(() => {
      probeSourcesHealth().catch(() => {});
    }, SOURCE_HEALTH_INTERVAL);
  } catch {}
})();
