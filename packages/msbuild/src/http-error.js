/** Preserve bounded located service diagnostics and existing mutation receipts across the native HTTP boundary. */
export function nativeHttpError(error) {
  const result = { error: error.message, code: error.code, path: error.path };
  if (error.written) result.written = error.written;
  if (error.completed) Object.assign(result, { completed: error.completed, undoToken: error.undoToken });
  if (Array.isArray(error.diagnostics)) {
    result.diagnostics = error.diagnostics.slice(0, 256).map(diagnostic => {
      const value = {};
      for (const key of ['code', 'path', 'severity', 'message']) {
        if (typeof diagnostic[key] === 'string') value[key] = diagnostic[key].slice(0, key === 'message' ? 8192 : 2048);
      }
      for (const key of ['start', 'length', 'line', 'column']) {
        if (Number.isSafeInteger(diagnostic[key]) && diagnostic[key] >= 0) value[key] = diagnostic[key];
      }
      return value;
    });
  }
  return result;
}
