import {frameworkType} from '@sharpforge/framework';

/** Type-only exception declarations retain the legacy exception builtin construction path. */
export function executableFrameworkType(compilation, type, method) {
  if (compilation.findType(type, method)) return null;
  const entry = frameworkType(type);
  return entry?.kind === 'exception' ? null : entry;
}
