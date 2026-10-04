import { EvaluationError } from './evaluation/errors.js';
import { parseConfigurationJson } from './configuration-json.js';

/** Split launch command arguments with double/single quotes and backslash escaping; never invoke a shell. */
export function parseLaunchArguments(value) {
  const result = [];
  let current = '';
  let quote = '';
  let started = false;
  const text = String(value ?? '');
  if (text.length > 65536) throw new EvaluationError('Launch argument limit exceeded.', 'SFP1701');
  for (let offset = 0; offset < text.length; offset++) {
    const char = text[offset];
    if (char === '\\' && ['"', "'", '\\'].includes(text[offset + 1])) current += text[++offset];
    else if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) {
      if (started) result.push(current);
      current = '';
      started = false;
      continue;
    } else current += char;
    started = true;
  }
  if (quote) throw new EvaluationError('Unterminated quoted launch argument.', 'SFP1701');
  if (started) result.push(current);
  return result;
}

/** Parse data-only JSONC launch profiles, retaining located diagnostics and the selected profile. */
export function readLaunchSettings(source, { path = 'Properties/launchSettings.json', profile, maxLength = 1_000_000 } = {}) {
  const diagnostics = [];
  let profiles = [];
  try {
    if (typeof source !== 'string' || source.length > maxLength) throw new EvaluationError('Launch settings text limit exceeded.', 'SFP1701');
    const data = parseConfigurationJson(source, { maxLength });
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || !data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) {
      throw new EvaluationError('Launch settings must contain a profiles object.', 'SFP1701');
    }
    if (Object.keys(data.profiles).length > 100) throw new EvaluationError('Launch profile count limit exceeded.', 'SFP1701');
    profiles = Object.entries(data.profiles).map(([name, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvaluationError(`Launch profile '${name}' must be an object.`, 'SFP1701');
      const commandName = value.commandName ?? 'Project';
      const environment = Object.create(null);
      for (const [key, environmentValue] of Object.entries(value.environmentVariables ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof environmentValue !== 'string') {
          throw new EvaluationError(`Invalid environment variable in launch profile '${name}'.`, 'SFP1701');
        }
        environment[key] = environmentValue;
      }
      return { name, commandName, supported: ['Project', 'Executable'].includes(commandName),
        args: parseLaunchArguments(value.commandLineArgs), commandLineArgs: value.commandLineArgs ?? '',
        executablePath: value.executablePath ?? '', workingDirectory: value.workingDirectory ?? '',
        environmentVariables: environment, applicationUrl: value.applicationUrl ?? '',
        dotnetRunMessages: value.dotnetRunMessages ?? true, launchBrowser: value.launchBrowser ?? false };
    });
    if (profile && !profiles.some(value => value.name === profile)) throw new EvaluationError(`Launch profile '${profile}' does not exist.`, 'SFP1701');
  } catch (error) {
    const start = error.start ?? Number(/position (\d+)/.exec(error.message)?.[1] ?? 0);
    const before = String(source).slice(0, start);
    diagnostics.push({ path, code: 'SFP1701', severity: 'error', message: error.message, start, length: 1,
      line: before.split('\n').length, column: start - before.lastIndexOf('\n') });
  }
  const activeProfile = profiles.find(value => value.name === profile) ?? profiles.find(value => value.commandName === 'Project') ?? profiles[0] ?? null;
  return { path, profiles, activeProfile, diagnostics };
}

export function projectRunOptions(project, options = {}) {
  const settings = project.launchSettings;
  const selected = options.profile ? settings?.profiles.find(profile => profile.name === options.profile) : settings?.activeProfile;
  if (options.profile && !selected) throw new EvaluationError(`Launch profile '${options.profile}' does not exist.`, 'SFP1701');
  if (selected && !selected.supported) throw new EvaluationError(`Launch command '${selected.commandName}' requires its native host.`, 'SFP1701');
  const environment = { ...options.environment, ...selected?.environmentVariables };
  if (selected?.applicationUrl && environment.ASPNETCORE_URLS === undefined) environment.ASPNETCORE_URLS = selected.applicationUrl;
  return { project: project.path, contextId: project.contextId, targetFramework: project.targetFramework,
    runtimeIdentifier: project.runtimeIdentifier ?? '', profile: selected?.name ?? null, commandName: selected?.commandName ?? 'Project',
    args: options.args ?? selected?.args ?? [], environment, workingDirectory: selected?.workingDirectory ?? '',
    executablePath: selected?.executablePath ?? '', applicationUrl: selected?.applicationUrl ?? '',
    dotnetRunMessages: selected?.dotnetRunMessages ?? true };
}
