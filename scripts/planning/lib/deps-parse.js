export const WORK_ID = /^SF-(?:A\d{2}|R\d{3})-[ETB]\d{2}(?:\.\d+)?$/;
export function parseDependencies(body) {
  const dependencies = new Set(), contracts = new Map();
  function ids(text) {
    const tokens = text.match(/SF-[A-Za-z0-9.-]+/g) ?? [];
    for (const token of tokens) { if (!WORK_ID.test(token)) throw new Error(`Malformed dependency ID: ${token}`); dependencies.add(token); }
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
