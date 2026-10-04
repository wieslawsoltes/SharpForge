export function describeDiagnostic(diagnostic) {
  return `${diagnostic.severity ?? 'error'} ${diagnostic.code ?? ''}: ${diagnostic.message ?? ''}`.trim();
}

/** Wrapped error navigation issues exactly one announcement for each invocation. */
export function navigateDiagnostic(editor, direction = 1) {
  const diagnostics = [...editor.diagnostics].sort((left, right) => left.start - right.start);
  if (!diagnostics.length) { editor.accessibility.announce('No diagnostics in this document'); return null; }
  const diagnostic = direction > 0
    ? diagnostics.find(item => item.start > editor.offset) ?? diagnostics[0]
    : diagnostics.findLast(item => item.start < editor.offset) ?? diagnostics.at(-1);
  editor.goto(diagnostic.start, diagnostic.start + Math.max(0, diagnostic.length ?? 0));
  editor.accessibility.announce(describeDiagnostic(diagnostic));
  return diagnostic;
}

export function announceLineState(editor) {
  const line = editor.model.positionAt(editor.offset).line;
  const diagnostics = editor.diagnostics.filter(item => (item.range?.start.line ?? editor.model.positionAt(item.start).line) === line);
  const breakpoint = editor.breakpoints.find(item => item.line === line + 1);
  const state = breakpoint ? `${breakpoint.enabled === false ? 'Disabled' : 'Enabled'} breakpoint. ` : 'No breakpoint. ';
  editor.accessibility.announce(state + (diagnostics.length ? diagnostics.map(describeDiagnostic).join('. ') : 'No diagnostics on this line.'));
}
