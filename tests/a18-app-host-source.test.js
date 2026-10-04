import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerAppHostError} from '../apps/studio/designer-app-host-errors.js';
import {DesignerAppSourceOwnership, captureAppSources, sameAppSources, appWorkspaceIdentity,
  appProfile, appLaunchParameters} from '../apps/studio/designer-app-host-source.js';

function ownership(compile = async () => ({
  success: true, image: {entryPoint: 1}, assembly: new Uint8Array([1]), compilationUris: ['A.cs']
})) {
  const environment = {workspace: 'Workspace:1', files: [{uri: 'A.cs', text: 'class A {}', version: 1}], active: true};
  const context = new DesignerAppSourceOwnership({
    workspaceId: environment.workspace, sourceProjection: captureAppSources(environment.files), compilationUris: ['A.cs'],
    getWorkspaceId: () => environment.workspace, sourceFiles: () => environment.files, compile,
    options: {profile: 'cil', debug: false, workspaceId: environment.workspace, projectName: 'Demo'},
    assertCurrent: () => { if (!environment.active) throw new DesignerAppHostError('Stale app', 'SFDA0002'); }
  });
  return {context, environment};
}

test('source projection is immutable, case-sensitive, sorted and bounded', () => {
  const files = [{uri: 'b.cs', text: 'B'}, {uri: 'A.cs', text: 'A', version: 3}, {uri: 'a.cs', text: 'a'}];
  const snapshot = captureAppSources(files);
  files[1].text = 'changed';
  assert.deepEqual(snapshot.map(file => file.uri), ['A.cs', 'a.cs', 'b.cs']);
  assert.equal(snapshot[0].text, 'A');
  assert.ok(Object.isFrozen(snapshot) && snapshot.every(Object.isFrozen));
  assert.ok(sameAppSources(snapshot, captureAppSources(snapshot.map(file => ({...file, version: 100})))));
  assert.throws(() => captureAppSources([{uri: 'A.cs', text: 'A'}, {uri: 'A.cs', text: 'B'}]), {code: 'SFDA0007'});
  assert.throws(() => captureAppSources([{uri: 'A.cs', text: 'x'.repeat(2_000_001)}]), {code: 'SFDA0007'});
  assert.throws(() => captureAppSources(new Array(1001)), {code: 'SFDA0007'});
  assert.throws(() => appWorkspaceIdentity(null), {code: 'SFDA0008'});
  assert.equal(appWorkspaceIdentity(0), 0);
  assert.equal(appProfile(), 'cil');
  assert.throws(() => appProfile('native'), {code: 'SFDA0009'});
});

test('launch selects a deliberate executable and retains runtime grants without overriding identity or profile', () => {
  const image = {entryPoint: 1}, assembly = new Uint8Array([1, 2]);
  const result = {success: true, image, assembly};
  const sourceProjection = captureAppSources([{uri: 'View.cs', text: 'class View {}'}]);
  const base = {debug: false, sourceProjection, runtimeOptions: {network: {enabled: true}, managedIL: true, debug: true}};
  const cil = appLaunchParameters(result, {...base, profile: 'cil'});
  assert.equal(cil.assembly, assembly);
  assert.equal(cil.image, undefined);
  assert.equal(cil.managedIL, false);
  assert.equal(cil.debug, false);
  assert.deepEqual(cil.sources, {'View.cs': 'class View {}'});
  assert.equal(cil.network.enabled, true);
  const source = appLaunchParameters(result, {...base, profile: 'source-vm'});
  assert.equal(source.image, image);
  assert.equal(source.assembly, undefined);
  assert.equal(appLaunchParameters(result, {...base, profile: 'managed-il'}).managedIL, true);
  assert.throws(() => appLaunchParameters({success: false, diagnostics: [{code: 'CS1001'}]}, {...base, profile: 'cil'}), {
    code: 'SFDA0010', diagnostics: [{code: 'CS1001'}]
  });
});

