import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTargetFramework, isTargetFrameworkCompatible, nearestTargetFramework,
  targetFrameworkDefines, ProjectSystem } from '../packages/project-system/src/index.js';
import { resolveNativeReference, compileNativeJsonProgram } from './helpers/project-native-reference.js';

const frameworks = [
  'net10', 'net11', 'net20', 'net30', 'net35', 'net40', 'net403', 'net45', 'net451', 'net452',
  'net46', 'net461', 'net462', 'net47', 'net471', 'net472', 'net48', 'net481',
  'netstandard1.0', 'netstandard1.1', 'netstandard1.2', 'netstandard1.3', 'netstandard1.4', 'netstandard1.5', 'netstandard1.6',
  'netstandard2.0', 'netstandard2.1', 'netcoreapp1.0', 'netcoreapp1.1', 'netcoreapp2.0', 'netcoreapp2.1',
  'netcoreapp2.2', 'netcoreapp3.0', 'netcoreapp3.1', 'net5.0', 'net6.0', 'net7.0', 'net8.0', 'net9.0', 'net10.0',
  'net8.0-windows', 'net8.0-windows7.0', 'net10.0-windows10.0.19041.0', 'net8.0-android34.0', 'net8.0-ios17.0',
  'net8.0-maccatalyst17.0', 'net8.0-macos14.0',
];

const nativeSource = `using System;
  using System.Linq;
  using System.Text.Json;
  using NuGet.Frameworks;
  class Program {
    static void Main(string[] args) {
      var request = JsonDocument.Parse(args[0]).RootElement;
      var names = request.GetProperty("frameworks").EnumerateArray().Select(item => item.GetString()).ToArray();
      var frameworks = names.Select(NuGetFramework.ParseFolder).ToArray();
      var reducer = new FrameworkReducer();
      var groups = request.GetProperty("nearest").EnumerateArray().Select(item => {
        var target = NuGetFramework.ParseFolder(item.GetProperty("target").GetString());
        var candidateNames = item.GetProperty("candidates").EnumerateArray().Select(value => value.GetString()).ToArray();
        var candidates = candidateNames.Select(NuGetFramework.ParseFolder).ToArray();
        var nearest = reducer.GetNearest(target, candidates);
        return nearest == null ? null : candidateNames[Array.FindIndex(candidates, candidate => candidate.Equals(nearest))];
      }).ToArray();
      Console.WriteLine(JsonSerializer.Serialize(new {
        frameworks = frameworks.Select(item => new { identifier = item.Framework, version = item.Version.ToString(),
          platform = item.Platform, platformVersion = item.PlatformVersion.ToString(), supported = !item.IsUnsupported }),
        compatibility = frameworks.SelectMany(target => frameworks.Select(candidate =>
          DefaultCompatibilityProvider.Instance.IsCompatible(target, candidate))),
        nearest = groups
      }));
    }
  }`;

const nearest = [
  { target: 'net8.0', candidates: ['netstandard2.1', 'net6.0', 'net9.0'] },
  { target: 'net48', candidates: ['netstandard2.0', 'net461', 'net472'] },
  { target: 'net8.0-windows10.0.19041.0', candidates: ['net7.0-windows7.0', 'net8.0'] },
  { target: 'net8.0-windows10.0.19041.0', candidates: ['net8.0', 'net8.0-windows7.0', 'net8.0-windows10.0.19041.0'] },
  { target: 'net8.0', candidates: ['net8.0-windows', 'net9.0'] },
  { target: 'netstandard2.0', candidates: ['netstandard1.6', 'netstandard2.1'] },
];

function version(value) {
  const parts = value.split('.');
  while (parts.length > 2 && parts.at(-1) === '0') parts.pop();
  return parts.join('.');
}

test('47 TFM parsing rows, all compatibility pairs and nearest assets match native NuGet.Frameworks', context => {
  const dotnet = process.env.SHARPFORGE_DOTNET ?? process.env.DOTNET_HOST_PATH ?? 'dotnet';
  const installed = spawnSync(dotnet, ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (installed.status !== 0) {
    context.skip('An installed .NET SDK is required for native NuGet framework comparisons.');
    return;
  }
  const toolchain = resolveNativeReference(dotnet, installed.stdout.trim());
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-tfm-reference-'));
  try {
    const oracle = compileNativeJsonProgram(toolchain, directory, nativeSource, {
      references: [join(toolchain.sdkDirectory, 'NuGet.Frameworks.dll')],
    });
    const native = oracle([JSON.stringify({ frameworks, nearest })]);
    assert.equal(frameworks.length, 47);
    for (let index = 0; index < frameworks.length; index++) {
      const { original, ...actual } = parseTargetFramework(frameworks[index]);
      actual.version = version(actual.version);
      actual.platformVersion = actual.platformVersion ? version(actual.platformVersion) : '';
      const expected = native.frameworks[index];
      expected.version = version(expected.version);
      expected.platformVersion = /^0(?:\.0)*$/.test(expected.platformVersion) ? '' : version(expected.platformVersion);
      assert.deepEqual(actual, expected, `SDK ${toolchain.sdk}: ${frameworks[index]}`);
    }
    for (let host = 0; host < frameworks.length; host++) for (let asset = 0; asset < frameworks.length; asset++) {
      assert.equal(isTargetFrameworkCompatible(frameworks[host], frameworks[asset]),
        native.compatibility[host * frameworks.length + asset], `${frameworks[host]} -> ${frameworks[asset]}`);
    }
    assert.deepEqual(nearest.map(value => nearestTargetFramework(value.target, value.candidates)), native.nearest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('unsupported frameworks are explicit and do not become compatible fallback assets', () => {
  for (const framework of ['', 'not-a-framework', 'net8.0-windows-?', 'net8.0-windows1..0']) {
    assert.equal(parseTargetFramework(framework).supported, false);
    assert.equal(isTargetFrameworkCompatible('net8.0', framework), false);
    assert.equal(nearestTargetFramework('net8.0', [framework]), null);
  }
});

test('framework symbols include platform and earlier SDK thresholds and can be disabled explicitly', () => {
  const symbols = targetFrameworkDefines('net10.0-windows10.0.19041.0');
  for (const symbol of ['NET10_0', 'NET8_0_OR_GREATER', 'NETCOREAPP', 'WINDOWS']) assert(symbols.includes(symbol));
  assert.throws(() => targetFrameworkDefines('net1000000.0'), /limit/);
  const system = new ProjectSystem([{ path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + '<TargetFramework>net10.0</TargetFramework><DisableImplicitFrameworkDefines>true</DisableImplicitFrameworkDefines>'
    + '</PropertyGroup></Project>' }]);
  system.load('App.csproj');
  assert.deepEqual(system.compilationOptions().defines, ['TRACE', 'DEBUG']);
});
