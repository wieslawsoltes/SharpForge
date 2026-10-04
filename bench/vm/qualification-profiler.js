import {microbenchmarks} from './fixtures.js';

const engines = ['source', 'cil'];
const fixtures = microbenchmarks.filter(fixture => ['arith', 'calls', 'allocation'].includes(fixture.id));
const rowId = (engine, fixture, enabled) => `profiler-${enabled ? 'on' : 'off'}-${engine}-${fixture.id}`;

export const requiredProfilerRows = Object.freeze(engines.flatMap(engine => fixtures.map(fixture => rowId(engine, fixture, false))));

/** Select complete off/on groups without changing any fixture, option, threshold, or default pair order. */
export function selectProfilerDefinitions(mode = 'both', referenceApi = null) {
  if (!['both', 'off', 'on'].includes(mode)) throw new TypeError('Invalid profiler mode');
  const enabledModes = mode === 'both' ? [false, true] : [mode === 'on'];
  return engines.flatMap(engine => fixtures.flatMap(fixture => enabledModes.map(enabled => ({
    id: rowId(engine, fixture, enabled), issue: 1402, engine, fixture, required: !enabled,
    baselineOptions: {profile: false}, candidateOptions: {profile: enabled ? {sampleBudget: 256} : false},
    ...(enabled ? {} : {baselineRuntime: referenceApi, target: {kind: 'maximum-overhead', value: 0.01}}),
    note: enabled ? 'Enabled profiler compared to product profiling-off mode; observed overhead only.'
      : 'Product profiling-off mode compared to its exact-parent reviewed hook-free reference.'
  }))));
}

/** Coverage distinguishes measured required-off results from separately observed enabled overhead. */
export function profilerCoverage(rows, mode = 'both') {
  const definitions = selectProfilerDefinitions('both');
  const selected = new Set(selectProfilerDefinitions(mode).map(definition => definition.id));
  const measured = new Set(rows.filter(row => row.status === 'measured').map(row => row.id));
  const coverage = required => {
    const expected = definitions.filter(definition => definition.required === required).map(definition => definition.id);
    return {expected, measured: expected.filter(id => measured.has(id)),
      missing: expected.filter(id => !measured.has(id)), omitted: expected.filter(id => !selected.has(id))};
  };
  const off = coverage(true), on = coverage(false);
  return {mode, requiredOff: off, enabledOverhead: on,
    complete: off.missing.length === 0 && on.missing.length === 0,
    scope: 'Acceptance covers all six required profiling-off comparisons; enabled overhead is separately reported.'};
}
