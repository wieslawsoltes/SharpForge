export const WORK_ID = /^SF-(?:A\d{2}|R\d{3})-[ETB]\d{2}(?:\.\d+)?$/;
function withoutLinkDestinations(text) {
  let result = '', start = 0;
  for (const match of text.matchAll(/\[[^\]\r\n]*\]\(/g)) {
    if (match.index < start) continue;
    const destination = match.index + match[0].length - 1;
    let end = destination + 1, depth = 1;
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') end++;
      else if (text[end] === '(') depth++;
      else if (text[end] === ')') depth--;
    }
    if (depth) continue;
    result += text.slice(start, destination);
    start = end;
  }
  return result + text.slice(start);
}
export function parseDependencies(body) {
  const dependencies = new Set(), contracts = new Map();
  function ids(text) {
    // Capture the entire candidate so an invalid suffix cannot become another task.
    const tokens = withoutLinkDestinations(text).match(/SF-[^\s,;:()[\]`*<>"'!?]*/g) ?? [];
    for (const candidate of tokens) {
      const token = candidate.endsWith('.') && WORK_ID.test(candidate.slice(0, -1)) ? candidate.slice(0, -1) : candidate;
      if (!WORK_ID.test(token)) throw new Error(`Malformed dependency ID: ${candidate}`);
      dependencies.add(token);
    }
    return tokens;
  }
  const section = body.match(/^## Dependencies\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? '';
  ids(section);
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^(Depends on|Requires contracts):\s*(.*)$/); if (!header) continue;
    let text = header[2];
    while (i + 1 < lines.length && (/^\s*[-*]\s+|^\s{2,}\S/.test(lines[i + 1]) || lines[i + 1] === '' && /^\s*[-*]\s+/.test(lines[i + 2] ?? ''))) text += '\n' + lines[++i];
    if (header[1] === 'Depends on') {
      const tokens = ids(text);
      if (!tokens.length && !/^(?:none|n\/a)?$/i.test(text.trim())) throw new Error(`Malformed Depends on list: ${text}`);
    } else {
      for (const entry of text.split(/[\s,]+/).map(s => s.replace(/^[`*-]+|[`;]+$/g, '')).filter(Boolean)) {
        if (WORK_ID.test(entry)) { dependencies.add(entry); continue; }
        const match = entry.match(/^([a-z][\w./-]*)@(\d+(?:\.\d+){0,2})$/);
        if (!match) throw new Error(`Malformed contract requirement: ${entry}`);
        if (contracts.has(match[1]) && contracts.get(match[1]) !== match[2]) throw new Error(`Conflicting contract version: ${match[1]}`);
        contracts.set(match[1], match[2]);
      }
    }
  }
  return { dependencies: [...dependencies].sort(), contracts: [...contracts].sort().map(([name, version]) => ({ name, version })) };
}
