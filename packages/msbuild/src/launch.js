import { escapeMSBuild } from './contract.js';
import { resolveNativeLaunchOptions } from './launch-options.js';

function projectLaunch(engine, launch, request, options) {
  const args = ['run', '--project', launch.project, '--no-launch-profile'];
  if (request.noBuild !== false) args.push('--no-build');
  for (const [name, value] of Object.entries(launch.properties)) args.push('--property:' + name + '=' + escapeMSBuild(value));
  // The property reaches the SDK's Run target on versions where launchSettings workingDirectory is ignored.
  args.push('--property:RunWorkingDirectory=' + escapeMSBuild(launch.workingDirectory));
  if (launch.args.length) args.push('--', ...launch.args);
  return engine.runTool({ arguments: args, project: launch.project, trusted: request.trusted,
    environmentMode: 'launch', environment: launch.environment,
    timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes }, options);
}

function executableLaunch(engine, launch, request, options) {
  return engine.runWorkspaceExecutable({ executablePath: launch.executablePath, arguments: launch.args,
    project: launch.project, trusted: request.trusted, cwd: engine.workspace.relative(launch.workingDirectory),
    environmentMode: 'launch', environment: launch.environment,
    timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes }, options);
}

const adapters = Object.freeze({ Project: projectLaunch, Executable: executableLaunch });

/** Apply supported profile data using a fixed SDK command or an explicit executable inside the granted workspace. */
export async function runNativeProject(engine, request, options = {}) {
  await engine.authorize(request);
  options.signal?.throwIfAborted();
  const launch = await resolveNativeLaunchOptions(engine.workspace, request);
  return adapters[launch.commandName](engine, launch, request, options);
}
