/**
 * Registry global para interop HTML onclick + scripts clássicos.
 * Módulos ESM exportam e chamam expose({ ... }) para o window.
 */
export function expose(api) {
  if (typeof globalThis === 'undefined' || !api) return api;
  Object.assign(globalThis, api);
  return api;
}
