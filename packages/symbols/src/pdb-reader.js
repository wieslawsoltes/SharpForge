import { Reader, readMetadata, token, text, decodeCoded } from '@sharpforge/cil';
import { PdbGuids, fail, guidString } from './contracts.js';
import { hex } from './hash.js';
import { readCustomDebugInformation } from './custom-debug.js';
import { readSequencePoints } from './sequence-points.js';
import { readLocalConstants } from './constant-rows.js';
import { rejectUnsupportedSymbolFormat } from './symbol-format.js';
import { readImports } from './import-reader.js';
import { createAsyncInfoLookup } from './async-info.js';
import { createImportLookup } from './imports.js';
import { createScopeTree } from './scope-tree.js';
import { unavailableLocalSlots } from './unnamed-slots.js';
import { metadataName } from './metadata-facts.js';
import { preflightLocalAnnotation, attachLocalAnnotations, bindConstantAnnotations } from './local-annotations.js';
export function readPortablePdb(
  input,
  {
    maxBytes = 64 * 1024 * 1024,
    maxSourceBytes = 16 * 1024 * 1024,
    maxAsyncEntries,
    maxConstantBytes,
    maxConstantEntries,
    maxConstantModifiers,
  } = {},
) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) fail('Invalid or oversized Portable PDB');
  rejectUnsupportedSymbolFormat(bytes);
  const md = readMetadata(bytes),
    pdb = md.streams.get('#Pdb');
  if (!pdb || pdb.length < 32) fail('Not a standalone Portable PDB');
  if (Object.keys(md.rows).some((t) => +t < 48 || +t > 55)) fail('Portable PDB contains non-debug tables');
  const pr = new Reader(pdb),
    id = new Uint8Array(pr.take(20)),
    entryPoint = pr.u32(),
    guids = md.streams.get('#GUID') ?? new Uint8Array();
  if (guids.length % 16) fail('Invalid GUID heap');
  const guid = (i) =>
    i === 0
      ? null
      : i * 16 > guids.length
        ? fail('Invalid GUID index')
        : guidString(guids.subarray((i - 1) * 16, i * 16));
  const documents = (md.rows[48] ?? []).map((row, i) => {
    const nr = new Reader(md.blob(row[0]));
    if (!nr.end) fail('Document name cannot be nil');
    const separator = nr.u8(),
      parts = [];
    while (nr.position < nr.end) parts.push(text(md.blob(nr.compressed())));
    return {
      id: i + 1,
      name: parts.join(separator ? String.fromCharCode(separator) : ''),
      hashAlgorithm: guid(row[1]),
      hash: new Uint8Array(md.blob(row[2])),
      language: guid(row[3]),
    };
  });
  if (new Set(documents.map((d) => d.name)).size !== documents.length) fail('Duplicate document names');
  const methods = (md.rows[49] ?? []).map((row, i) => ({
    token: token(6, i + 1),
    document: row[0],
    ...readSequencePoints(md.blob(row[1]), row[0], { documents: documents.length }),
  }));
  if (methods.length && methods.length !== (md.externalCounts[6] ?? 0))
    fail('PDB method row count does not match MethodDef count');
  if ((md.rows[50]?.length ?? 0) + (md.rows[51]?.length ?? 0) > 100000) fail('Scope tree entry limit exceeded');
  let localNameCharacters = 0;
  const variables = (md.rows[51] ?? []).map((r, i) => {
    const name = metadataName(md, r[2], 'Scope local');
    if ((localNameCharacters += name.length) > 1024 * 1024) fail('Scope tree name limit exceeded');
    return { id: i + 1, attributes: r[0], index: r[1], name, hidden: !!(r[0] & 1) };
  });
  const constants = readLocalConstants(md, { maxConstantBytes, maxConstantEntries, maxConstantModifiers });
  if ((md.rows[53]?.length ?? 0) > 100000) fail('Import scope count limit exceeded');
  const importBudget = { entries: 0, bytes: 0 };
  const imports = (md.rows[53] ?? []).map((r, i) => ({
    id: i + 1,
    parent: r[0],
    definitions: readImports(md.blob(r[1]), md, importBudget),
  }));
  const effectiveImports = createImportLookup(imports);
  const scopes = (md.rows[50] ?? []).map((r, i, all) => {
    const next = all[i + 1];
    if (
      r[0] < 1 ||
      r[0] > (md.externalCounts[6] ?? 0) ||
      r[1] > imports.length ||
      r[2] < 1 ||
      r[2] > variables.length + 1 ||
      r[3] < 1 ||
      r[3] > constants.length + 1 ||
      !r[5] ||
      r[4] + r[5] >= 0x80000000
    )
      fail('Invalid local scope');
    const variableEnd = next ? next[2] - 1 : variables.length,
      constantEnd = next ? next[3] - 1 : constants.length;
    if (variableEnd < r[2] - 1 || constantEnd < r[3] - 1) fail('Invalid local scope list ordering');
    const vs = variables.slice(r[2] - 1, variableEnd);
    if (new Set(vs.map((x) => x.index)).size !== vs.length || new Set(vs.map((x) => x.name)).size !== vs.length)
      fail('Duplicate local in scope');
    return {
      id: i + 1,
      methodToken: token(6, r[0]),
      importScope: r[1],
      start: r[4],
      end: r[4] + r[5],
      variables: vs,
      constants: constants.slice(r[3] - 1, constantEnd),
    };
  });
  const stateMachines = (md.rows[54] ?? []).map((r) => ({ moveNext: token(6, r[0]), kickoff: token(6, r[1]) }));
  for (let i = 0; i < stateMachines.length; i++) {
    const s = stateMachines[i];
    if (
      !(s.moveNext & 0xffffff) ||
      !(s.kickoff & 0xffffff) ||
      (s.moveNext & 0xffffff) > (md.externalCounts[6] ?? 0) ||
      (s.kickoff & 0xffffff) > (md.externalCounts[6] ?? 0) ||
      (i && s.moveNext <= stateMachines[i - 1].moveNext)
    )
      fail('Invalid state machine method');
  }
  if (new Set(stateMachines.map((s) => s.kickoff)).size !== stateMachines.length)
    fail('Duplicate state machine kickoff');
  const annotationBudget = {};
  const custom = (md.rows[55] ?? []).map((r, i) => {
    const parent = decodeCoded('HasCustomDebugInformation', r[0]),
      kind = guid(r[1]),
      bytes = md.blob(r[2]);
    preflightLocalAnnotation(kind, parent, bytes, md.counts, annotationBudget);
    const c = {
      id: i + 1,
      parent,
      kind,
      bytes: new Uint8Array(bytes),
    };
    Object.assign(c, readCustomDebugInformation(c.kind, c.bytes, { maxBytes, maxSourceBytes }));
    if (c.kind === PdbGuids.embeddedSource) {
      if (c.parent >>> 24 !== 48 || !documents[(c.parent & 0xffffff) - 1])
        fail('Embedded source parent is not a document');
      documents[(c.parent & 0xffffff) - 1].embedded = c.source;
    }
    return c;
  });
  attachLocalAnnotations(custom, variables, constants);
  bindConstantAnnotations(constants);
  const scopeTree = createScopeTree(scopes, md.externalCounts[6] ?? 0);
  const methodMap = new Map(methods.map((m) => [m.token, m]));
  const asyncInfo = createAsyncInfoLookup(stateMachines, custom, {
    maxAsyncEntries,
    methodCount: md.externalCounts[6] ?? 0,
  });
  return {
    format: 'Portable PDB',
    pdbOffset: pdb.byteOffset - bytes.byteOffset,
    id,
    idHex: hex(id),
    entryPoint,
    bytes: new Uint8Array(bytes),
    metadata: md,
    documents,
    methods,
    variables,
    constants,
    scopes,
    scopeTree,
    localSlots: unavailableLocalSlots(md.externalCounts[6] ?? 0),
    imports,
    effectiveImports,
    stateMachines,
    custom,
    sourceLink: custom.find((c) => c.sourceLink)?.sourceLink ?? null,
    location(methodToken, offset) {
      const points = methodMap.get(methodToken)?.points ?? [];
      let l = 0,
        r = points.length;
      while (l < r) {
        const m = (l + r) >>> 1;
        if (points[m].offset <= offset) l = m + 1;
        else r = m;
      }
      const p = points[l - 1];
      return p && !p.hidden ? { ...p, source: documents[p.document - 1]?.name } : null;
    },
    locals(methodToken, offset) {
      const active = scopes.filter((s) => s.methodToken === methodToken && offset >= s.start && offset < s.end);
      return active.flatMap((s) => s.variables).filter((v) => !v.hidden);
    },
    asyncInfo,
  };
}
