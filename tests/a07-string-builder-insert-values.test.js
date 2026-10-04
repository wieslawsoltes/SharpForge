import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector} from '@sharpforge/cil';
import {disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, builderType, units} from './fixtures/string-builder/append-char.js';
import {
  insertionValueTypes, boxedInsertionTypes, insertValueParameters, builderInsertValuesSource,
  insertValuesExpectedOutput, insertValueBatches, builderInsertValuesAssembly, insertionValuesFluentSource
} from './fixtures/string-builder/insert-values.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-insert-values-net10.json', directory), 'utf8'));
const scalarRows = native.rows.filter(row => row.input.type !== 'probe');
const probeRows = native.rows.filter(row => row.input.type === 'probe');
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const programs = new Map();

function compile(source, pipeline, label) {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System;using System.Text;' + source, {pipeline});
    assert.equal(program.success, true, label + ': ' + JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}

function sourceSelection(program, rows) {
  const descriptor = builderContract('Insert', insertValueParameters(rows[0].overload));
  const expected = frameworkBuiltin(descriptor).id;
  const builtins = disassemble(program.image).flatMap(method => method.instructions)
    .filter(instruction => instruction.op === 'BUILTIN').map(instruction => instruction.a);
  assert.equal(builtins.filter(id => id === expected).length, rows.length, rows[0].id + ': exact source overload');
  if (rows.some(row => row.overload === 'object' && boxedInsertionTypes[row.input.type])) {
    const bridge = findContracts('SharpForge.Runtime.Formatting', 'BoxValue', true)[0];
    assert(builtins.includes(frameworkBuiltin(bridge).id), rows[0].id + ': declared primitive boxing bridge');
  }
}

function runSourceRows(rows, pipeline, create) {
  for (const batch of insertValueBatches(rows)) {
    const label = batch[0].id + ' through ' + batch.at(-1).id;
    const program = compile(builderInsertValuesSource(batch), pipeline, label);
    sourceSelection(program, batch);
    const vm = create(program);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', label + ': ' + result.fault?.stack);
      assert.equal(result.output, insertValuesExpectedOutput(batch), label);
    } finally { vm.stop(); }
  }
}

function fault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) {
    assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  }
}

function builderState(vm, row) {
  const reference = vm.statics.get(0x04000001);
  if (row.after === null) {
    assert.equal(reference, null, row.id);
    return;
  }
  const {platform} = vm;
  const actual = platform.native(platform.invoke(builderContract('ToString'), [reference]));
  assert.deepEqual(units(actual), row.after.text, row.id);
  assert.equal(platform.invoke(builderContract('get_Length'), [reference]), row.after.length, row.id);
  assert.equal(platform.invoke(builderContract('get_MaxCapacity'), [reference]), row.after.maxCapacity, row.id);
}

function normalizedType(type) {
  return type.replace(/^valuetype /, '').replace(/^System\.Decimal$/, 'decimal');
}

function exactMemberRef(inspector, row) {
  const calls = inspector.callGraph().filter(call => call.callee).map(call => ({...call, member: inspector.resolveToken(call.callee)}));
  const insertion = calls.filter(call => call.member.owner === builderType && call.member.name === 'Insert');
  assert.equal(insertion.length, 1, row.id);
  const call = insertion[0];
  assert.equal(call.kind, 'callvirt', row.id);
  assert.equal(call.callee >>> 24, 0x0a, row.id + ': independent MemberRef');
  assert.equal(call.member.signature.isStatic, false, row.id);
  assert.equal(call.member.signature.returnType, builderType, row.id);
  assert.deepEqual(call.member.signature.parameters.map(normalizedType), insertValueParameters(row.overload), row.id);
  if (row.overload === 'object' && boxedInsertionTypes[row.input.type]) {
    const main = inspector.getMethod(inspector.pe.entryPoint);
    const boxes = main.instructions.filter(instruction => instruction.name === 'box');
    assert.equal(boxes.length, 1, row.id);
    assert.equal(inspector.metadata.typeName(boxes[0].operand), boxedInsertionTypes[row.input.type], row.id);
  }
}

for (const pipeline of ['bound', 'legacy']) {
  for (const [engine, create] of Object.entries(engines)) {
    test(`StringBuilder.Insert values ${pipeline}/${engine}: every non-probe native row preserves typed selection and post-state`, () => {
      runSourceRows(scalarRows, pipeline, create);
    });

    test(`StringBuilder.Insert object ${pipeline}/${engine}: virtual null/text/throwing overrides and reentrant edits match native`, () => {
      runSourceRows(probeRows, pipeline, create);
    });

    test(`StringBuilder.Insert values ${pipeline}/${engine}: receiver, index and numeric value evaluate once in order`, () => {
      const program = compile(insertionValuesFluentSource, pipeline, 'fluent insertion');
      const vm = create(program);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, native.fluent.calls + '\n' + String.fromCharCode(...native.fluent.text) + '\n' +
          native.fluent.length + '\n' + (native.fluent.identity ? 'True' : 'False') + '\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder.Insert values: independent CIL covers every non-probe native row and every exact CLR signature', () => {
  for (const row of scalarRows) {
    const assembly = builderInsertValuesAssembly(row);
    const inspector = new AssemblyInspector(assembly);
    exactMemberRef(inspector, row);
    const vm = new CilVirtualMachine(inspector);
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) fault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), row.identity, row.id);
      builderState(vm, row);
      const value = vm.statics.get(0x04000003);
      if (row.overload === 'object' && boxedInsertionTypes[row.input.type]) {
        const box = vm.heap.get(value);
        assert.equal(box.kind, 'box', row.id);
        assert.equal(box.methodTable.name, boxedInsertionTypes[row.input.type], row.id);
      }
      if (row.input.type === 'char[]' && row.input.units !== null) {
        assert.deepEqual(vm.heap.get(value).data, row.input.units, row.id + ': input array remains unchanged');
      }
    } finally { vm.stop(); }
  }
});

test('StringBuilder.Insert values: native provenance, complete overload corpus and append-only ABI remain pinned', () => {
  const source = readFileSync(new URL('string-builder-insert-values/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.sourceSha256, 'bf7c78f85a0118094da0fd3cf7430207e6ba3f5b554bfa4b7725c031e24f7578');
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 546);
  assert.equal(new Set(native.rows.map(row => row.id)).size, native.rows.length);
  assert.deepEqual([...new Set(native.rows.map(row => row.overload))].sort(), ['string', ...insertionValueTypes].sort());
  assert.equal(scalarRows.length + probeRows.length, native.rows.length);
  assert(probeRows.some(row => row.input.scalar === 'throw'));
  assert(probeRows.some(row => row.input.scalar === 'append'));
  assert(probeRows.some(row => row.input.scalar === 'clear'));
  assert(probeRows.some(row => row.input.units === null));
  assert(probeRows.some(row => row.input.units?.length === 0));
  assert.equal(builderContract('Insert', ['int', 'string']).id, 814);
  assert.equal(builderContract('Insert', ['int', 'char']).id, 524336);
  assert.equal(builderContract('Insert', ['int', 'bool']).id, 524338);
  assert.equal(builderContract('Insert', ['int', 'string', 'int']).id, 524339);
  for (const [offset, type] of insertionValueTypes.entries()) {
    assert.equal(builderContract('Insert', insertValueParameters(type)).id, 524340 + offset, type);
  }
});
