const decode = text => text.replace(/&(?:quot|apos|amp|lt|gt|#(?:x[0-9a-f]+|\d+));/gi, entity => {
  const named = { '&quot;': '"', '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>' };
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
  const hex = entity[2].toLowerCase() === 'x', value = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd';
});

function attributes(text) {
  const result = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!result.has(name)) result.set(name, decode(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return result;
}

/** Read only active head metadata. Comments, raw-text elements and templates cannot manufacture a policy. */
export function headPolicies(html) {
  const policies = [], errors = [];
  let offset = 0, inHead = false, sawHead = false, templateDepth = 0, resourceSeen = false;
  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start < 0) break;
    if (!templateDepth && html.slice(offset, start).trim()) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) break;
      offset = end + 3; continue;
    }
    if (!sawHead && /^<!doctype\s+html(?:\s|>)/i.test(html.slice(start))) {
      const end = html.indexOf('>', start);
      if (end < 0) break;
      offset = end + 1;
      continue;
    }
    const match = /^<(\/?)([a-z][a-z0-9:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(html.slice(start));
    if (!match) break;
    offset = start + match[0].length;
    const closing = !!match[1], name = match[2].toLowerCase(), attrs = attributes(match[3]);
    if (!sawHead && (closing || !['html', 'head'].includes(name))) break;
    if (name === 'template') { templateDepth += closing ? -Math.min(1, templateDepth) : 1; continue; }
    if (templateDepth) {
      if (['script', 'style', 'title', 'textarea', 'noscript', 'noframes'].includes(name) && !closing) {
        const end = new RegExp(`</${name}\\s*>`, 'gi'); end.lastIndex = offset;
        if (!end.exec(html)) break;
        offset = end.lastIndex;
      }
      continue;
    }
    if (name === 'head') {
      if (closing) break;
      if (sawHead) { errors.push('Duplicate head'); break; }
      inHead = sawHead = true; continue;
    }
    if (name === 'body') break;
    if (closing || !inHead) continue;
    if (!['meta', 'base', 'basefont', 'bgsound', 'link', 'script', 'style', 'title', 'noscript', 'noframes'].includes(name)) break;
    if (name === 'meta' && attrs.get('http-equiv')?.toLowerCase() === 'content-security-policy') {
      if (resourceSeen) errors.push('CSP meta appears after a resource or executable element');
      else policies.push(attrs.get('content') ?? '');
    }
    if (['script', 'style', 'link', 'base', 'iframe', 'object'].includes(name)) resourceSeen = true;
    if (['script', 'style', 'title', 'textarea', 'noscript', 'noframes'].includes(name)) {
      const end = new RegExp(`</${name}\\s*>`, 'gi'); end.lastIndex = offset;
      const close = end.exec(html); if (!close) break;
      offset = end.lastIndex;
    }
  }
  return { policies, errors };
}

export function policyDirectives(policy) {
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    if (directives.has(key)) throw new Error(`Duplicate CSP directive ${key}`);
    directives.set(key, values.sort());
  }
  return directives;
}

export function samePolicy(actual, expected) {
  try {
    const a = policyDirectives(actual), e = policyDirectives(expected);
    return a.size === e.size && [...e].every(([name, values]) => JSON.stringify(a.get(name)) === JSON.stringify(values));
  } catch { return false; }
}
