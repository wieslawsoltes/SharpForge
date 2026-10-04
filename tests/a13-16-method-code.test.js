import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, AssemblyUsageAnalysis, CilError, CorFlags, inspectPE, methodCodeKind,
  readPE, readMethodHeader } from '@sharpforge/cil';
import { PortablePdbBuilder, attachPortablePdb, loadSymbols } from '@sharpforge/symbols';
import { peFixture } from './fixtures/pe-inspection/input.mjs';
import { productFacts } from './fixtures/pe-inspection/comparison.mjs';

const implementations = [[0, 'CIL'], [1, 'Native'], [2, 'OPTIL'], [3, 'Runtime'], [4, 'UnmanagedIL']];

test('method implementation classification separates code kind from method optimization flags', () => {
  for (const [flags, name] of implementations) {
    assert.equal(methodCodeKind(flags), name);
    assert.equal(methodCodeKind(flags | 0x108), name);
  }
  for (const flags of [-1, 0x10000, 0.5, null, '0']) assert.throws(() => methodCodeKind(flags), CilError);
});

test('native, OPTIL, Runtime and unmanaged IL RVAs never reach the CIL header decoder', () => {
  const { bytes, tokens } = peFixture({ imageKind: 'MixedMode',
    methods: implementations.map(([implFlags, name]) => ({ name, implFlags, ...(implFlags ? { rva: 0xffff0000 } : {}) })) });
  const inspector = new AssemblyInspector(bytes);
  const originalOffsetOf = inspector.pe.offsetOf;
  inspector.pe.offsetOf = (rva, length) => {
    assert.notEqual(rva, 0xffff0000, 'non-CIL RVA was interpreted as a managed body');
    return originalOffsetOf(rva, length);
  };
  for (const [, name] of implementations.slice(1)) {
    const method = inspector.getMethod(tokens[name]);
    assert.equal(method.codeKind, name);
    assert.equal(method.hasBody, false);
    assert.equal(method.rva, 0xffff0000);
    assert.equal(method.disassembly.status, 'not-disassembled');
    assert.match(method.disassembly.reason, /not CIL/);
    assert.deepEqual(method.instructions, []);
    assert.throws(() => readMethodHeader(inspector.pe, tokens[name]), /not disassembled as CIL/);
    assert.throws(() => inspector.pe.methodBody(tokens[name]), /not disassembled as CIL/);
  }
  assert.equal(inspector.getMethod(tokens.CIL).instructions[0].name, 'ret');
  for (const includeMethods of [true, false]) {
    const methods = inspector.summary({ includeMethods }).methods;
    assert.deepEqual(methods.map(method => method.codeKind), implementations.map(([, name]) => name));
    assert.ok(methods.slice(1).every(method => method.disassembly.status === 'not-disassembled'));
  }
  const graph = new AssemblyUsageAnalysis(inspector);
  assert.deepEqual(graph.diagnostics, implementations.slice(1).map(([, name]) => ({ token: tokens[name], reason: 'non-cil-method' })));
});

test('authored R2R markers retain actual CIL bodies even when ILOnly is unset', () => {
  const { bytes, tokens } = peFixture({ imageKind: 'ReadyToRun', corFlags: CorFlags.ILLibrary | CorFlags.StrongNameSigned });
  const result = inspectPE(bytes);
  assert.equal(result.imageKind, 'ReadyToRun');
  assert.equal(result.cli.flags.value & CorFlags.ILOnly, 0);
  assert.equal(result.nativeCode.indicated, true);
  assert.equal(result.nativeCode.disassembly, 'unsupported');
  assert.deepEqual(result.nativeCode.indicators, ['ILOnly-unset', 'managed-native-header']);
  const inspector = new AssemblyInspector(bytes);
  const method = inspector.getMethod(tokens.Managed);
  assert.equal(method.hasBody, true);
  assert.equal(method.codeKind, 'CIL');
  assert.equal(method.disassembly.status, 'available');
  assert.deepEqual(method.instructions.map(instruction => instruction.name), ['ret']);
  assert.equal(inspector.getMethod(tokens.Managed), method);
  assert.throws(() => readPE(bytes), /Only IL-only/);
});

test('authored image indicators distinguish IL-only, mixed mode, other managed-native and native entry points', () => {
  for (const imageKind of ['MixedMode', 'ManagedNative']) {
    const result = inspectPE(peFixture({ imageKind }).bytes);
    assert.equal(result.imageKind, imageKind);
    assert.equal(result.nativeCode.indicated, true);
    assert.equal(result.nativeCode.disassembly, 'unsupported');
  }
  assert.equal(inspectPE(peFixture().bytes).nativeCode.indicated, false);
  const { bytes, tokens } = peFixture({ corFlags: CorFlags.NativeEntryPoint, entryPoint: 0x06000001 });
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.getMethod(tokens.Managed).isEntryPoint, false);
  assert.deepEqual(inspectPE(bytes).cli.entryPoint, { kind: 'native-rva', value: tokens.Managed });
  assert.deepEqual(inspectPE(bytes).nativeCode.indicators, ['ILOnly-unset', 'native-entry-point']);
});

test('absent managed and runtime bodies remain metadata facts without fabricated empty IL bodies', () => {
  const { bytes, tokens } = peFixture({ methods: [{ name: 'Abstract', noBody: true }, { name: 'Runtime', implFlags: 3, noBody: true }] });
  const inspector = new AssemblyInspector(bytes);
  assert.equal(readMethodHeader(inspector.pe, tokens.Abstract), null);
  assert.equal(readMethodHeader(inspector.pe, tokens.Runtime), null);
  assert.equal(inspector.getMethod(tokens.Abstract).disassembly.status, 'absent');
  assert.equal(inspector.getMethod(tokens.Runtime).disassembly.status, 'not-disassembled');
});

test('eligible but unreadable CIL retains failure facts instead of a successful empty body', () => {
  const { bytes } = peFixture({ methods: [{ name: 'Unreadable', rva: 0xffff0000 }] });
  const actual = productFacts(bytes).methods[0];
  assert.equal(actual.codeKind, 'CIL');
  assert.equal(actual.hasCilBody, true);
  assert.equal(actual.body, null);
  assert.equal(actual.bodyError, true);
  const method = new AssemblyInspector(bytes).summary().methods[0];
  assert.equal(method.codeKind, 'CIL');
  assert.equal(method.disassembly.status, 'unavailable');
  assert.match(method.error, /RVA/);
});

test('bound PDB local slots preserve unsupported-method diagnostics for all non-CIL kinds', () => {
  const { bytes, tokens } = peFixture({ imageKind: 'MixedMode',
    methods: implementations.map(([implFlags, name]) => ({ name, implFlags })) });
  const pe = readPE(bytes, { inspection: true });
  const builder = new PortablePdbBuilder();
  for (const method of implementations) builder.add(49, [0, 0]);
  const pdb = builder.finish(pe.metadata.counts, 0).bytes;
  const symbols = loadSymbols(attachPortablePdb(bytes, pdb), pdb);
  assert.equal(symbols.localSlots(tokens.CIL).available, true);
  for (const [, name] of implementations.slice(1)) assert.deepEqual(symbols.localSlots(tokens[name]), {
    available: false, reason: 'unsupported-method-body', slots: [],
  });
});
