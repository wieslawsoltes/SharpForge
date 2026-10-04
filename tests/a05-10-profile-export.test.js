import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, exportSpeedscope} from '@sharpforge/runtime';

const schema = JSON.parse(readFileSync(new URL('./fixtures/speedscope/file-format-schema.json', import.meta.url), 'utf8'));
const schemaKeys = new Set(['$ref', '$schema', 'definitions', 'title', 'type', 'properties', 'required', 'items', 'anyOf', 'const', 'enum']);

// The official pinned schema uses only these assertions. Fail closed if it grows.
function matchesSchema(value, rule = schema) {
  for (const key of Object.keys(rule)) assert(schemaKeys.has(key), `Unsupported schema keyword ${key}`);
  if (rule.$ref) {
    assert(rule.$ref.startsWith('#/definitions/'));
    matchesSchema(value, schema.definitions[rule.$ref.slice('#/definitions/'.length)]);
  }
  if (rule.anyOf) {
    assert(rule.anyOf.some(candidate => {
      try { matchesSchema(value, candidate); return true; } catch { return false; }
    }), 'No schema alternative matched');
  }
  if (Object.hasOwn(rule, 'const')) assert.equal(value, rule.const);
  if (rule.enum) assert(rule.enum.includes(value));
  if (rule.type) {
    assert.equal(Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, rule.type);
    if (rule.type === 'number') assert(Number.isFinite(value));
  }
  for (const key of rule.required ?? []) assert(Object.hasOwn(value, key), `Missing ${key}`);
  for (const [key, child] of Object.entries(rule.properties ?? {})) {
    if (Object.hasOwn(value, key)) matchesSchema(value[key], child);
  }
  if (rule.items) for (const item of value) matchesSchema(item, rule.items);
}

function profile() {
  return {format: 'SharpForge.InstructionProfile/1', clock: 'instructions', instructions: 7,
    methods: [{id: 0, name: '[runtime]'}, {id: 1, name: '[profile capacity]'}, {id: 19, name: 'Program::Recurse'}],
    samples: [{stack: [19, 19], weight: 5}, {stack: [1], weight: 2}]};
}

test('official Speedscope shape preserves names, recursion, overflow and instruction totals', () => {
  const result = exportSpeedscope(profile(), {name: 'Recursion'});
  matchesSchema(result);
  assert.equal(result.$schema, 'https://www.speedscope.app/file-format-schema.json');
  assert.equal(result.name, 'Recursion');
  assert.deepEqual(result.shared.frames.map(frame => frame.name), ['[runtime]', '[profile capacity]', 'Program::Recurse']);
  const sampled = result.profiles[0];
  assert.equal(sampled.type, 'sampled');
  assert.equal(sampled.unit, 'none');
  assert.equal(sampled.startValue, 0);
  assert.equal(sampled.endValue, 7);
  assert.equal(sampled.weights.reduce((sum, weight) => sum + weight, 0), 7);
  assert.deepEqual(sampled.samples, [[2, 2], [1]], 'method IDs are mapped to shared-frame indices');
});

test('export owns its arrays and method records and reads a profiler exactly once', () => {
  const input = profile();
  const before = JSON.stringify(input);
  let reads = 0;
  const result = exportSpeedscope({read() { reads++; return input; }});
  assert.equal(reads, 1);
  result.shared.frames[2].name = 'changed';
  result.profiles[0].samples[0][0] = 0;
  result.profiles[0].weights[0] = 999;
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => exportSpeedscope({read() { throw new Error('reader failed'); }}), /reader failed/);
});

test('zero instructions and the largest exactly representable count remain valid', () => {
  for (const instructions of [0, Number.MAX_SAFE_INTEGER]) {
    const input = profile();
    input.instructions = instructions;
    input.samples = instructions ? [{stack: [0], weight: instructions}] : [];
    if (!instructions) input.methods = [];
    const result = exportSpeedscope(input);
    matchesSchema(result);
    assert.equal(result.profiles[0].endValue, instructions);
    assert.equal(JSON.parse(JSON.stringify(result)).profiles[0].endValue, instructions);
  }
});

const invalid = [
  ['format', input => { input.format = 'SharpForge.ExecutionProfile/1'; }],
  ['duration clock', input => { input.clock = 'milliseconds'; }],
  ['negative count', input => { input.instructions = -1; }],
  ['fractional count', input => { input.instructions = 0.5; }],
  ['NaN count', input => { input.instructions = NaN; }],
  ['unsafe count', input => { input.instructions = Number.MAX_SAFE_INTEGER + 1; }],
  ['method table', input => { input.methods = null; }],
  ['sample table', input => { input.samples = {}; }],
  ['duplicate method', input => { input.methods[2].id = 1; }],
  ['negative method', input => { input.methods[2].id = -1; }],
  ['method name', input => { input.methods[2].name = null; }],
  ['missing method row', input => { delete input.methods[1]; }],
  ['unknown sample method', input => { input.samples[0].stack[0] = 3; }],
  ['non-numeric sample method', input => { input.samples[0].stack[0] = '19'; }],
  ['missing sample row', input => { delete input.samples[0]; }],
  ['missing sample stack', input => { input.samples[0].stack = null; }],
  ['negative weight', input => { input.samples[0].weight = -5; }],
  ['fractional weight', input => { input.samples[0].weight = 0.5; }],
  ['infinite weight', input => { input.samples[0].weight = Infinity; }],
  ['inconsistent total', input => { input.instructions = 8; }],
  ['overflowing total', input => { input.samples[0].weight = Number.MAX_SAFE_INTEGER; }]
];
for (const [name, mutate] of invalid) {
  test(`invalid ${name} rejects export`, () => {
    const input = profile();
    mutate(input);
    assert.throws(() => exportSpeedscope(input), TypeError);
  });
}

test('absent profiles and invalid names are explicit errors', () => {
  for (const input of [null, undefined, false, {}]) assert.throws(() => exportSpeedscope(input), /Instruction profile required/);
  assert.throws(() => exportSpeedscope(profile(), {name: 3}), /Profile name must be a string/);
});

const source = 'class Program { static int Twice(int x) { return x * 2; } static int Main() { return Twice(21); } }';
for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: real profiler export satisfies the schema and equals executed instructions`, () => {
    const artifact = compileToIL(source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const options = {profile: {sampleBudget: 2}};
    const vm = engine === 'cil' ? new CilVirtualMachine(artifact.assembly, options)
      : new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), options);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(vm.returnValue, 42);
      const data = vm.profiler.read();
      const resultProfile = exportSpeedscope(vm.profiler);
      matchesSchema(resultProfile);
      assert.equal(resultProfile.profiles[0].endValue, data.instructions);
      assert.equal(data.instructions, result.stats.instructions);
      assert.equal(resultProfile.profiles[0].weights.reduce((sum, weight) => sum + weight, 0), data.instructions);
      assert(resultProfile.shared.frames.some(frame => frame.name.includes('Twice')));
      vm.stop();
      assert.deepEqual(exportSpeedscope(vm.profiler), resultProfile, 'stopped profiles remain readable');
    } finally { vm.stop(); }
  });
}
