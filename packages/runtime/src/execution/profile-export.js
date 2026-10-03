/** Produce the official speedscope sampled-profile JSON shape, weighted in deterministic instruction units. */
export function exportSpeedscope(profile, {name = 'SharpForge managed execution'} = {}) {
  const data = typeof profile.export === 'function' ? profile.export() : profile;
  if (data?.format !== 'SharpForge.ExecutionProfile/1') throw new TypeError('Execution profile required');
  return {$schema: 'https://www.speedscope.app/file-format-schema.json',
    name, exporter: 'SharpForge.ExecutionProfile/1', activeProfileIndex: 0,
    shared: {frames: data.methods.map(method => ({name: method.name}))},
    profiles: [{type: 'sampled', name, unit: 'none', startValue: 0, endValue: data.instructions,
      samples: data.samples.map(sample => [...sample.stack]), weights: data.samples.map(sample => sample.weight)}]};
}

/** JSON event export; this is not the binary .nettrace container format. */
export function exportRuntimeTrace(profile) {
  const data = typeof profile.export === 'function' ? profile.export() : profile;
  if (data?.format !== 'SharpForge.ExecutionProfile/1') throw new TypeError('Execution profile required');
  return {...data.events, format: 'SharpForge.RuntimeTrace/1', clock: data.clock,
    methods: data.methods.map(({id, name}) => ({id, name}))};
}
