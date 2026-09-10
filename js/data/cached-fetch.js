/* js/data/cached-fetch.js — fetch JSON + localStorage TTL (canônico)
 *
 * Unifica o protocolo espalhado em ESPN/TSDB/AF/FD/free-sources.
 * Shape de cache: { t: epochMs, d: data }
 */
const CACHED_FETCH_DEFAULT_TTL = 15 * 60 * 1000;
const CACHED_FETCH_DEFAULT_TIMEOUT = 9000;

/**
 * @param {string} url
 * @param {string} cacheKey
 * @param {{ttl?:number,timeout?:number,staleOnError?:boolean,headers?:object}} [opts]
 * @returns {Promise<*|null>}
 */
async function cachedJsonFetch(url, cacheKey, opts) {
  opts = opts || {};
  const ttl = opts.ttl != null ? opts.ttl : CACHED_FETCH_DEFAULT_TTL;
  const timeout = opts.timeout != null ? opts.timeout : CACHED_FETCH_DEFAULT_TIMEOUT;
  const staleOnError = !!opts.staleOnError;
  let stale = null;

  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.d !== undefined) {
        if (Date.now() - (c.t || 0) < ttl) return c.d;
        if (staleOnError) stale = c.d;
      }
    }
  } catch {}

  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: opts.headers || undefined,
    });
    if (!res.ok) return staleOnError ? stale : null;
    // raw.githubusercontent costuma mandar text/plain; res.json() às vezes falha → text + parse
    let d;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('json')) {
      d = await res.json();
    } else {
      const txt = await res.text();
      d = JSON.parse(txt);
    }
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d }));
    } catch { globalThis.meridianFail?.('cache-write'); } // shell 130
    return d;
  } catch {
    return staleOnError ? stale : null;
  } finally {
    clearTimeout(tid);
  }
}

/** Junta blocos de texto com teto total e por bloco (economia de tokens de input). */
function joinContextBlocks(blocks, opts) {
  opts = opts || {};
  const maxTotal = opts.maxTotal != null ? opts.maxTotal : 14000;
  const maxEach = opts.maxEach != null ? opts.maxEach : 4500;
  const sep = opts.sep != null ? opts.sep : '\n\n';
  const parts = [];
  let used = 0;
  for (let i = 0; i < (blocks || []).length; i++) {
    let t = String(blocks[i] || '').trim();
    if (!t) continue;
    if (t.length > maxEach) t = t.slice(0, maxEach) + '\n…[truncado]';
    if (used + t.length > maxTotal) {
      const room = maxTotal - used - 20;
      if (room > 200) parts.push(t.slice(0, room) + '\n…[orçamento]');
      break;
    }
    parts.push(t);
    used += t.length + sep.length;
  }
  return parts.join(sep);
}

/** Extrai "Time A x Time B" / vs / × do texto da query (heurística conservadora). */
function parseMatchTeamsFromQuery(q) {
  const s = String(q || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return [];
  // "Análise do jogo (...): Flamengo × Palmeiras"
  const afterColon = s.match(/:\s*([^.\n]{6,80})/);
  const focus = afterColon ? afterColon[1] : s;
  const m = focus.match(
    /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9.'\-\s]{1,40}?)\s+(?:x|×|vs\.?|versus)\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9.'\-\s]{1,40}?)(?:\s*[(\n,]|$)/i
  );
  if (!m) return [];
  const a = m[1].trim().replace(/\s+/g, ' ');
  const b = m[2].trim().replace(/\s+/g, ' ');
  if (a.length < 2 || b.length < 2) return [];
  // evita capturar lixo tipo "Análise do jogo"
  if (/an[aá]lise|jogo\s*\(|classifica/i.test(a)) return [];
  return [a, b];
}
