import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LaunchProfiles } from '../apps/studio/workbench/launch-profiles.js';
import { compileProgram } from './a19-runtime-programs.js';
import { connectRuntimeWorker } from './a19-runtime-worker-client.js';

const source = await readFile(new URL('./fixtures/a19/multi-session/WindowProgram.cs', import.meta.url), 'utf8');

async function launchWindow(context, profiles, name, managedIL) {
  const projectId = `${name}/${name}.csproj`;
  const label = name.toLowerCase();
  const compiled = compileProgram(source.replaceAll('APP_NAME', name).replaceAll('APP_OUTPUT', `${label}-output`), {
    includeDebug: true
  });
  profiles.set(projectId, {
    id: `${label}-selected`, renderer: 'dom', arguments: [`${label} argument 雪`],
    environment: { APP_ENV: `${label} environment` }
  });
  const worker = connectRuntimeWorker(context);
  await worker.ready();
  const launch = await worker.request('launch', {
    assembly: compiled.assembly, debug: false, managedIL, ...profiles.launchOptions(projectId)
  });
  const state = await worker.wait(event => event.event === 'state' && event.sessionId === launch.sessionId &&
    (event.state === 'terminated' || event.state === 'faulted'));
  assert.equal(state.state, 'terminated', JSON.stringify(state.fault));
  assert.equal(state.uiActive, true);
  assert.equal(state.output, `${label}-output\n${label} argument 雪\n${label} environment\n`);
  const scene = await worker.request('uiScene', { sessionId: launch.sessionId });
  assert.equal(scene.windows.length, 1);
  assert.equal(scene.nodes.find(node => node.properties.Text === `${name} window`)?.type, 'Microsoft.UI.Xaml.Controls.TextBlock');
  return { worker, launch, scene, state };
}

for (const managedIL of [false, true]) {
  const engine = managedIL ? 'direct CIL' : 'source VM';
  test(`Studio multi-session C# fixture preserves WinUI, argv, environment and stop isolation in ${engine}`, async context => {
    const profiles = new LaunchProfiles();
    context.after(() => profiles.dispose());
    const alpha = await launchWindow(context, profiles, 'Alpha', managedIL);
    const beta = await launchWindow(context, profiles, 'Beta', managedIL);
    assert.equal(alpha.launch.sessionId, 1);
    assert.equal(beta.launch.sessionId, 1);
    assert.notStrictEqual(alpha.worker, beta.worker);
    await alpha.worker.request('stop', { sessionId: alpha.launch.sessionId });
    const stopped = await alpha.worker.request('state', { sessionId: alpha.launch.sessionId });
    assert.equal(stopped.uiActive, false);
    const remaining = await beta.worker.request('state', { sessionId: beta.launch.sessionId });
    assert.equal(remaining.uiActive, true);
    assert.equal(remaining.output, beta.state.output);
    assert.deepEqual(await beta.worker.request('uiScene', { sessionId: beta.launch.sessionId }), beta.scene);
  });
}
