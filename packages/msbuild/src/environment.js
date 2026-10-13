/** Environment inherited by native build processes. Host secrets are never inherited implicitly. */
const inheritedNames = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'PROGRAMW6432', 'PATHEXT', 'DOTNET_ROOT', 'DOTNET_ROOT_X64', 'DOTNET_ROOT_X86', 'DOTNET_ROOT_ARM64',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'
]);
const overrideNames = new Set([
  'VSTEST_HOST_DEBUG', 'VSTEST_HOST_DEBUG_ATTACHVS', 'NUGET_PACKAGES', 'NUGET_HTTP_CACHE_PATH',
  'DOTNET_CLI_HOME', 'MSBUILDNOINPROCNODE', 'MSBUILDDISABLENODEREUSE'
]);

export function createBuildEnvironment(source = globalThis.process?.env ?? {}, overrides = {}) {
  const result = Object.create(null);
  for (const [name, value] of Object.entries(source)) {
    if (inheritedNames.has(name.toUpperCase()) && typeof value === 'string') result[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!overrideNames.has(name.toUpperCase()) || typeof value !== 'string' || /[\0\r\n]/.test(value)) {
      throw new Error('Environment variable is not allowed: ' + name);
    }
    result[name] = value;
  }
  return Object.assign(result, {
    DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_CLI_UI_LANGUAGE: 'en',
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: 'true',
    VSLANG: '1033', MSBUILDENSURESTDOUTFORTASKPROCESSES: '1'
  });
}

/** Explicit trusted launch-profile variables overlay the same restricted host inheritance, with bounded names and values. */
export function createLaunchEnvironment(source = globalThis.process?.env ?? {}, overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).length > 256) {
    throw Object.assign(new Error('Invalid launch environment or variable count'), { code: 'SFMSB_LAUNCH_ENVIRONMENT' });
  }
  const result = createBuildEnvironment(source);
  let bytes = 0;
  const names = new Set();
  for (const [name, value] of Object.entries(overrides)) {
    const key = process.platform === 'win32' ? name.toUpperCase() : name;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(name) || typeof value !== 'string' || value.includes('\0')
      || value.length > 65536 || names.has(key)) {
      throw Object.assign(new Error('Invalid launch environment variable: ' + name), { code: 'SFMSB_LAUNCH_ENVIRONMENT' });
    }
    names.add(key);
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value);
    if (bytes > 1048576) throw Object.assign(new Error('Launch environment byte limit exceeded'), { code: 'SFMSB_LAUNCH_ENVIRONMENT' });
    if (process.platform === 'win32') {
      for (const inherited of Object.keys(result)) if (inherited.toUpperCase() === key) delete result[inherited];
    }
    result[name] = value;
  }
  return result;
}
