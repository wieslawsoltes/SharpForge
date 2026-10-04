import assert from 'node:assert/strict';
import { jsonHash, plan } from './a19-correction-report.mjs';

function sourceRecords(count) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(3, '0');
    const code = `namespace Fixture { public class File${suffix} { public int Value() { return ${index}; } } }\n// `;
    return { uri: `src/File${suffix}.cs`, text: code + 'x'.repeat(plan.sourceLength - code.length - 1) + '\n', version: 3 };
  });
}

function snapshotWorkload(api, specification) {
  const records = sourceRecords(specification.sources);
  const documents = new api.DocumentService({ records,
    createModel: record => new api.EditorModel(record.text, { uri: record.uri, version: record.version }) });
  let projects;
  try {
    assert.equal(documents.models.size, records.length, 'Every source must have a real EditorModel');
    for (const record of documents.files) {
      assert.equal(typeof Object.getOwnPropertyDescriptor(record, 'text')?.get, 'function', 'Use lazy document text');
    }
    const projectId = 'SnapshotFixture.csproj';
    const projectText = api.createCsproj({ assemblyName: 'SnapshotFixture', outputType: 'Library', files: records.map(file => file.uri) });
    const system = new api.ProjectSystem([{ path: projectId, text: projectText }, ...documents.files]);
    system.load(projectId);
    assert.deepEqual(system.diagnostics, [], 'Both revisions must load an eligible project');
    const state = { files: documents.files, projectSystem: system, name: 'SnapshotFixture', extensionConfig: null };
    projects = new api.StudioProjects({ documents }, { state: () => state });
    const expected = { files: records, compilationOptions: system.compilationOptions(projectId),
      assemblyName: system.projects.get(projectId).name, extensions: null, outputKind: 'library', loadingDiagnostics: [] };
    const correctnessSha256 = jsonHash(expected);
    return {
      fixture: { records, projectText }, correctnessSha256,
      operation: () => projects.snapshot(projectId),
      verify(value) {
        assert.deepEqual(value, expected, 'Snapshot text, identities, versions, options and diagnostics must remain exact');
        assert.equal(documents.dirtyFiles.size, 0, 'Read-only capture must not dirty models');
      },
      dispose() { projects.dispose(); documents.dispose(); }
    };
  } catch (error) {
    projects?.dispose();
    documents.dispose();
    throw error;
  }
}

function runtimeWorkload(api) {
  let callbacks = 0;
  const unexpectedCallback = () => { callbacks++; };
  // Ready is the actual scheduling guard; no managed program or worker pump runs in this Node timing case.
  const session = { vm: { state: 'ready' }, pump: unexpectedCallback };
  const activity = new api.RuntimeActivity({ getSession: () => session, getSerial: () => 1,
    flush: unexpectedCallback, publishState: unexpectedCallback, onError: unexpectedCallback });
  return {
    fixture: { sessionId: 1, state: 'ready', lifecycle: ['start', 'schedule', 'stop'], nativeTimers: true },
    correctnessSha256: jsonHash({ samplingScheduled: true, pumpScheduled: true, stopped: true, callbacks: 0 }),
    operation() {
      activity.start();
      activity.schedule();
      const scheduled = activity.profileTimer !== null && activity.pumpTimer !== null;
      activity.stop();
      return scheduled;
    },
    verify(value) {
      assert.equal(value, true, 'Both native timer registrations must occur');
      assert.equal(activity.started, false);
      assert.equal(activity.execution.active, false);
      for (const key of ['pumpTimer', 'profileTimer', 'animationTimer']) assert.equal(activity[key], null);
      assert.equal(callbacks, 0, 'No pump, notification or timer callback belongs in this measurement');
    },
    dispose() { activity.stop(); }
  };
}

function keybindingWorkload(api) {
  let commands = 0;
  const keybindings = new api.KeybindingService({ execute: () => { commands++; }, platform: 'windows' });
  keybindings.register({ id: 'fixture.chord', command: 'fixture.command', keys: 'Ctrl+K Ctrl+C', scope: 'Global' });
  const event = { key: 'k', code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false,
    preventDefault() {}, stopPropagation() {} };
  const options = { scope: 'Global' };
  return {
    fixture: { keys: 'Ctrl+K Ctrl+C', prefix: 'Ctrl+K', scope: 'Global', platform: 'windows', nativeTimers: true },
    correctnessSha256: jsonHash({ acceptedPrefix: true, pendingCreated: true, cancelled: true, commands: 0 }),
    operation() {
      const accepted = keybindings.handle(event, options);
      const pending = keybindings.pending !== null;
      keybindings.cancel();
      return accepted && pending;
    },
    verify(value) {
      assert.equal(value, true, 'The real chord prefix must register a native timer');
      assert.equal(keybindings.pending, null);
      assert.equal(commands, 0, 'Cancelling a prefix must never execute its command');
    },
    dispose() { keybindings.dispose(); }
  };
}

/** Construct a single owned fixture outside timing; no workers, injected timers or product method patches. */
export function createWorkload(api, specification) {
  if (specification.sources) return snapshotWorkload(api, specification);
  if (specification.id === 'runtime.activity.start-schedule-stop') return runtimeWorkload(api);
  return keybindingWorkload(api);
}
