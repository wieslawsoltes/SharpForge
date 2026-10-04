/** Common bounded observation controls for additive complete-workload reports. */
export function parseLatencyOptions(arguments_, label) {
  const options = {samples: 100, warmup: 10, nativeBits: 64, timeoutSeconds: 900};
  const names = {'--runner': 'runner', '--out': 'out', '--samples': 'samples', '--warmup': 'warmup',
    '--native-bits': 'nativeBits', '--timeout-seconds': 'timeoutSeconds'};
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index], value = arguments_[index + 1], key = names[name];
    if (!key || seen.has(name) || value === undefined || value.startsWith('--')) throw new TypeError('Invalid ' + label + ' latency option: ' + name);
    seen.add(name);
    options[key] = ['runner', 'out'].includes(key) ? value : Number(value);
  }
  if (!/^[\w.-]{1,80}$/.test(options.runner ?? '') || !options.out ||
      !Number.isInteger(options.samples) || options.samples < 20 || options.samples > 1000 ||
      !Number.isInteger(options.warmup) || options.warmup < 1 || options.warmup > 100 ||
      ![32, 64].includes(options.nativeBits) || !Number.isFinite(options.timeoutSeconds) ||
      options.timeoutSeconds <= 0 || options.timeoutSeconds > 3600) throw new RangeError('Invalid ' + label + ' latency protocol');
  return options;
}
