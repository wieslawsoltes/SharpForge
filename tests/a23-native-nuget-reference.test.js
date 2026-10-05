import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveNativeReference, compileNativeJsonProgram } from './helpers/project-native-reference.js';
import { parseNuGetVersion, compareNuGetVersions, parseNuGetRange, satisfiesNuGetRange } from '@sharpforge/msbuild';

const executable = process.env.SHARPFORGE_DOTNET;
const sdk = process.env.SHARPFORGE_NATIVE_SDK;
const versions = [
  '1', '1.2', '1.2.3', '1.2.3.0', '1.2.3.4', '01.02.003', '0.0.0', '2147483647.0.0',
  '1.0.0-alpha', '1.0.0-alpha.01', '1.0.0-alpha.1', '1.0.0-rc.10', '1.0.0-Beta',
  '1.0.0+metadata', '1.0.0-alpha+Build.02', '  1.0.0  ', '', '1..2', '1.2.3.4.5',
  '1.0.0-', '1.0.0-a..b', '1.0.0-a_b', '1.0.0+a_b', '2147483648.0.0', '-1.2.3',
  '1.0.0-9999999999999999999999999999', '1.0.0-1a', 'v1.0.0', '1.0.0+sha.abc'
];
const comparisons = [
  ['1.0', '1.0.0'], ['1.0.0.0', '1.0.0'], ['1.0.0.1', '1.0.0'],
  ['1.0.0-alpha', '1.0.0'], ['1.0.0-A', '1.0.0-a'], ['1.0.0-1', '1.0.0-alpha'],
  ['1.0.0-alpha.2', '1.0.0-alpha.10'], ['1.0.0-01.a', '1.0.0-1.b'],
  ['1.0.0-a', '1.0.0-a.1'], ['1.0.0+foo', '1.0.0+bar'],
  ['1.0.0-9999999999999999999999999999', '1.0.0-2']
];
const ranges = ['[1.0,2.0)', '(1.0,2.0]', '[1.0]', '1.0', '(,2.0]', '[1.0,)',
  '(,)', '[]', '[2.0,1.0)', '(1.0,1.0)', '[1.0,1.0]', '', '*', '1.*', '1.2.*',
  '*-*', '1.2.*-*', '1.2.3-*', '1.2.3-alpha*', '1.2.*-rc.*', '1.*.*', '[,2.0]'];
const candidates = ['0.0.0', '1.0.0-alpha', '1.0.0', '1.2.0', '1.2.3-alpha',
  '1.2.3-alpha.2', '1.2.3-rc.1', '1.2.3', '1.2.4', '1.3.0', '2.0.0'];

const source = `using System;
using System.Linq;
using System.Text.Json;
using NuGet.Versioning;
class Program {
  static void Main(string[] args) {
    var input = JsonDocument.Parse(args[0]).RootElement;
    var versions = input.GetProperty("versions").EnumerateArray().Select(item => {
      string text = item.GetString();
      bool valid = NuGetVersion.TryParse(text, out var value);
      return new { text, valid, normalized = valid ? value.ToNormalizedString() : null };
    }).ToArray();
    var comparisons = input.GetProperty("comparisons").EnumerateArray().Select(pair => {
      bool valid = NuGetVersion.TryParse(pair[0].GetString(), out var left) & NuGetVersion.TryParse(pair[1].GetString(), out var right);
      return new { valid, comparison = valid ? Math.Sign(VersionComparer.VersionRelease.Compare(left, right)) : (int?)null };
    }).ToArray();
    var candidates = input.GetProperty("candidates").EnumerateArray().Select(value => NuGetVersion.Parse(value.GetString())).ToArray();
    var ranges = input.GetProperty("ranges").EnumerateArray().Select(item => {
      string text = item.GetString();
      bool valid = VersionRange.TryParse(text, out var value);
      var matches = valid ? candidates.Select(candidate => value.Satisfies(candidate) &&
        (value.Float == null || value.Float.Satisfies(candidate))).ToArray() : Array.Empty<bool>();
      return new { text, valid, matches };
    }).ToArray();
    Console.WriteLine(JsonSerializer.Serialize(new { versions, comparisons, ranges,
      nuget = typeof(NuGetVersion).Assembly.GetName().Version.ToString() }));
  }
}`;

test('NuGet version, comparison and floating range vectors match the installed NuGet.Versioning assembly', {
  skip: executable ? false : 'Set SHARPFORGE_DOTNET for the offline NuGet reference oracle', timeout: 90000
}, t => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-nuget-reference-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const toolchain = resolveNativeReference(executable, sdk);
  const invoke = compileNativeJsonProgram(toolchain, directory, source,
    { references: [join(toolchain.sdkDirectory, 'NuGet.Versioning.dll')] });
  const expected = invoke([JSON.stringify({ versions, comparisons, ranges, candidates })]);
  const differences = [];
  for (const vector of expected.versions) {
    let actual = null;
    try { actual = parseNuGetVersion(vector.text); } catch { /* Invalid vectors are compared explicitly below. */ }
    if (Boolean(actual) !== vector.valid || actual && actual.normalized !== vector.normalized) {
      differences.push({ kind: 'parse', vector, actual });
    }
  }
  comparisons.forEach(([left, right], index) => {
    let actual = null;
    try { actual = Math.sign(compareNuGetVersions(left, right)); } catch { /* Invalid inputs must be rejected by both implementations. */ }
    if (actual !== expected.comparisons[index].comparison) differences.push({ kind: 'compare', left, right, actual, expected: expected.comparisons[index] });
  });
  for (const vector of expected.ranges) {
    let actual = null;
    try { actual = parseNuGetRange(vector.text); } catch { /* Invalid vectors remain a tested result. */ }
    if (Boolean(actual) !== vector.valid) { differences.push({ kind: 'range-parse', vector, actual }); continue; }
    if (!actual) continue;
    const matches = candidates.map(version => satisfiesNuGetRange(version, actual));
    if (JSON.stringify(matches) !== JSON.stringify(vector.matches)) differences.push({ kind: 'range-match', vector, matches });
  }
  assert.deepEqual(differences, []);
  t.diagnostic(JSON.stringify({ sdk: toolchain.sdk, runtime: toolchain.runtime, nuget: expected.nuget,
    parseVectors: versions.length, comparisons: comparisons.length, ranges: ranges.length, candidates: candidates.length }));
});
