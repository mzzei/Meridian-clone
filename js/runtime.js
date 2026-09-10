/**
 * Acesso ao host global (app clássico / HTML onclick).
 * Só para bordas ESM (export/report, history callbacks) — não para o corpo de
 * módulos de domínio (esses devem importar deps ou ficar classic).
 */
export function host() {
  return globalThis;
}

/** Lê função do host. Em dev (localhost) lança se faltar — evita no-op silencioso. */
export function hostFn(name, { optional = false } = {}) {
  const fn = globalThis[name];
  if (typeof fn === 'function') return fn;
  if (optional) return null;
  const isLocal =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  if (isLocal) {
    console.warn('[Meridian] hostFn missing:', name);
  }
  return null;
}

/** Igual hostFn, mas lança se ausente (wiring crítico). */
export function mustHostFn(name) {
  const fn = globalThis[name];
  if (typeof fn === 'function') return fn;
  throw new Error('[Meridian] host missing function: ' + name);
}
