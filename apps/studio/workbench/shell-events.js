import { BuildTasks } from './build-tasks.js';

/** Subscribe once to service events, invalidate only relevant tools, and preserve background session isolation. */
export function subscribeShellServices(shell) {
  const disposers = [];
  const buildTasks = shell.services.builds && new BuildTasks({ builds: shell.services.builds, queue: shell.services.queue,
    tasks: shell.tasks, onError: error => shell.onError?.(error) });
  if (buildTasks) disposers.push(() => buildTasks.dispose());
  const listen = (service, callback) => { if (service?.subscribe) disposers.push(service.subscribe(callback)); };
  const invalidate = (...ids) => { for (const id of ids) shell.invalidateTool(id); };
  listen(shell.services.output, () => invalidate('output'));
  listen(shell.services.diagnostics, () => invalidate('problems'));
  listen(shell.documents, event => {
    if (event.type === 'activated') {
      shell.recent.add({uri: event.uri, kind: 'file', workspaceId: shell.options.workspaceId});
      shell.lastDocumentKind = 'code';
      invalidate('outline', 'toolbox', 'properties', 'code-definition', 'solution-view', 'object-browser');
    }
    if (['changed', 'added', 'removed', 'reset'].includes(event.type)) {
      shell.bookmarks.trackChanges(event);
      invalidate('outline', 'class-view', 'bookmarks', 'code-definition', 'solution-view');
      if (event.type === 'reset') invalidate('object-browser');
      shell.taskListDirty = true;
    }
    shell.updateContext();
  });
  listen(shell.services.builds, event => {
    buildTasks.receive(event);
    if (['completed', 'failed', 'cancelled'].includes(event.type)) {
      if (event.type === 'completed') shell.announcer?.announce('Build ' + (event.result?.success ? 'succeeded' : 'failed') + ': ' + event.projectId,
        {id: 'build-result:' + event.projectId + ':' + event.revision});
    }
    if (['completed', 'analysis'].includes(event.type)) {
      invalidate('class-view', 'outline', 'problems', 'solution-view');
      if (shell.taskListDirty && shell.isToolVisible('task-list')) shell.scanTasks();
    }
    shell.updateContext();
  });
  listen(shell.services.sessions, event => {
    if (event.session) shell.timeline.record(event.session.id, event.event ?? event.session.debug ?? event,
      {identity: event.session.identity, name: event.session.name, projectId: event.projectId,
        runtimeSession: event.session.runtimeSession, generation: event.generation});
    invalidate('diagnostic-timeline');
    if (event.active) {
      invalidate('output', 'properties');
      const debug = event.session?.debug;
      if (debug?.state === 'paused') shell.announcer?.announce(debug.reason?.description ?? 'Execution paused', {
        id: `debug-stop:${event.session.id}:${debug.point?.uri}:${debug.point?.line}:${event.generation ?? ''}`
      });
      shell.updateContext();
    }
  });
  listen(shell.references, () => invalidate('references'));
  listen(shell.timeline, () => invalidate('diagnostic-timeline'));
  listen(shell.bookmarks, () => invalidate('bookmarks'));
  listen(shell.taskList, () => invalidate('task-list'));
  listen(shell.tests, () => { invalidate('test-explorer'); shell.commands.invalidate(); });
  listen(shell.settings, event => shell.applySettings(event.settings));
  listen(shell.search, event => {
    if (event.type !== 'results') return;
    shell.announcer?.announce(`${event.result.matches.length} search matches in ${event.result.scannedFiles} scanned files`,
      {id: 'search:' + event.result.id + ':' + event.result.query});
  });
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
