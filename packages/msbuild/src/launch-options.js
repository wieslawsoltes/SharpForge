import { dirname, join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { readLaunchSettings, projectRunOptions } from '@sharpforge/project-system';
import { createLaunchEnvironment } from './environment.js';
import { normalizeBuildRequest } from './contract.js';

function failure(message, code = 'SFMSB_LAUNCH_OPTIONS') {
  return Object.assign(new Error(message), { code, status: 400 });
}

async function savedOptions(workspace, project, request) {
  if (request.noLaunchProfile === true || request.profile === null) return { project, args: [], environment: {} };
  const path = workspace.relative(join(dirname(await workspace.path(project)), 'Properties/launchSettings.json'));
  let source;
  try { source = (await workspace.read(path)).text; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const launchSettings = source === undefined ? null : readLaunchSettings(source, { path, profile: request.profile });
  if (launchSettings?.diagnostics.length) {
    const error = failure(launchSettings.diagnostics[0].message, 'SFP1701');
    error.diagnostics = launchSettings.diagnostics;
    error.path = path;
    throw error;
  }
  return projectRunOptions({ path: project, launchSettings }, { profile: request.profile });
}

async function launchDirectory(workspace, projectPath, value = '') {
  if (typeof value !== 'string' || value.length > 2048 || /[\0\r\n]|\$\(/.test(value)) {
    throw failure('Launch working directory must be a literal granted path', 'SFMSB_LAUNCH_DIRECTORY');
  }
  const absolute = resolve(dirname(projectPath), value.replaceAll('\\', '/'));
  const relative = workspace.relative(absolute);
  if (relative === null) throw failure('Launch working directory escapes the granted workspace', 'SFMSB_LAUNCH_DIRECTORY');
  const path = relative ? await workspace.path(relative) : workspace.root;
  if (!(await stat(path)).isDirectory()) throw failure('Launch working directory is not a directory', 'SFMSB_LAUNCH_DIRECTORY');
  return path;
}

async function launchExecutable(workspace, projectPath, value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\0\r\n]|\$\(/.test(value)) {
    throw failure('Executable profiles require a literal workspace executable path', 'SFMSB_LAUNCH_EXECUTABLE');
  }
  const absolute = resolve(dirname(projectPath), value.replaceAll('\\', '/'));
  const relative = workspace.relative(absolute);
  if (!relative) throw failure('Launch executable must stay inside the granted workspace', 'SFMSB_LAUNCH_EXECUTABLE');
  const path = await workspace.path(relative);
  if (!(await stat(path)).isFile()) throw failure('Launch executable is not a regular file', 'SFMSB_LAUNCH_EXECUTABLE');
  return relative;
}

/** Resolve data-only launch settings into bounded arguments, explicit environment and a granted native working directory. */
export async function resolveNativeLaunchOptions(workspace, request) {
  const project = request.project ?? request.runOptions?.project;
  const projectPath = await workspace.path(project);
  const options = request.runOptions ?? await savedOptions(workspace, project, request);
  if (!options || typeof options !== 'object' || Array.isArray(options) || options.project && options.project !== project) {
    throw failure('Launch options belong to a different project');
  }
  if (request.profile && options.profile !== request.profile) throw failure('Launch options belong to a different profile');
  const commandName = options.commandName ?? 'Project';
  if (!['Project', 'Executable'].includes(commandName)) {
    throw failure(`Launch command '${commandName}' requires an explicit native adapter`, 'SFMSB_LAUNCH_ADAPTER');
  }
  const profile = options.profile ?? null;
  if (profile !== null && (typeof profile !== 'string' || profile.length > 256 || /[\0\r\n]/.test(profile))) {
    throw failure('Invalid launch profile name');
  }
  const args = request.arguments ?? options.args ?? [];
  let bytes = 0;
  if (!Array.isArray(args) || args.length > 4096 || args.some(value => typeof value !== 'string' || value.includes('\0')
    || value.length > 65536 || (bytes += Buffer.byteLength(value)) > 1048576)) throw failure('Invalid application arguments');
  createLaunchEnvironment({}, options.environment ?? {});
  const environment = { ...options.environment };
  if (options.applicationUrl && environment.ASPNETCORE_URLS === undefined) environment.ASPNETCORE_URLS = options.applicationUrl;
  if (profile) environment.DOTNET_LAUNCH_PROFILE = profile;
  createLaunchEnvironment({}, environment);
  const normalized = normalizeBuildRequest({ project, properties: request.properties ?? request.globalProperties,
    configuration: request.configuration, platform: request.platform,
    framework: request.framework ?? options.targetFramework, runtime: request.runtime ?? options.runtimeIdentifier });
  const workingDirectory = await launchDirectory(workspace, projectPath, request.workingDirectory ?? options.workingDirectory);
  const executablePath = commandName === 'Executable' ? await launchExecutable(workspace, projectPath, options.executablePath) : null;
  return { project, profile, commandName, executablePath, args, environment, workingDirectory, properties: normalized.properties };
}
