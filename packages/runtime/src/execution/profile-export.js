/** Speedscope samples explicitly select deterministic instruction weights or observed elapsed milliseconds. */
export function exportSpeedscope(profile, {name = 'SharpForge managed execution', metric = 'instructions'} = {}) {
  const data = typeof profile.export === 'function' ? profile.export() : profile;
  if (data?.format !== 'SharpForge.ExecutionProfile/1') throw new TypeError('Execution profile required');
  if (metric !== 'instructions' && metric !== 'duration') throw new TypeError('Unknown profile metric');
  const duration = metric === 'duration';
  if (duration && !data.duration?.enabled) throw new TypeError('Duration sampling was disabled');
  return {$schema: 'https://www.speedscope.app/file-format-schema.json',
    name, exporter: 'SharpForge.ExecutionProfile/1', activeProfileIndex: 0,
    shared: {frames: data.methods.map(method => ({name: method.name}))},
    profiles: [{type: 'sampled', name, unit: duration ? 'milliseconds' : 'none', startValue: 0,
      endValue: duration ? data.duration.totalMilliseconds : data.instructions,
      samples: data.samples.map(sample => [...sample.stack]),
      weights: data.samples.map(sample => duration ? sample.milliseconds : sample.weight)}]};
}

/** JSON event export; this is not the binary .nettrace container format. */
export function exportRuntimeTrace(profile) {
  const data = typeof profile.export === 'function' ? profile.export() : profile;
  if (data?.format !== 'SharpForge.ExecutionProfile/1') throw new TypeError('Execution profile required');
  return {...data.events, format: 'SharpForge.RuntimeTrace/1', clock: data.clock,
    methods: data.methods.map(({id, name}) => ({id, name}))};
}
