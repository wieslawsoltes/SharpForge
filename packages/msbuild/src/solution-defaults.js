export const SolutionDimension = Object.freeze({Configuration: 'configuration', Platform: 'platform', Build: 'build', Deploy: 'deploy'});
const clrExtensions = new Set(['csproj', 'vbproj', 'fsproj', 'webproj']);
const noBuildExtensions = new Set(['shproj', 'vcxitems', 'exe', 'esproj', 'njsproj', 'deployproj', 'vsproj', 'wixproj',
  'sqlproj', 'usqldbproj', 'usqlproj', 'sfproj', 'ccproj', 'dcproj']);

/** Canonical comparison form; serialized project platform spelling is retained separately. */
export function canonicalSolutionPlatform(value) {
  const lower = String(value).trim().toLowerCase();
  return lower === 'any cpu' ? 'anycpu' : lower;
}

/** Default rules follow SolutionPersistence's built-in CLR, VC and non-buildable project types. */
export function inferProjectConfiguration(project, selected = {}) {
  const configuration = selected.configuration ?? 'Debug';
  const platform = selected.platform ?? 'Any CPU';
  const extension = project.path.split('.').at(-1).toLowerCase();
  let mapped = platform;
  if (clrExtensions.has(extension)) mapped = 'AnyCPU';
  else if (extension === 'vcxproj') {
    if (canonicalSolutionPlatform(platform) === 'anycpu') mapped = 'x64';
    else if (canonicalSolutionPlatform(platform) === 'x86') mapped = 'Win32';
  }
  return {configuration, platform: mapped, build: !noBuildExtensions.has(extension), deploy: false};
}

export function solutionConfigurationName(configuration, platform) {
  for (const value of [configuration, platform]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f|]/.test(value)) {
      throw Object.assign(new Error('Invalid solution configuration dimension'), {code: 'SFM2301'});
    }
  }
  return configuration.trim() + '|' + platform.trim();
}

export function splitSolutionConfiguration(value) {
  if (typeof value !== 'string' || value.split('|').length !== 2) throw new Error('Expected Configuration|Platform');
  const [configuration, platform] = value.split('|').map(part => part.trim());
  return {name: solutionConfigurationName(configuration, platform), configuration, platform};
}
