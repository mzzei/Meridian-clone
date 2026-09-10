/* js/lib/intent.js — roteamento chat vs análise (ESM) */
import { expose } from '../expose.js';

function _hasMatchVsPattern(s) {
  return /\b[\wÀ-ÿ][\wÀ-ÿ.'-]{1,28}(?:\s+[\wÀ-ÿ.'-]{1,28}){0,3}\s+(?:x|vs\.?|×|versus|contra)\s+[\wÀ-ÿ][\wÀ-ÿ.'-]{1,28}(?:\s+[\wÀ-ÿ.'-]{1,28}){0,3}\b/i.test(
    s
  );
}

function looksLikeMatchQuery(t) {
  const s = (t || '').trim();
  if (s.length <= 8) return false;
  if (/\bPARTIDA\b/i.test(s)) return true;
  if (/\b\d-\d-\d\b/.test(s) && !/[A-Za-zÀ-ÿ]{3,}/.test(s.replace(/\d-\d-\d/g, ''))) return false;
  const hasMatch = _hasMatchVsPattern(s);
  if (!hasMatch) return false;
  if (
    /\b(an[aá]lise\s+completa|an[aá]lise\s+padr[aã]o|relat[oó]rio|pipeline|escanteios?|cart[oõ]es?|poisson|ticket|probabilidades?|dados\s+avan[cç]ados|escala[cç][aã]o)\b/i.test(
      s
    )
  )
    return true;
  if (/\banalis/i.test(s)) return true;
  if (
    /^(qual|quais|o que|oque|como\s+foi|por que|porque|o\s+que\s+achou|sua\s+opini[aã]o|me\s+fala|s[oó]\s+os\s+gols|s[oó]\s+o\s+placar)\b/i.test(
      s
    )
  )
    return false;
  if (
    /\b(opini[aã]o|o\s+que\s+achou|como\s+foi|s[oó]\s+os\s+gols|destaques?\s+individuais?)\b/i.test(s) &&
    !/\banalis/i.test(s)
  )
    return false;
  return true;
}

function isStandardAnalysisIntent(t) {
  return looksLikeMatchQuery(t);
}

function isExplicitFullAnalysisAsk(t) {
  return /\b(an[aá]lise\s+completa|an[aá]lise\s+padr[aã]o|relat[oó]rio\s+completo|pipeline\s+completo)\b/i.test(
    t || ''
  );
}

function routeUserIntent(q, opts) {
  opts = opts || {};
  const text = (q || '').trim();
  if (opts.hasAttachments) return { mode: 'chat', reason: 'attachments' };
  if (isExplicitFullAnalysisAsk(text)) {
    if (_hasMatchVsPattern(text)) return { mode: 'analysis', reason: 'explicit_full' };
    return { mode: 'need_teams', reason: 'explicit_full_no_match' };
  }
  if (isStandardAnalysisIntent(text)) return { mode: 'analysis', reason: 'match_query' };
  return { mode: 'chat', reason: 'default' };
}

expose({
  _hasMatchVsPattern,
  looksLikeMatchQuery,
  isStandardAnalysisIntent,
  isExplicitFullAnalysisAsk,
  routeUserIntent,
});

export {
  _hasMatchVsPattern,
  looksLikeMatchQuery,
  isStandardAnalysisIntent,
  isExplicitFullAnalysisAsk,
  routeUserIntent,
};
