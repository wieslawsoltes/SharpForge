import {
  MetadataBuilder,
  Writer,
  encodeSignature,
  writeMethodBody,
  writePE,
  formatSignatureType,
} from '@sharpforge/cil';
import { loadSymbols, readPortablePdb, emitPortablePdb, attachPortablePdb, PdbGuids } from '@sharpforge/symbols';
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const equal = (actual, expected, label) => {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) throw Error(label + ': values differ');
};
const rejects = (operation, expression) => {
  try {
    operation();
  } catch (error) {
    if (expression.test(error.message)) return;
    throw error;
  }
  throw Error('Expected rejection ' + expression);
};
async function corpus(directory, stem) {
  const base = '/tests/fixtures/' + directory + '/';
  const bytes = async (name) => {
    const response = await fetch(base + name);
    if (!response.ok) throw Error('Fixture request failed: ' + name);
    return new Uint8Array(await response.arrayBuffer());
  };
  const reference = await (await fetch(base + 'reference.json')).json();
  const assembly = await bytes(stem + '.dll'),
    pdb = await bytes(stem + '.pdb');
  return { reference: reference.native, symbols: loadSymbols(assembly, pdb), assembly, pdb };
}
function annotated() {
  const metadata = new MetadataBuilder('BrowserAnnotations');
  const types = [
    { kind: 'primitive', name: 'object' },
    {
      kind: 'genericInstance',
      type: { kind: 'valuetype', token: metadata.typeRef('System.ValueTuple`2') },
      arguments: [
        { kind: 'primitive', name: 'int' },
        { kind: 'primitive', name: 'string' },
      ],
    },
  ];
  const signature = metadata.add(17, [metadata.blob(encodeSignature({ kind: 'locals', types }))]);
  metadata.add(2, [1, metadata.string('Fixture'), 0, 0, 1, 1]);
  metadata.add(6, [0x2048, 0, 0x16, metadata.string('Run'), metadata.blob(new Uint8Array([0, 0, 1])), 1]);
  const bytes = metadata.finish(),
    body = writeMethodBody(new Uint8Array([0x2a]), signature, 1);
  const section = new Writer().zero(72).bytes(body).pad(),
    offset = section.length;
  section.bytes(bytes);
  const assembly = writePE(section.finish(), offset, bytes.length, 0);
  const pdb = emitPortablePdb(assembly, {
    methods: [
      {
        token: 0x06000001,
        scopes: [
          {
            start: 0,
            end: 1,
            locals: [
              { slot: 0, name: 'd' },
              { slot: 1, name: 'pair' },
            ],
            constants: [{ name: 'C', type: 'object', value: null }],
          },
        ],
      },
    ],
    custom: [
      { kind: PdbGuids.dynamicLocals, parent: 0x33000001, flags: [true] },
      { kind: PdbGuids.tupleNames, parent: 0x33000002, names: ['a', 'b'] },
      { kind: PdbGuids.dynamicLocals, parent: 0x34000001, flags: [true] },
    ],
  }).bytes;
  return loadSymbols(attachPortablePdb(assembly, pdb), pdb);
}
export async function run() {
  const checks = [];
  const imports = await corpus('portable-pdb-effective-imports', 'EffectiveImports');
  equal(
    imports.symbols
      .effectiveImports(imports.reference.importScope)
      .map(({ kind, scopeId, alias = null, namespace = null, type = null, typeName = null }) => ({
        kind,
        scopeId,
        alias,
        namespace,
        type,
        typeName,
      })),
    imports.reference.entries,
    'native imports',
  );
  const original = imports.symbols.effectiveImports(imports.reference.importScope);
  imports.symbols.imports.length = 0;
  equal(imports.symbols.effectiveImports(imports.reference.importScope), original, 'owned imports');
  rejects(() => imports.symbols.effectiveImports(-1), /scope id/);
  checks.push('native effective imports', 'import ownership/invalid scope');
  const scopes = await corpus('portable-pdb-scope-tree', 'ScopeTree');
  const project = ({ locals, children, ...scope }) => ({
    ...scope,
    locals: locals.map(({ type, typeReason, ...local }) => local),
    children: children.map(project),
  });
  equal(scopes.symbols.scopeTree(scopes.reference.method).map(project), scopes.reference.roots, 'native scope tree');
  const tree = scopes.symbols.scopeTree(scopes.reference.method);
  const originalTreeTypes = structuredClone(tree);
  tree[0].locals[0].type.name = 'changed';
  equal(scopes.symbols.scopeTree(scopes.reference.method), originalTreeTypes, 'owned tree type AST');
  equal(scopes.symbols.scopeTree(scopes.reference.method).map(project), scopes.reference.roots, 'owned tree');
  rejects(() => scopes.symbols.scopeTree(-1), /method token/);
  checks.push('native typed scope tree', 'scope ownership/invalid method');
  const annotations = annotated(),
    locals = annotations.scopeTree(0x06000001)[0].locals;
  equal(
    locals.map((value) => value.displayTypeName),
    ['dynamic', '(int a, string b)'],
    'source displays',
  );
  equal(annotations.scopeTree(0x06000001)[0].constantAnnotations[0].displayTypeName, 'dynamic', 'constant display');
  locals[1].tupleElementNames[0] = 'changed';
  equal(annotations.scopeTree(0x06000001)[0].locals[1].tupleElementNames, ['a', 'b'], 'owned annotations');
  rejects(
    () =>
      formatSignatureType({ kind: 'primitive', name: 'object' }, null, {
        formatType: (node, child) => child(node),
        maxNodes: 2,
      }),
    /complexity limit/,
  );
  checks.push('authored dynamic/tuple/constant joins', 'annotation ownership/shared formatter budget');
  const slots = await corpus('portable-pdb-unnamed-slots', 'UnnamedSlots');
  for (const method of slots.reference.methods) {
    equal(
      slots.symbols.localSlots(method.token).slots.map(({ type, ...slot }) => slot),
      method.slots,
      'release slots',
    );
    for (const slot of slots.symbols.localSlots(method.token).slots)
      if (slot.unnamed) equal(slot.name, null, 'unnamed identity');
  }
  const method = slots.reference.methods.find((value) => value.name === 'Sum');
  const result = slots.symbols.localSlots(method.token);
  const originalSlotTypes = structuredClone(result);
  result.slots[0].type.name = 'changed';
  equal(slots.symbols.localSlots(method.token), originalSlotTypes, 'owned slot type AST');
  equal(
    slots.symbols.localSlots(method.token).slots.map(({ type, ...slot }) => slot),
    method.slots,
    'owned slot facts',
  );
  equal(
    readPortablePdb(slots.pdb).localSlots(method.token),
    { available: false, reason: 'type-metadata-required', slots: [] },
    'unbound slots',
  );
  rejects(() => loadSymbols(slots.assembly, slots.pdb, { maxLocalSlots: 0 }), /aggregate limit/);
  rejects(() => loadSymbols(slots.assembly, slots.pdb, { signal: AbortSignal.abort() }), /cancelled/);
  checks.push('Release native unnamed slots/no invented names', 'slot ownership/unbound/bounds/cancellation');
  return { passed: true, checks };
}
