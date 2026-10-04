import { readPE, utf8, token, codedIndex } from '@sharpforge/cil';
import { writeEmbeddedSource } from './cdi-core.js';
import { writeDocument } from './document-writer.js';
import { PdbGuids, fail } from './contracts.js';
import { PortablePdbBuilder } from './pdb-builder.js';
import { writeSequencePoints } from './sequence-points.js';
import { writeStateMachines, appendCustomRecords } from './custom-debug-writer.js';
import { writeImportScopes } from './import-writer.js';
import { writeMethodScopes } from './scope-writer.js';
import { asyncSteppingRecords } from './pdb-writer-async.js';
import { lineIndex, sourceSpan } from './source-span.js';
/** Emit independent standard symbols for the exact emitted PE's tokens/offsets. */
export function emitPortablePdb(assembly, debug, { embedSources = true, sourceLink = null, asyncLimits } = {}) {
  const pe = readPE(assembly, { inspection: true }),
    b = new PortablePdbBuilder(),
    docs = new Map(),
    cdi = [];
  const stateMachines = debug.stateMachines ?? [];
  const custom = asyncSteppingRecords(pe, stateMachines, debug.custom ?? [], asyncLimits);
  for (const s of debug.sources ?? []) {
    if (docs.has(s.uri)) fail('Duplicate document names');
    const { id, bytes: raw } = writeDocument(b, s);
    docs.set(s.uri, id);
    if (embedSources && raw !== null && (s.text !== undefined || s.bytes !== undefined))
      cdi.push([
        codedIndex('HasCustomDebugInformation', token(48, id)),
        b.guid(PdbGuids.embeddedSource),
        b.blob(writeEmbeddedSource({ source: raw })),
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
  writeStateMachines(b, stateMachines, pe.metadata.counts);
  appendCustomRecords(b, custom, pe.metadata.counts, cdi);
  return b.finish(pe.metadata.counts, pe.entryPoint);
}
