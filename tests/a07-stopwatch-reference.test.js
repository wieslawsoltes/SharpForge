import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {findContracts, frameworkType} from '@sharpforge/framework';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {formatTimeSpanTicks} from '../packages/bcl-core/src/time/time-span-format.js';
import {stopwatchPlatform, stopwatchContract, stopwatchElapsedAssembly, stopwatchStateAssembly, stopwatchType} from './fixtures/stopwatch.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('stopwatch-net10.json', directory), 'utf8'));
const typeName = name => ({'System.Int64': 'long', 'System.Boolean': 'bool', 'System.String': 'string', 'System.Void': 'void'}[name] ?? name);

function assertElapsed(platform, reference, row) {
  const label = row.start + ':' + row.end;
  assert.equal(platform.get(reference, '$ticks'), BigInt(row.ticks), label);
  for (const [property, expected] of [['TotalMilliseconds', row.totalMilliseconds], ['TotalSeconds', row.totalSeconds]]) {
    const value = platform.invoke(findContracts('System.TimeSpan', 'get_' + property)[0], [reference]);
    assert.equal(platform.native(value), Number(expected), label + ':' + property);
  }
}

for (const engine of ['source', 'cil']) {
  test(`Stopwatch ${engine}: every native signed, precise, rounded and wrapping delta matches exact ticks and totals`, () => {
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => { throw new Error('Two-argument deltas must not read the clock'); }});
    try {
      for (const row of native.rows) {
        const value = watch.staticCall('GetElapsedTime', ['long', 'long'], [BigInt(row.start), BigInt(row.end)]);
        assertElapsed(watch.platform, value, row);
        assert.equal(formatTimeSpanTicks(BigInt(row.ticks)), row.text, row.start + ':' + row.end);
      }
    } finally { watch.stop(); }
  });

  test(`Stopwatch ${engine}: ToString formats stopped counters against every reachable native duration row`, () => {
    for (const row of native.rows.filter(value => value.start === '0' && BigInt(value.end) >= 0n)) {
      let now = 0n;
      const watch = stopwatchPlatform(engine, {stopwatchClock: () => now});
      try {
        watch.call('Start'); now = BigInt(row.end); watch.call('Stop');
        assert.equal(watch.call('get_ElapsedTicks'), BigInt(row.end));
        assert.equal(watch.call('get_ElapsedMilliseconds'), BigInt(row.ticks) / 10_000n);
        assert.equal(watch.platform.native(watch.call('ToString')), row.text);
      } finally { watch.stop(); }
    }
  });
}

test('Stopwatch independent CIL: ordinary Int64 calls match all 54 native duration rows', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(stopwatchElapsedAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assertElapsed(vm.platform, vm.statics.get(0x04000001), row);
    } finally { vm.stop(); }
  }
});

test('Stopwatch independent CIL: constructor, state methods, properties and static factories dispatch without a source profile', () => {
  let now = 0n;
  const vm = new CilVirtualMachine(stopwatchStateAssembly(), {stopwatchClock: () => {
    const result = now; now += 1_500_000_000n; return result;
  }});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(vm.statics.get(0x04000002), 1_500_000_000n);
    assert.equal(vm.statics.get(0x04000003), 1500n);
    assert.equal(vm.platform.get(vm.statics.get(0x04000004), '$ticks'), 15_000_000n);
    assert.equal(Boolean(vm.statics.get(0x04000005)), false);
    assert.equal(vm.platform.native(vm.statics.get(0x04000006)), '00:00:01.5000000');
    assert.equal(vm.statics.get(0x04000007), 9_000_000_000n);
    assert.equal(vm.platform.get(vm.statics.get(0x04000008), '$ticks'), 105_000_000n);
  } finally { vm.stop(); }
});

test('Stopwatch public inventory exactly preserves native methods, properties and genuine readonly fields', () => {
  const type = frameworkType(stopwatchType);
  for (const row of native.metadata) {
    if (row.kind === 'field') {
      const field = type.fields[row.name];
      assert.equal(field.type, typeName(row.result));
      assert.equal(field.isStatic, row.isStatic);
      assert.equal(field.readOnly, row.readOnly);
      assert.equal(row.literal, false);
      assert.equal(row.owner, stopwatchType);
      assert.equal(type.properties[row.name], undefined);
      assert.equal(findContracts(stopwatchType, 'get_' + row.name).length, 0);
    } else if (row.kind === 'property') {
      assert.equal(type.properties[row.name].type, typeName(row.result));
      assert.equal(type.properties[row.name].readOnly, row.readOnly);
    } else {
      const descriptor = stopwatchContract(row.name, row.parameters.map(typeName));
      assert.equal(descriptor.isStatic, row.isStatic);
      assert.equal(descriptor.result, row.kind === 'constructor' ? stopwatchType : typeName(row.result));
    }
  }
  const ids = native.metadata.filter(row => ['method', 'constructor'].includes(row.kind))
    .map(row => stopwatchContract(row.name, row.parameters.map(typeName)).id).sort((a, b) => a - b);
  assert.equal(ids.length, 14);
  assert.deepEqual(ids, Array.from({length: 14}, (_, index) => ids[0] + index));
  assert.equal(stopwatchContract('ToString').objectToStringOverride, true);
  assert.equal(native.metadata.length, 20);
  assert.equal(native.rows.length, 54);
  assert.equal(native.frequency, '1000000000');
  assert.equal(native.isHighResolution, true);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.deepEqual(native.assemblyIdentity, {name: 'System.Private.CoreLib', version: '10.0.0.0', culture: '',
    publicKeyToken: '7cec85d7bea7798e'});
  const source = readFileSync(new URL('stopwatch/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
  const capture = readFileSync(new URL('stopwatch-net10.json', directory));
  assert.equal(createHash('sha256').update(capture).digest('hex'),
    '3a439b28426a63673ddeaa20bf3ea111e809d6a26f2a56d69ca94c18ae81bfff');
  for (const [name, value] of Object.entries(native.observations)) {
    assert.equal(value, name.endsWith('Text') ? '00:00:00' : true, name);
  }
});
