const uiNamespaces = Object.freeze([
  'Microsoft.UI.', 'Microsoft.Graphics.Canvas.', 'Windows.UI.', 'Windows.Foundation.', 'SharpForge.UI.'
]);

/** Resolve the bounded framework assembly family without changing explicit reference identities supplied by callers. */
export function defaultTypeAssembly(fullName, framework) {
  if (uiNamespaces.some(prefix => fullName.startsWith(prefix))) return 'SharpForge.WinUI';
  if (fullName.startsWith('SharpForge.Runtime.')) return 'SharpForge.Runtime';
  if (framework === 'mscorlib4') return 'mscorlib';
  if (fullName === 'System.Console') return 'System.Console';
  if (fullName === 'System.Diagnostics.Debug') return 'System.Diagnostics.Debug';
  return 'System.Runtime';
}
