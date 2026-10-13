import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {staticSlot} from '../../../packages/runtime/src/execution/statics.js';
import {literalString} from '../../../packages/runtime/src/execution/strings.js';
import {managedFixture} from '../../managed-fixtures.js';
import {fieldReference} from './readonly-fields.js';

export const booleanFieldOwner = 'System.Boolean';
export const booleanFieldNames = Object.freeze(['TrueString', 'FalseString']);
export const booleanFieldEngines = Object.freeze(['source', 'reload', 'cil']);
export const fieldMarker = name => ({readonlyField: {owner: booleanFieldOwner, name}});

let program;
function sourceProgram() {
  program ??= compileToIL(`using System; class Program {
    static void Main() {}
    static string ReadTrue() { return Boolean.TrueString; }
    static string ReadFalse() { return Boolean.FalseString; }
  }`);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

function independentAssembly() {
  const tokens = {};
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'void', body: writer => writer.op('ret')},
    ...booleanFieldNames.map(name => ({name: 'Read' + name, result: 'string', body(writer, context) {
      tokens[name] = fieldReference(context, {owner: booleanFieldOwner, name, type: 'string'});
      writer.op('ldsfld', tokens[name]).op('ret');
    }}))
  ]});
  return {bytes, tokens};
}

/** Read the actual source constant or physical CIL static slot without making the empty Main initialize it. */
export function booleanFieldHost(engine, options = {}) {
  let vm, keys;
  if (engine === 'cil') {
    const fixture = independentAssembly();
    vm = new CilVirtualMachine(fixture.bytes, options);
    keys = fixture.tokens;
  } else {
    const compiled = sourceProgram();
    vm = new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
    keys = Object.fromEntries(booleanFieldNames.map(name => {
      const index = vm.image.constants.findIndex(value => value?.readonlyField?.owner === booleanFieldOwner &&
        value.readonlyField.name === name);
      assert(index >= 0, 'The source field must retain its provenance marker: ' + name);
      return [name, index];
    }));
  }
  return {
    vm, keys,
    read(name = 'TrueString') {
      if (engine !== 'cil') return vm.constant(keys[name]);
      const slot = staticSlot(vm, keys[name]);
      return slot ? vm.statics.get(slot.key) : null;
    },
    has(name) { return (engine === 'cil' ? vm.statics : vm.constantValues).has(keys[name]); },
    literal(text = 'True') { return literalString(vm, text); },
    stop() { vm.stop(); }
  };
}

export function assertStringInitializationReleased(host) {
  const platform = host.vm.platform;
  assert.equal(platform.synchronousHostCallbackDepth, 0);
  assert.equal(platform.stringInitializations?.depth ?? 0, 0);
  assert.equal(platform.stringInitializations?.fields.size ?? 0, 0);
  assert.equal(platform.stringInitializations?.literals.size ?? 0, 0);
  assert.equal(host.vm.heap.pins.length, 0);
}

/** Synthetic allocation observers deliberately exercise synchronous host reentry, outside native CLR semantics. */
export function observeAllocation(host, callback) {
  const heap = host.vm.heap;
  const previous = heap.allocationObserver;
  heap.allocationObserver = {allocation(bytes, growth) { callback.call(this, bytes, growth); }};
  return () => { heap.allocationObserver = previous; };
}
