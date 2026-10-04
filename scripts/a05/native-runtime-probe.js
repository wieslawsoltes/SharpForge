import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {nativeFixtureProject} from '../a05-native-project.js';

const source = `using System;
using System.Runtime.InteropServices;
static class RuntimeProbe {
    static void Main() {
        Console.WriteLine(RuntimeInformation.FrameworkDescription);
        Console.WriteLine(Environment.Version);
        Console.WriteLine(RuntimeInformation.RuntimeIdentifier);
    }
}
`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Validate an explicit VM compatibility contract; never infer it from guest stdout. */
export function firstChancePolicy(value = 'before-unwind') {
  assert(['before-unwind', 'after-unwind'].includes(value), 'First-chance policy must be before-unwind or after-unwind');
  return value;
}

/** Capture a separate native process using the fixture's exact runtimeconfig and host environment. */
export async function probeNativeRuntime({directory, assemblyPath, artifact, framework, dotnet, execute, includePointerWidth = false}) {
  const probeSource = includePointerWidth ? source.replace('Console.WriteLine(RuntimeInformation.RuntimeIdentifier);',
    'Console.WriteLine(RuntimeInformation.RuntimeIdentifier);\n' +
    '        Console.WriteLine(IntPtr.Size);\n        Console.WriteLine(RuntimeInformation.ProcessArchitecture);') : source;
  const project = join(directory, 'runtime-probe');
  await mkdir(project, {recursive: true});
  await writeFile(join(project, 'RuntimeProbe.csproj'), nativeFixtureProject(framework));
  await writeFile(join(project, 'Program.cs'), probeSource);
  execute(dotnet, ['restore', 'RuntimeProbe.csproj', '--configfile', join(directory, 'NuGet.Config'), '--verbosity', 'quiet'], {cwd: project});
  execute(dotnet, ['build', 'RuntimeProbe.csproj', '--configuration', 'Release', '--no-restore', '--verbosity', 'quiet'], {cwd: project});
  const probeAssembly = join(project, 'bin', 'Release', framework, 'RuntimeProbe.dll');
  const runtimeConfigPath = join(dirname(assemblyPath), 'Qualification.runtimeconfig.json');
  const runtimeConfig = await readFile(runtimeConfigPath);
  const probeBytes = await readFile(probeAssembly);
  const args = ['exec', '--runtimeconfig', runtimeConfigPath, probeAssembly];
  const result = execute(dotnet, args, {cwd: directory});
  assert.equal(result.exitCode, 0, 'Native runtime probe must complete successfully');
  assert.equal(result.signal ?? null, null, 'Native runtime probe cannot terminate by signal');
  const fields = result.output.trimEnd().split('\n');
  assert.equal(fields.length, includePointerWidth ? 5 : 3, 'Native runtime probe requires exact identity fields');
  assert(/^\.NET \d+\.\d+\.\d+/.test(fields[0]), 'Native probe must identify the selected .NET runtime');
  assert(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(fields[1]), 'Native probe must report Environment.Version');
  assert(/^[a-z0-9][a-z0-9.-]+$/.test(fields[2]), 'Native probe must report its runtime identifier');
  assert.equal(Number(fields[1].split('.')[0]), Number(framework.slice(3).split('.')[0]), 'Selected runtime major must match target framework');
  if (includePointerWidth) {
    assert(['4', '8'].includes(fields[3]), 'Native pointer size must be four or eight bytes');
    assert(/^[A-Za-z][A-Za-z0-9]*$/.test(fields[4]), 'Native probe must report process architecture');
  }
  await writeFile(join(artifact, 'RuntimeProbe.cs'), probeSource);
  await writeFile(join(artifact, 'RuntimeProbe.dll'), probeBytes);
  return {
    scope: 'Independent native process with identical fixture runtimeconfig, dotnet executable, cwd and environment; not guest instrumentation.',
    frameworkDescription: fields[0], environmentVersion: fields[1], runtimeIdentifier: fields[2],
    ...(includePointerWidth ? {nativeIntBits: Number(fields[3]) * 8, processArchitecture: fields[4]} : {}),
    runtimeConfig: {file: 'Qualification.runtimeconfig.json', sha256: hash(runtimeConfig), content: runtimeConfig.toString('utf8')},
    probe: {sourceSha256: hash(probeSource), assemblySha256: hash(probeBytes)},
    command: {executable: dotnet, arguments: args.map(value => value.replaceAll(directory, '<temporary-project>'))},
    exitCode: result.exitCode, signal: result.signal ?? null, output: result.output, stderr: result.stderr
  };
}
