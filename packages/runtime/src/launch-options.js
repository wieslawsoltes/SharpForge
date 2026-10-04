/** Browser process configuration is bounded, copied and never inherited from the host process. */
export const runtimeLaunchLimits = Object.freeze({
  arguments: 1024,
  argumentCharacters: 65_536,
  totalArgumentCharacters: 1_048_576,
  environmentEntries: 256,
  environmentNameCharacters: 256,
  environmentValueCharacters: 65_536,
  totalEnvironmentCharacters: 1_048_576
});

export const runtimeLaunchCapabilities = Object.freeze({ arguments: true, environment: true, environmentMutation: false });

export class RuntimeLaunchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuntimeLaunchError';
    this.code = code;
  }
}

export function validateProgramArguments(values = []) {
  const limits = runtimeLaunchLimits;
  if (!Array.isArray(values) || values.length > limits.arguments) {
    throw new RuntimeLaunchError('PROGRAM_ARGUMENTS', `Program arguments require at most ${limits.arguments} strings`);
  }
  let characters = 0;
  const copied = values.map(value => {
    if (typeof value !== 'string' || value.length > limits.argumentCharacters || value.includes('\0')) {
      throw new RuntimeLaunchError('PROGRAM_ARGUMENTS', 'Program arguments must be bounded strings without null characters');
    }
    characters += value.length;
    if (characters > limits.totalArgumentCharacters) {
      throw new RuntimeLaunchError('PROGRAM_ARGUMENTS', 'Program arguments exceed the total limit');
    }
    return value;
  });
  return Object.freeze(copied);
}

export function validateLaunchEnvironment(value = {}) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (!value || Array.isArray(value) || prototype !== Object.prototype && prototype !== null) {
    throw new RuntimeLaunchError('LAUNCH_ENVIRONMENT', 'Launch environment must be a name/value record');
  }
  const entries = Object.entries(value);
  const limits = runtimeLaunchLimits;
  if (entries.length > limits.environmentEntries) throw new RuntimeLaunchError('LAUNCH_ENVIRONMENT', 'Too many environment entries');
  const result = Object.create(null);
  let characters = 0;
  for (const [name, text] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > limits.environmentNameCharacters ||
        typeof text !== 'string' || text.length > limits.environmentValueCharacters || text.includes('\0')) {
      throw new RuntimeLaunchError('LAUNCH_ENVIRONMENT', 'Environment names and values must be bounded strings without null characters');
    }
    characters += name.length + text.length;
    if (characters > limits.totalEnvironmentCharacters) {
      throw new RuntimeLaunchError('LAUNCH_ENVIRONMENT', 'Launch environment exceeds the total limit');
    }
    result[name] = text;
  }
  return Object.freeze(result);
}

/** `arguments` remains a selected method's raw parameter vector; `programArguments` is process argv. */
export function normalizeRuntimeLaunchOptions(options = {}) {
  const argv = options.programArguments === undefined ? undefined : validateProgramArguments(options.programArguments);
  if (options.arguments !== undefined && !Array.isArray(options.arguments)) {
    throw new RuntimeLaunchError('METHOD_ARGUMENTS', 'Method arguments must be an array');
  }
  if (argv && (options.methodToken !== undefined && options.methodToken !== null || options.arguments !== undefined) && argv.length) {
    throw new RuntimeLaunchError('PROGRAM_ARGUMENTS_METHOD', 'Program arguments cannot accompany an explicit method invocation');
  }
  return { ...options, programArguments: argv, environment: validateLaunchEnvironment(options.environment) };
}

/** Resolve the supported Main signatures without changing explicit method invocation arguments. */
export function entryArgumentValues(parameterTypes, options) {
  if (options.arguments !== undefined) return options.arguments;
  if (!parameterTypes.length) return [];
  if (parameterTypes.length === 1 && parameterTypes[0] === 'string[]') return [options.programArguments ?? []];
  throw new RuntimeLaunchError('PROGRAM_ENTRY_SIGNATURE', 'Program entry must accept no arguments or one string array');
}
