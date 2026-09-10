/**
 * Estado compartilhado do app + setters canônicos.
 *
 * - `state` é a fonte de verdade (ESM).
 * - Bridges em globalThis (_schedule, _history, …) mantêm classic funcionando
 *   com o MESMO objeto/slot (get/set).
 */
import { expose } from './expose.js';
import { COMPETITIONS, COMP_ACTIVE_STORE, readStoredActiveCompId } from './comp/competitions.js';

export const HIST_KEY = 'meridian_history_v1';
export const SCHED_STORE = 'meridian_sched_union_v1';
export const SCHED_TTL = 24 * 60 * 60 * 1000;
export const CTX_STORE = 'meridian_ctx_v1';
export const CTX_TTL = 12 * 60 * 60 * 1000;
export const ESPN_TTL = 15 * 60 * 1000;

const initialActive = readStoredActiveCompId();

/** Estado mutável canônico */
export const state = {
  schedule: [],
  schedByComp: {},
  history: [],
  activeCompId: initialActive,
  statsCompId: initialActive,
  libCompId: null,
  compStatus: {},
  currentView: 'chat',
  libFilter: 'todos',
  running: false,
  abort: null,
  pendingQuery: '',
  cardCount: 0,
  featuredPaintGen: 0,
};

/** Liga propriedade global ↔ campo de state (mesmo valor). */
function bridge(globalName, stateKey) {
  Object.defineProperty(globalThis, globalName, {
    get() {
      return state[stateKey];
    },
    set(v) {
      state[stateKey] = v;
    },
    configurable: true,
    enumerable: true,
  });
}

bridge('_schedule', 'schedule');
bridge('_schedByComp', 'schedByComp');
bridge('_history', 'history');
bridge('_activeCompId', 'activeCompId');
bridge('_statsCompId', 'statsCompId');
bridge('_libCompId', 'libCompId');
bridge('_compStatus', 'compStatus');
bridge('_currentView', 'currentView');
bridge('_libFilter', 'libFilter');
bridge('_running', 'running');
bridge('_abort', 'abort');
bridge('_pendingQuery', 'pendingQuery');
bridge('_cardCount', 'cardCount');
bridge('_featuredPaintGen', 'featuredPaintGen');

// Constantes de storage no global (classic / history ESM)
expose({
  HIST_KEY,
  SCHED_STORE,
  SCHED_TTL,
  CTX_STORE,
  CTX_TTL,
  ESPN_TTL,
});

// ── Setters canônicos ─────────────────────────────────────────────────────

/** Substitui a união de jogos (chips / destaque). */
export function setSchedule(list) {
  state.schedule = Array.isArray(list) ? list : [];
  return state.schedule;
}

/** Agenda de uma liga específica. */
export function setCompSchedule(compId, jogos) {
  if (!compId) return null;
  if (!state.schedByComp || typeof state.schedByComp !== 'object') state.schedByComp = {};
  state.schedByComp[compId] = Array.isArray(jogos) ? jogos : [];
  return state.schedByComp[compId];
}

/** Liga do agente (análise). Persiste preferência. Não mexe em stats por padrão. */
export function setAnalysisCompId(id) {
  if (!COMPETITIONS[id]) return false;
  const changed = state.activeCompId !== id;
  state.activeCompId = id;
  try {
    localStorage.setItem(COMP_ACTIVE_STORE, id);
  } catch (_) {}
  return changed;
}

/** Liga do seletor de Estatísticas (sidebar). */
export function setStatsCompId(id) {
  if (!COMPETITIONS[id]) return false;
  state.statsCompId = id;
  return true;
}

/** Drill-down da Biblioteca (null = grade de campeonatos). */
export function setLibCompId(id) {
  if (id != null && !COMPETITIONS[id]) return false;
  state.libCompId = id;
  return true;
}

/** View ativa: chat | library | saved */
export function setCurrentView(view) {
  state.currentView = view || 'chat';
  return state.currentView;
}

/** Filtro de partidas na biblioteca. */
export function setLibFilterValue(f) {
  state.libFilter = f || 'todos';
  return state.libFilter;
}

/** Histórico em memória (persistência continua em history.js). */
export function setHistoryList(list) {
  state.history = Array.isArray(list) ? list : [];
  return state.history;
}

/** Flag de análise/chat em andamento. */
export function setRunning(on, abortCtrl, pendingQuery) {
  state.running = !!on;
  if (arguments.length >= 2) state.abort = abortCtrl || null;
  if (arguments.length >= 3) state.pendingQuery = pendingQuery != null ? pendingQuery : '';
  return state.running;
}

/** Merge de status de uma competição (loading, upcoming, …). */
export function patchCompStatus(compId, patch) {
  if (!compId) return null;
  if (!state.compStatus || typeof state.compStatus !== 'object') state.compStatus = {};
  state.compStatus[compId] = Object.assign(
    { loading: false, checked: false, upcoming: 0, total: 0, soon: false, error: '' },
    state.compStatus[compId] || {},
    patch || {}
  );
  return state.compStatus[compId];
}

// Aliases legíveis no global (setters) para classic / debug
expose({
  state,
  setSchedule,
  setCompSchedule,
  setAnalysisCompId,
  setStatsCompId,
  setLibCompId,
  setCurrentView,
  setLibFilterValue,
  setHistoryList,
  setRunning,
  patchCompStatus,
});
