const format = 'SharpForge.InstructionProfile/1';

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid profile ${name}`);
  return value;
}

function profileData(profile) {
  const data = typeof profile?.read === 'function' ? profile.read() : profile;
  if (data?.format !== format || data.clock !== 'instructions' ||
      !Array.isArray(data.methods) || !Array.isArray(data.samples)) {
    throw new TypeError('Instruction profile required');
  }
  count(data.instructions, 'instruction count');
  return data;
}

function sharedFrames(methods) {
  const indices = new Map();
  const frames = [];
  for (const method of methods) {
    if (!method || typeof method.name !== 'string') throw new TypeError('Invalid profile method');
    const id = count(method.id, 'method ID');
    if (indices.has(id)) throw new TypeError('Duplicate profile method ID');
    indices.set(id, frames.length);
    frames.push({name: method.name});
  }
  return {indices, frames};
}

/** Owned Speedscope sampled JSON; weights are instructions, never elapsed time. */
export function exportSpeedscope(profile, {name = 'SharpForge managed execution'} = {}) {
  if (typeof name !== 'string') throw new TypeError('Profile name must be a string');
  const data = profileData(profile);
  const {indices, frames} = sharedFrames(data.methods);
  const samples = [];
  const weights = [];
  let total = 0;
  for (const sample of data.samples) {
    if (!sample || !Array.isArray(sample.stack)) throw new TypeError('Invalid profile sample');
    const weight = count(sample.weight, 'sample weight');
    const stack = [];
    for (const id of sample.stack) {
      if (!indices.has(id)) throw new TypeError('Unknown profile sample method');
      stack.push(indices.get(id));
    }
    total = count(total + weight, 'sample total');
    samples.push(stack);
    weights.push(weight);
  }
  if (total !== data.instructions) throw new TypeError('Profile sample total does not equal its instruction count');
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    name,
    exporter: format,
    activeProfileIndex: 0,
    shared: {frames},
    profiles: [{type: 'sampled', name, unit: 'none', startValue: 0, endValue: total, samples, weights}]
  };
}