test('ownership rejects unrelated sources and different workspaces before any compile', async () => {
  let calls = 0;
  const {context, environment} = ownership(async () => { calls++; });
  context.assertSourceOwnership({uris: ['A.cs']});
  assert.throws(() => context.assertSourceOwnership({uris: ['Other.cs']}), {code: 'SFDA0012'});
  environment.files[0].text = 'unreviewed edit';
  await assert.rejects(context.compile(), {code: 'SFDA0012'});
  assert.equal(calls, 0);
  environment.files[0].text = 'class A {}';
  environment.workspace = 'Other:2';
  assert.throws(() => context.assertSourceOwnership(), {code: 'SFDA0008'});
  assert.throws(() => context.authorizeSourceChanges({before: environment.files, after: environment.files}), {code: 'SFDA0008'});
});

test('verified before/after receipts compile exactly that app projection and accept only its returned artifact', async () => {
  const calls = [];
  const result = {success: true, image: {entryPoint: 1}, assembly: new Uint8Array([1]), compilationUris: ['A.cs']};
  const {context, environment} = ownership(async options => { calls.push(options); return result; });
  const before = captureAppSources(environment.files);
  environment.files[0].text = 'class A { int x; }';
  const authorized = context.authorizeSourceChanges({before, after: environment.files});
  assert.equal(context.projection[0].text, 'class A {}', 'runtime projection changes only after code is actually applied');
  assert.equal(await context.compile(), result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'designer-app-hot-reload');
  assert.equal(calls[0].workspaceId, 'Workspace:1');
  assert.equal(calls[0].profile, 'cil');
  assert.equal(calls[0].files, authorized);
  assert.equal(calls[0].sourceProjection, authorized);
  assert.throws(() => context.assertCodeUpdate({image: {...result.image}}), {code: 'SFDA0012'});
  const compiled = context.assertCodeUpdate({image: result.image});
  context.acceptCodeUpdate(compiled);
  assert.equal(context.projection, authorized);
  assert.equal(context.authorized, null);
  assert.throws(() => context.assertCodeUpdate({image: result.image}), {code: 'SFDA0012'});
});

test('invalid receipts cannot bless edits from another source projection', () => {
  const {context, environment} = ownership();
  const before = captureAppSources(environment.files);
  environment.files[0].text = 'changed';
  assert.throws(() => context.authorizeSourceChanges({before: environment.files, after: environment.files}), {code: 'SFDA0012'});
  assert.throws(() => context.authorizeSourceChanges({before, after: before}), {code: 'SFDA0012'});
  context.authorizeSourceChanges({before, after: environment.files});
  context.uncertain = true;
  assert.throws(() => context.assertSourceOwnership(), {code: 'SFDA0011'});
});

test('source changes while compiling discard the artifact, and disposal aborts a pending build', async () => {
  let complete, entered;
  let ready = new Promise(resolve => { entered = resolve; });
  const running = ownership(options => {
    entered(options.signal);
    return new Promise(resolve => { complete = resolve; });
  });
  const first = running.context.compile();
  await ready;
  running.environment.files[0].text = 'changed during build';
  complete({success: true, image: {}});
  await assert.rejects(first, {code: 'SFDA0012'});
  assert.equal(running.context.compiled, null);
  running.environment.files[0].text = 'class A {}';
  ready = new Promise(resolve => { entered = resolve; });
  const second = running.context.compile();
  const signal = await ready;
  running.context.dispose();
  await assert.rejects(second, {code: 'SFDA0002'});
  assert.equal(signal.aborted, true);
  assert.equal(running.context.busy, false);
  complete({success: true, image: {}});
});

test('external cancellation interrupts compilation and concurrent compilation is explicitly rejected', async () => {
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const {context} = ownership(options => { entered(options.signal); return new Promise(() => {}); });
  const controller = new AbortController();
  const pending = context.compile({signal: controller.signal});
  const signal = await ready;
  await assert.rejects(context.compile(), {code: 'SFDA0013'});
  controller.abort(new DOMException('Canceled test compile', 'AbortError'));
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(signal.aborted, true);
  assert.equal(context.busy, false);
});
