import { utf8, equalBytes } from '@sharpforge/cil';
import { sha256, sha1 } from './hash.js';
import { PdbGuids, fail } from './contracts.js';
import { lineIndex } from './source-span.js';
export function verifySource(document, input) {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  if (!(bytes instanceof Uint8Array)) fail('Source must be text or bytes');
  if (document.hashAlgorithm === PdbGuids.sha256) return equalBytes(sha256(bytes), document.hash);
  if (document.hashAlgorithm === PdbGuids.sha1) return equalBytes(sha1(bytes), document.hash);
  return false;
}
export async function verifySourceAsync(document, input) {
  if ([PdbGuids.sha256, PdbGuids.sha1].includes(document.hashAlgorithm)) return verifySource(document, input);
  const algorithm = { [PdbGuids.sha384]: 'SHA-384', [PdbGuids.sha512]: 'SHA-512' }[document.hashAlgorithm];
  if (!algorithm || !globalThis.crypto?.subtle) return false;
  const bytes = typeof input === 'string' ? utf8(input) : input;
  return equalBytes(new Uint8Array(await crypto.subtle.digest(algorithm, bytes)), document.hash);
}
export function sourceLinkUrl(symbols, documentName) {
  const matches = [];
  for (const [pattern, url] of Object.entries(symbols.sourceLink?.documents ?? {})) {
    const pos = pattern.indexOf('*');
    if (pos < 0) {
      if (pattern === documentName) matches.push({ url, specificity: Infinity });
    } else {
      const begin = pattern.slice(0, pos),
        end = pattern.slice(pos + 1);
      if (documentName.startsWith(begin) && documentName.endsWith(end)) {
        const middle = documentName.slice(begin.length, documentName.length - end.length),
          encoded = middle.split(/[\\/]/).map(encodeURIComponent).join('/');
        matches.push({ url: url.replace('*', encoded), specificity: begin.length + end.length });
      }
    }
  }
  matches.sort((a, b) => b.specificity - a.specificity);
  const value = matches[0]?.url;
  if (!value) return null;
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password) fail('Source Link must use credential-free HTTPS');
  return u.href;
}
/** Attach only checksum-verified source; never fetch Source Link implicitly. */
export function bindSources(symbols, sources = {}) {
  const byName = sources instanceof Map ? sources : new Map(Object.entries(sources)),
    documents = symbols.documents.map((d) => {
      const raw = byName.get(d.name) ?? d.embedded,
        bytes = typeof raw === 'string' ? utf8(raw) : raw,
        verified = bytes ? verifySource(d, bytes) : false;
      let content = null;
      if (verified) {
        const hasUtf16 = (bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255);
        content = hasUtf16
          ? new TextDecoder(bytes[0] === 255 ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(bytes)
          : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      return {
        ...d,
        verified,
        text: content,
        reason:
          raw === undefined
            ? 'Source not supplied'
            : verified
              ? 'Checksum verified'
              : 'Source checksum mismatch or unsupported algorithm',
      };
    }),
    indexes = documents.map((d) => (d.verified ? lineIndex(d.text) : [])),
    sequencePoints = [];
  for (const m of symbols.methods)
    for (const p of m.points) {
      const d = documents[p.document - 1];
      if (p.hidden) continue;
      const lines = indexes[p.document - 1],
        valid = d.verified && p.startLine >= 1 && p.endLine <= lines.length && p.startColumn >= 1 && p.endColumn >= 1,
        start = valid ? lines[p.startLine - 1] + p.startColumn - 1 : 0,
        end = valid ? lines[p.endLine - 1] + p.endColumn - 1 : 1;
      if (d.verified && (!valid || start > d.text.length || end > d.text.length || end <= start))
        fail('Sequence point is outside verified source text');
      sequencePoints.push({
        id: sequencePoints.length,
        uri: d.name,
        line: p.startLine,
        column: p.startColumn,
        endLine: p.endLine,
        endColumn: p.endColumn,
        start,
        end,
        ilOffset: p.offset,
        methodToken: m.token,
        methodId: m.token & 0xffffff,
        sourceVerified: d.verified,
      });
    }
  return {
    documents,
    sequencePoints,
    sources: documents.filter((d) => d.verified).map((d) => ({ uri: d.name, text: d.text, version: 1 })),
    methods: symbols.methods.map((m) => ({
      token: m.token,
      locals: symbols.scopes
        .filter((s) => s.methodToken === m.token)
        .flatMap((s) =>
          s.variables.map((v) => ({
            name: v.name,
            slot: v.index,
            hidden: v.hidden,
            startOffset: s.start,
            endOffset: s.end,
          })),
        ),
    })),
  };
}
