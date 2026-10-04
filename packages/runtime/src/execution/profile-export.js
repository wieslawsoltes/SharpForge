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

function milliseconds(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid profile ${name}`);
  return value;
}

function capturedDuration(data) {
  const duration = data.duration;
  if (duration?.enabled !== true || duration.clock !== 'monotonic' || duration.unit !== 'milliseconds') {
    throw new TypeError('Captured monotonic millisecond duration required');
  }
  milliseconds(duration.totalMilliseconds, 'duration total');
  count(duration.intervals, 'duration interval count');
  if (duration.intervals === 0 && (duration.totalMilliseconds !== 0 || data.instructions !== 0 || data.samples.length !== 0)) {
    throw new TypeError('Profile duration has no captured intervals');
  }
  return duration;
}

function validateDurationTotal(duration, total, sampleCount) {
  const captured = duration.totalMilliseconds;
  if (total === captured) return;
  // Grouping intervals by stack changes floating-point addition order. Allow
  // bounded relative roundoff without rewriting either weights or the total.
  const tolerance = Math.min(4 * Number.EPSILON * (duration.intervals + sampleCount + 1), 1e-9);
  if (total === 0 || captured === 0 || Math.abs(total - captured) / Math.max(total, captured) > tolerance) {
    throw new TypeError('Profile duration samples do not equal the captured total');
  }
}

/** Owned Speedscope JSON with instruction weights by default, or explicitly selected captured elapsed milliseconds. */
export function exportSpeedscope(profile, {name = 'SharpForge managed execution', metric = 'instructions'} = {}) {
  if (typeof name !== 'string') throw new TypeError('Profile name must be a string');
  if (metric !== 'instructions' && metric !== 'duration') throw new TypeError('Unknown profile metric');
  const data = profileData(profile);
  const duration = metric === 'duration' ? capturedDuration(data) : null;
  const {indices, frames} = sharedFrames(data.methods);
  const samples = [];
  const weights = [];
  let total = 0;
  let elapsed = 0;
  for (const sample of data.samples) {
    if (!sample || !Array.isArray(sample.stack)) throw new TypeError('Invalid profile sample');
    const weight = count(sample.weight, 'sample weight');
    const exportedWeight = duration ? milliseconds(sample.milliseconds, 'sample duration') : weight;
    const stack = [];
    for (const id of sample.stack) {
      if (!indices.has(id)) throw new TypeError('Unknown profile sample method');
      stack.push(indices.get(id));
    }
    total = count(total + weight, 'sample total');
    if (duration) elapsed = milliseconds(elapsed + exportedWeight, 'sample duration total');
    samples.push(stack);
    weights.push(exportedWeight);
  }
  if (total !== data.instructions) throw new TypeError('Profile sample total does not equal its instruction count');
  if (duration) validateDurationTotal(duration, elapsed, samples.length);
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    name,
    exporter: format,
    activeProfileIndex: 0,
    shared: {frames},
    profiles: [{type: 'sampled', name, unit: duration ? 'milliseconds' : 'none', startValue: 0,
      endValue: duration ? duration.totalMilliseconds : total, samples, weights}]
  };
}
