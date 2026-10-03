import { Writer, readPE, utf8, token, codedIndex } from '@sharpforge/cil';
import { sha256 } from './hash.js';
import { PdbGuids } from './contracts.js';
import { PortablePdbBuilder } from './pdb-builder.js';
import { writeSequencePoints } from './sequence-points.js';
import { writeImportScopes } from './import-writer.js';
import { writeMethodScopes } from './scope-writer.js';
import { lineIndex, sourceSpan } from './source-span.js';
/** Emit independent standard symbols for the exact emitted PE's tokens/offsets. */
export function emitPortablePdb(assembly, debug, { embedSources = true, sourceLink = null } = {}) {
  const pe = readPE(assembly, { inspection: true }),
    b = new PortablePdbBuilder(),
    docs = new Map(),
    cdi = [];
  for (const s of debug.sources ?? []) {
    const raw = s.bytes ?? utf8(s.text ?? ''),
      name = b.blob(
        new Writer()
          .u8(0)
          .compressed(b.blob(utf8(s.uri)))
          .finish(),
      ),
      id = b.add(48, [name, b.guid(PdbGuids.sha256), b.blob(sha256(raw)), b.guid(PdbGuids.csharp)]);
    docs.set(s.uri, id);
    if (embedSources && s.text !== undefined)
      cdi.push([
        codedIndex('HasCustomDebugInformation', token(48, id)),
        b.guid(PdbGuids.embeddedSource),
        b.blob(new Writer().u32(0).bytes(raw).finish()),
      ]);
  }
  const sourceIndexes = new Map(
      (debug.sources ?? []).map((s) => [s.uri, { text: s.text ?? '', lines: lineIndex(s.text ?? '') }]),
    ),
    pointsByMethod = new Map();
  for (const p of debug.sequencePoints ?? []) {
    if (!docs.has(p.uri)) continue;
    if (!pointsByMethod.has(p.methodToken)) pointsByMethod.set(p.methodToken, []);
    pointsByMethod.get(p.methodToken).push(p);
  }
  writeImportScopes(b, debug.importScopes ?? [], pe.metadata.counts);
  const methods = new Map((debug.methods ?? []).map((m) => [m.token, m]));
  for (let i = 1; i <= (pe.metadata.counts[6] ?? 0); i++) {
    const methodToken = token(6, i),
      m = methods.get(methodToken),
      body = pe.metadata.row(methodToken)[0] ? pe.methodBody(methodToken) : null,
      points = (pointsByMethod.get(methodToken) ?? [])
        .map((p) => {
          const src = sourceIndexes.get(p.uri),
            loc =
              p.line != null && p.column != null && p.endLine != null && p.endColumn != null
                ? p
                : sourceSpan(src?.text ?? '', p.start, p.end, src?.lines);
          return {
            offset: p.ilOffset,
            document: docs.get(p.uri),
            startLine: p.line ?? loc.line,
            startColumn: p.column ?? loc.column,
            endLine: p.endLine ?? loc.endLine,
            endColumn: p.endColumn ?? loc.endColumn,
          };
        })
        .sort((a, c) => a.offset - c.offset)
        .filter((p, j, a) => !j || p.offset !== a[j - 1].offset),
      doc = points.length && points.every((p) => p.document === points[0].document) ? points[0].document : 0;
    b.add(49, [doc, b.blob(writeSequencePoints(points, doc, body?.localSignature & 0xffffff))]);
    writeMethodScopes(b, m, body, pe.metadata.counts);
  }
  if (sourceLink)
    cdi.push([
      codedIndex('HasCustomDebugInformation', token(0, 1)),
      b.guid(PdbGuids.sourceLink),
      b.blob(utf8(JSON.stringify(sourceLink))),
    ]);
  cdi.sort((a, c) => a[0] - c[0]);
  for (const r of cdi) b.add(55, r);
  return b.finish(pe.metadata.counts, pe.entryPoint);
}
