import { AssemblyInspector, CorFlags, inspectPE, readPE, readPEDebugDirectory } from '@sharpforge/cil';
import { readDebugDirectory } from '@sharpforge/symbols';
import { peFixture, codeView } from './input.mjs';
import { compareReference } from './comparison.mjs';

/** Browser replay takes optional exact cache bytes explicitly; it never downloads or embeds a reference image. */
export function run({ references = [] } = {}) {
  let checks = 0;
  const equal = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`PE browser mismatch: ${label}`);
    checks++;
  };
  const rejects = (action, label) => {
    let error;
    try { action(); } catch (value) { error = value; }
    if (!error) throw new Error(`PE browser expected rejection: ${label}`);
    checks++;
  };
  for (const [platform, format] of [['anycpu', 'PE32'], ['x64', 'PE32+']]) {
    const { bytes } = peFixture({ platform, certificate: new Uint8Array([1, 2, 3, 4]) });
    const result = inspectPE(bytes);
    equal(result.headers.optional.format, format, 'optional-header format');
    equal(result.directories[4].addressKind, 'file-offset', 'certificate address kind');
    const snapshot = JSON.stringify(result);
    bytes.fill(0);
    equal(JSON.stringify(result), snapshot, 'owned PE output');
  }
  const r2r = peFixture({ imageKind: 'ReadyToRun', corFlags: CorFlags.ILLibrary | CorFlags.StrongNameSigned });
  const inspector = new AssemblyInspector(r2r.bytes);
  equal(inspectPE(r2r.bytes).imageKind, 'ReadyToRun', 'R2R classification');
  equal(inspector.getMethod(r2r.tokens.Managed).instructions.map(value => value.name), ['ret'], 'retained R2R CIL');
  equal(inspectPE(r2r.bytes).nativeCode.disassembly, 'unsupported', 'native disassembly boundary');
  rejects(() => inspector.summary({ includePE: true, signal: AbortSignal.abort() }), 'summary cancellation');
  for (const implFlags of [1, 2, 3, 4]) {
    const native = peFixture({ imageKind: 'MixedMode', methods: [{ name: 'Native', implFlags, rva: 0xffff0000 }] });
    const method = new AssemblyInspector(native.bytes).getMethod(native.tokens.Native);
    equal(method.disassembly.status, 'not-disassembled', 'non-CIL admission');
    equal(method.instructions.length, 0, 'non-CIL instruction output');
  }
  const debug = peFixture({ debug: [{ kind: 2, bytes: codeView('browser.pdb'), minor: 0x504d }] });
  equal(readDebugDirectory(debug.bytes)[0].path, 'browser.pdb', 'symbols shared raw reader');
  const raw = readPEDebugDirectory(readPE(debug.bytes));
  const payload = [...raw[0].bytes];
  debug.bytes.fill(0, raw[0].offset);
  equal([...raw[0].bytes], payload, 'owned debug payload');
  rejects(() => inspectPE(r2r.bytes, { maxBytes: r2r.bytes.length - 1 }), 'input byte limit');
  rejects(() => inspectPE(r2r.bytes, { signal: AbortSignal.abort() }), 'PE cancellation');
  const observations = references.map(({ id, bytes, native }) => {
    const result = compareReference(bytes, native);
    equal(result.differences, [], `actual native reference ${id}`);
    return { id, comparisons: result.comparisons, counts: result.counts };
  });
  return { status: 'pass', checks, groups: ['headers', 'ownership', 'image-kind', 'method-admission', 'debug', 'limits-cancellation'],
    nativeReferences: { status: observations.length ? 'pass' : 'not-run', observations } };
}
