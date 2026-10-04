/** Retained heap plus ArrayBuffer bytes; external includes ArrayBuffers and must not be added again. */
export function retainedMetric(delta, sizeBytes) {
  const retainedBytes = delta.heapUsedBytes + delta.arrayBufferBytes;
  return { delta, retainedBytes, bytesPerSourceByte: retainedBytes / sizeBytes,
    bytesPerMiB: retainedBytes * 1024 ** 2 / sizeBytes };
}

export const editorMemoryBudgets = Object.freeze({
  fixedBufferBytes: 65_536,
  bufferBytesPerSourceByte: 6,
  modelBytes: 65_536,
  undoBytesPerStep: 16_384,
  fixedTokenBytes: 1024 ** 2,
  tokenBytesPerLexedCharacter: 256,
  fixedViewBytes: 65_536,
  viewBytesPerLogicalLine: 24
});

/** Structural budgets are fixed independently of observed data; every measured retained component is checked. */
export function evaluateMemoryBudgets(row, limits = editorMemoryBudgets) {
  const lexedCharacters = row.tokens.statistics?.syntaxEnabled
    ? Math.min(row.sizeBytes, row.tokens.statistics.lexicalCharacterLimit) : 0;
  const checks = [
    { component: 'buffer', retainedBytes: row.buffer.retainedBytes,
      limitBytes: limits.fixedBufferBytes + row.sizeBytes * limits.bufferBytesPerSourceByte },
    { component: 'model', retainedBytes: row.model.retainedBytes, limitBytes: limits.modelBytes },
    { component: 'undo', retainedBytes: row.undo.retainedBytes, limitBytes: row.undo.steps * limits.undoBytesPerStep },
    { component: 'view', retainedBytes: row.view.retainedBytes,
      limitBytes: limits.fixedViewBytes + row.view.logicalLines * limits.viewBytesPerLogicalLine }
  ];
  if (row.tokens.status === 'measured') checks.push({ component: 'tokens', retainedBytes: row.tokens.retainedBytes,
    limitBytes: limits.fixedTokenBytes + lexedCharacters * limits.tokenBytesPerLexedCharacter });
  const rows = checks.map(check => ({ ...check, passed: Number.isFinite(check.retainedBytes)
    && Number.isFinite(check.limitBytes) && check.retainedBytes <= check.limitBytes }));
  return { limits, rows, passed: rows.every(check => check.passed) };
}
