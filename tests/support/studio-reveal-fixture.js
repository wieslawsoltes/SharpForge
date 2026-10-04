import { createWorkbenchServices, legacyRuntimeEvent } from '../../apps/studio/workbench/sessions.js';
import { StudioExecution } from '../../apps/studio/workbench/studio-execution.js';
import { createStudioRuntimeReveals } from '../../apps/studio/workbench/studio-runtime-reveals.js';
import { createCommandRegistry } from '../../apps/studio/commands/registry.js';
import { fakeWorkers, fakeRuntime, compileResult } from '../a19-session-fixtures.js';

export function studioRevealFixture(context, { build = () => compileResult() } = {}) {
  const state = { active: 'A.cs', panel: 'properties', nativeMode: false, debugSources: new Map(), hotEdit: false };
  const revealed = [];
  const navigated = [];
  const errors = [];
  let execution;
  let runtimeViews;
  const fake = fakeWorkers((message, worker) => message.method === 'build' ? build(message, worker) : fakeRuntime(message, worker));
  const setPanel = panel => {
    services.reveal.userIntent();
    state.panel = panel;
    revealed.push(panel);
  };
  const services = createWorkbenchServices({
    workerFactory: fake.factory,
    projects: ['A', 'B', 'C'].map(id => ({ id, outputType: 'exe', files: [{ uri: id + '.cs', text: '// source', version: 1 }] })),
    onReveal: setPanel,
    onApplication: session => execution.followLaunch(session),
    onActiveState: (debug, session) => {
      if (!debug || !session) return;
      const event = legacyRuntimeEvent(session, debug);
      if (event.state === 'paused') { runtimeViews.paused(event); runtimeViews.symbols(event); }
      if (event.state === 'faulted' || event.state === 'terminated') runtimeViews.completed(event);
    }
  });
  services.startup.select('A');
  const projects = {
    selectedId: 'A', currentProjectId: 'A', sync() {}, primeBreakpoints() {},
    sourceUris: id => [id + '.cs'], serviceFor: () => services.builds.active
  };
  execution = new StudioExecution({ services, projects, state: () => state, ui: {
    setPanel, applyAnalysis() {}, status() {}, refresh() {}, setBusy() {}, stopped() {},
    error: error => errors.push(error), openAssembly: () => { throw new Error('Unexpected assembly inspection'); }
  } });
  runtimeViews = createStudioRuntimeReveals({
    state, reveals: execution.reveals, setPanel, renderPanel() {},
    matchesSource: uri => ['A.cs', 'B.cs', 'C.cs'].includes(uri),
    openSource: point => {
      services.reveal.userIntent();
      state.active = point.uri;
      navigated.push(point);
    },
    showSymbolSource: point => { services.reveal.userIntent(); navigated.push(point); setPanel('symbol-source'); }
  });
  const commands = createCommandRegistry({ onExecute: id => execution.reveals.command(id) });
  context.after(() => { commands.dispose(); execution.dispose(); services.dispose(); });
  const emit = (session, stateName, point = { uri: session.projectId + '.cs', line: 3, column: 2 }) => {
    const event = { event: 'state', sessionId: session.runtimeSession, state: stateName, point, frames: [],
      output: '', stats: {}, fault: stateName === 'faulted' ? { type: 'TestFailure', message: 'fixture' } : undefined };
    session.worker.worker.emit(event);
    return legacyRuntimeEvent(session, event);
  };
  return { services, execution, projects, state, fake, errors, revealed, navigated, runtimeViews, commands, setPanel, emit };
}
