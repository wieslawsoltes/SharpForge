/** Parse terminal/console MSBuild diagnostics, preserving source identity and rule help links. */
export function parseDiagnosticLine(line) {
  const clean = String(line).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/^\s*[│┃└├┌─\s]*/, '').replace(/^\s*\d+>/, '').trim();
  const source = /^(?:error|warning)(?:\s+[A-Za-z]+\d+|\s*:)/i.test(clean) ? 'MSBUILD : ' + clean : clean;
  let match = /^(.*?)\s*:\s*(?:([A-Za-z][A-Za-z .-]*?)\s+)?(error|warning)\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s*:\s*|\s+)(.*)$/i.exec(source);
  if (!match) {
    const uncoded = /^(.*?)\s*:\s*(error|warning)\s*:\s*(.+)$/i.exec(source);
    if (uncoded) match = [uncoded[0], uncoded[1], null, uncoded[2], 'SFMSB_UNCODED', uncoded[3]];
  }
  if (!match) return null;
  let location = match[1], message = match[5], project = null, helpUri = null;
  const suffix = /\s+\[([^\]\r\n]+\.(?:[a-z]*proj|slnx|sln)(?:[^\]]*)?)\]$/i.exec(message);
  if (suffix) { project = suffix[1]; message = message.slice(0, suffix.index); }
  const help = /\s+[\[(](https?:\/\/[^\s\])]+)[\])]$/.exec(message);
  if (help) { helpUri = help[1]; message = message.slice(0, help.index); }
  const position = /^(.*)\((\d+)(?:,(\d+))?(?:,(\d+),(\d+))?\)$/.exec(location);
  const tool = /^(?:MSBUILD|CSC|VBC|FSC|LINK)$/i.test(location);
  const result = { severity: match[3].toLowerCase(), code: match[4], message,
    file: position ? position[1] : tool ? null : location || null,
    line: position ? Number(position[2]) : null, column: position ? Number(position[3] ?? 1) : null,
    endLine: position?.[4] ? Number(position[4]) : null, endColumn: position?.[5] ? Number(position[5]) : null,
    project, raw: clean };
  if (match[2] && !['fatal', 'command line'].includes(match[2].toLowerCase())) result.subcategory = match[2];
  if (helpUri) result.helpUri = helpUri;
  return result;
}

export class DiagnosticCollector {
  constructor({ maxDiagnostics = 10000 } = {}) { this.maxDiagnostics = maxDiagnostics; this.diagnostics = []; this.keys = new Set(); this.last = null; }
  accept(line) {
    const diagnostic = parseDiagnosticLine(line);
    if (diagnostic) {
      const key = JSON.stringify([diagnostic.severity, diagnostic.code, diagnostic.file, diagnostic.line, diagnostic.column,
        diagnostic.project, diagnostic.message]);
      if (!this.keys.has(key)) {
        if (this.diagnostics.length >= this.maxDiagnostics) throw new Error('Diagnostic count limit exceeded');
        this.keys.add(key);
        this.diagnostics.push(diagnostic);
      }
      this.last = diagnostic;
      return diagnostic;
    }
    if (this.last && /^\s+\S/.test(line) && !/^(?:\s*\d+>|\s*(?:Build |Time Elapsed|\d+ Warning|\d+ Error))/.test(line)) {
      this.last.relatedMessages ??= [];
      if (this.last.relatedMessages.length < 64) this.last.relatedMessages.push(line.trim());
    } else this.last = null;
    return null;
  }
}
