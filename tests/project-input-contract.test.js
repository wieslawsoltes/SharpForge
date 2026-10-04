import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCompilationOptions, parseLaunchArguments, readLaunchSettings, projectRunOptions} from '@sharpforge/project-system';

const project = properties => ({path: 'Library.csproj', name: 'Library', outputType: 'Library', properties,
  contextId: 'library-net10', targetFramework: 'net10.0', runtimeIdentifier: 'linux-x64'});

test('one context retains independent compiler policy and explicit SDK warning defaults', () => {
  const value = projectCompilationOptions({...project({langversion: '12.0', nullable: 'enable', defineconstants: 'ONE;TWO,ONE',
    allowunsafeblocks: 'true', checkforoverflowunderflow: 'true', warninglevel: '5', nowarn: '1701;CS0168',
    warningsaserrors: 'NU1605;SYSLIB0011', warningsnotaserrors: 'CS0618', optimize: 'true',
    usingmicrosoftnetsdk: 'true', targetframeworkidentifier: '.NETCoreApp', targetframeworkversion: 'v10.0'}),
  generatedSources: [{kind: 'global-usings', text: 'global using System;'}]});
  assert.equal(value.outputKind, 'library');
  assert.equal(value.langVersion, '12');
  assert.equal(value.nullable, 'enable');
  assert.deepEqual(value.defines, ['ONE', 'TWO']);
  assert.equal(value.allowUnsafe, true);
  assert.equal(value.checkOverflow, true);
  assert.equal(value.warningLevel, 5);
  assert.deepEqual(value.noWarn, ['1701', 'CS0168', '1702', '8002']);
  assert.deepEqual(value.warningsAsErrors, ['NU1605', 'SYSLIB0011']);
  assert.deepEqual(value.implicitGlobalUsings, ['global using System;']);
  assert.deepEqual(projectCompilationOptions(project({})).defines, []);
});

test('invalid compiler policy is diagnosed before constructing a compilation request', () => {
  for (const properties of [{langversion: '100'}, {nullable: 'sometimes'}, {defineconstants: 'A-B'},
    {warninglevel: '-1'}, {allowunsafeblocks: 'yes'}, {deterministic: 'maybe'}]) {
    assert.throws(() => projectCompilationOptions(project(properties)), {code: 'SFP1402'});
  }
});

test('launch profiles retain exact arguments, context and explicit environment precedence', () => {
  const settings = readLaunchSettings('{/* launch */"profiles":{"Default":{"commandName":"Project",'
    + '"commandLineArgs":"one \\\"two words\\\" \\\"\\\"","environmentVariables":{"MODE":"profile"},'
    + '"workingDirectory":"run","applicationUrl":"http://localhost:5000",},}}');
  assert.deepEqual(settings.diagnostics, []);
  assert.deepEqual(settings.activeProfile.args, ['one', 'two words', '']);
  const value = projectRunOptions({...project({}), launchSettings: settings}, {environment: {MODE: 'host', KEEP: 'yes'}});
  assert.equal(value.contextId, 'library-net10');
  assert.equal(value.runtimeIdentifier, 'linux-x64');
  assert.deepEqual(value.environment, {MODE: 'profile', KEEP: 'yes', ASPNETCORE_URLS: 'http://localhost:5000'});
  assert.equal(value.workingDirectory, 'run');
  assert.deepEqual(projectRunOptions({...project({}), launchSettings: settings}, {args: ['override']}).args, ['override']);
  assert.deepEqual(parseLaunchArguments("'single quoted' plain"), ['single quoted', 'plain']);
});

test('malformed and unsupported launch profiles remain explicit failures', () => {
  for (const source of ['{', '{"profiles":[]}', '{"profiles":{"bad":42}}',
    '{"profiles":{"bad":{"environmentVariables":{"INVALID-NAME":"x"}}}}']) {
    assert.equal(readLaunchSettings(source).diagnostics[0].code, 'SFP1701');
  }
  assert.equal(readLaunchSettings('{"profiles":{}}', {profile: 'Missing'}).diagnostics[0].code, 'SFP1701');
  const settings = readLaunchSettings('{"profiles":{"Native":{"commandName":"IISExpress"}}}');
  assert.equal(settings.activeProfile.supported, false);
  assert.throws(() => projectRunOptions({...project({}), launchSettings: settings}), {code: 'SFP1701'});
  assert.throws(() => parseLaunchArguments('"unterminated'), {code: 'SFP1701'});
  assert.throws(() => parseLaunchArguments('x'.repeat(65537)), {code: 'SFP1701'});
});
