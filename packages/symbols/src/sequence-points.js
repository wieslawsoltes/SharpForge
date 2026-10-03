import { Reader, Writer } from '@sharpforge/cil';
import { fail, HIDDEN } from './contracts.js';
function signed(w, n) {
  if (!Number.isInteger(n) || n < -0x10000000 || n > 0xfffffff) fail('Signed PDB integer out of range');
  const bits = n >= -64 && n <= 63 ? 7 : n >= -8192 && n <= 8191 ? 14 : 29,
    v = ((n & (2 ** (bits - 1) - 1)) * 2 + (n < 0 ? 1 : 0)) >>> 0;
  if (bits === 7) w.u8(v);
  else if (bits === 14) w.u8((v >>> 8) | 0x80).u8(v);
  else
    w.u8((v >>> 24) | 0xc0)
      .u8(v >>> 16)
      .u8(v >>> 8)
      .u8(v);
  return w;
}
export function readSequencePoints(bytes, document = 0, { maxPoints = 1_000_000, documents = Infinity } = {}) {
  if (!bytes.length) return { localSignature: 0, points: [] };
  const r = new Reader(bytes),
    localSignature = r.compressed();
  if (!document) document = r.compressed();
  if (document < 1 || document > documents) fail('Invalid initial document');
  let offset = 0,
    line = 0,
    column = 0,
    first = true,
    visible = false;
  const points = [];
  while (r.position < r.end) {
    if (points.length >= maxPoints) fail('Sequence point limit exceeded');
    const delta = r.compressed();
    if (!first && delta === 0) {
      document = r.compressed();
      if (document < 1 || document > documents) fail('Invalid sequence point document');
      continue;
    }
    offset = first ? delta : offset + delta;
    const dl = r.compressed(),
      dc = dl ? r.signedCompressed() : r.compressed();
    let p;
    if (dl === 0 && dc === 0)
      p = { offset, document, startLine: HIDDEN, endLine: HIDDEN, startColumn: 0, endColumn: 0, hidden: true };
    else {
      line = visible ? line + r.signedCompressed() : r.compressed();
      column = visible ? column + r.signedCompressed() : r.compressed();
      p = {
        offset,
        document,
        startLine: line,
        startColumn: column,
        endLine: line + dl,
        endColumn: dl ? column + dc : column + dc,
        hidden: false,
      };
      visible = true;
      if (
        line < 0 ||
        line === HIDDEN ||
        line >= 0x20000000 ||
        p.endLine >= 0x20000000 ||
        column < 0 ||
        column > 65535 ||
        p.endColumn < 0 ||
        p.endColumn > 65535 ||
        (!dl && p.endColumn <= column)
      )
        fail('Invalid sequence point span');
    }
    if (offset >= 0x20000000) fail('Invalid sequence point offset');
    points.push(p);
    first = false;
  }
  return { localSignature, points };
}
export function writeSequencePoints(points, document = 0, localSignature = 0) {
  const w = new Writer().compressed(localSignature);
  if (!points.length) return new Uint8Array();
  let doc = document || points[0].document;
  if (!document) w.compressed(doc);
  let offset = 0,
    line = 0,
    column = 0,
    first = true,
    visible = false;
  for (const p of points) {
    if (p.document !== doc) {
      if (first) fail('Initial PDB document mismatch');
      w.compressed(0).compressed(p.document);
      doc = p.document;
    }
    if (!Number.isInteger(p.offset) || p.offset < 0 || (!first && p.offset <= offset))
      fail('Sequence offsets must increase');
    w.compressed(first ? p.offset : p.offset - offset);
    offset = p.offset;
    if (p.hidden || p.startLine === HIDDEN) w.compressed(0).compressed(0);
    else {
      const dl = p.endLine - p.startLine,
        dc = p.endColumn - p.startColumn;
      if (dl < 0 || (dl === 0 && dc <= 0)) fail('Invalid sequence span');
      w.compressed(dl);
      if (dl) signed(w, dc);
      else w.compressed(dc);
      if (!visible) w.compressed(p.startLine).compressed(p.startColumn);
      else {
        signed(w, p.startLine - line);
        signed(w, p.startColumn - column);
      }
      line = p.startLine;
      column = p.startColumn;
      visible = true;
    }
    first = false;
  }
  return w.finish();
}
