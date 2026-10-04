import {button, element, select, runAction} from '../ui.js';
import {VirtualTable} from './virtual-table.js';
import {diagnosticMetrics, drawDiagnosticGraph, drawEventTimeline, executionSummary} from './diagnostic-graphs.js';
export {DiagnosticTimeline} from './diagnostic-timeline-model.js';

function graphs(body, history, tab) {
  const document = body.ownerDocument;
  const metrics = tab === 'cpu' ? ['occupancyPercent'] : tab === 'memory' ? ['liveBytes', 'liveObjects'] : ['liveBytes', 'occupancyPercent'];
  for (const metric of metrics) {
    const samples = metric === 'occupancyPercent' ? history.cpuSamples : history.samples;
    const canvas = element(document, 'canvas', {role: 'img', 'aria-label': diagnosticMetrics[metric].label + ' timeline'});
    body.append(element(document, 'h4', {text: diagnosticMetrics[metric].label}), canvas);
    if (!drawDiagnosticGraph(canvas, samples, metric)) body.append(element(document, 'p', {
      text: metric === 'occupancyPercent' ? history.executionError ?? 'Waiting for measured worker execution samples.' : 'No managed heap sample yet.'
    }));
    if (metric !== 'occupancyPercent' || !samples.length) continue;
    const summary = executionSummary(samples);
    body.append(element(document, 'p', {text: `Latest ${summary.latest.toFixed(2)}% · weighted mean ${summary.mean.toFixed(2)}% · ` +
      `peak ${summary.peak.toFixed(2)}% · ${summary.busyMs.toFixed(2)} ms executing across ${summary.intervals} measured intervals.`}));
    body.append(element(document, 'p', {text: 'Synchronous managed, UI and debugger work divided by actual worker wall time. ' +
      'The time axis starts at the committed runtime launch. Browser scheduling affects interval duration.'}));
  }
}

function snapshots(body, history, model) {
  const document = body.ownerDocument;
  body.append(element(document, 'h4', {text: 'Heap snapshots'}));
  for (const snapshot of history.snapshots) body.append(element(document, 'p', {
    text: `${snapshot.id}: ${snapshot.objects} objects · ${snapshot.bytes} bytes` + (snapshot.stamp ? ' · heap ' + snapshot.stamp : '')
  }));
  if (history.snapshots.length < 2) return;
  const [before, after] = history.snapshots.slice(-2), diff = model.diff(history.id, before.id, after.id);
  body.append(element(document, 'pre', {text: `Latest delta: ${diff.objects} objects, ${diff.bytes} bytes\n` +
    diff.types.map(type => `${type.kind ? type.kind + ' ' : ''}${type.type}: ${type.objects} objects, ${type.bytes} bytes`).join('\n')}));
}

function diagnosticBody(body, history, tab, model) {
  if (!history) { body.append(element(body.ownerDocument, 'p', {text: 'No samples for the selected app session.'})); return null; }
  if (tab !== 'events') {
    graphs(body, history, tab);
    snapshots(body, history, model);
    return null;
  }
  const canvas = element(body.ownerDocument, 'canvas', {role: 'img', 'aria-label': 'Diagnostic event timeline'});
  const table = element(body.ownerDocument, 'div');
  body.append(canvas, table);
  drawEventTimeline(canvas, history.events);
  return new VirtualTable(table, {label: 'Diagnostic events', rows: history.events, columns: [
    {id: 'timestamp', title: 'Delivered at (ms)', width: '140px'}, {id: 'kind', title: 'Event', width: '140px'},
    {id: 'description', title: 'Description'}
  ]});
}

export function mountDiagnosticTimeline(host, {model, sessions, executionCapture, onError}) {
  const document = host.ownerDocument;
  let sessionId = sessions?.active?.id ?? sessions?.list()[0]?.id, launchId = '', tab = 'summary', grid;
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const body = element(document, 'div', {className: 'wb-timeline'});
  host.replaceChildren(toolbar, body);
  const sessionChooser = select(document, 'Application session', [], sessionId, value => { sessionId = value; launchId = ''; refresh(); });
  const launchChooser = select(document, 'Captured launch', [], launchId, value => { launchId = value; refresh(); });
  const snapshot = button(document, 'Take heap snapshot', runAction(async () => {
    await model.snapshot(sessions?.get(sessionId)); refresh();
  }, onError));
  const pause = button(document, 'Pause CPU updates', () => { executionCapture.setPaused(!executionCapture.paused); refresh(); });
  const refresh = () => {
    const available = new Map([...model.sessions].map(([id, history]) => [id, {id, name: history.name}]));
    for (const session of sessions?.list() ?? []) available.set(session.id, session);
    const signature = [...available.values()].map(session => session.id + ':' + session.name).join('\n');
    if (sessionChooser.dataset.sessions !== signature) {
      sessionChooser.replaceChildren(...[...available.values()].map(session => element(document, 'option', {value: session.id, text: session.name})));
      sessionChooser.dataset.sessions = signature;
    }
    if (!available.has(sessionId)) sessionId = sessions?.active?.id ?? available.keys().next().value;
    sessionChooser.value = sessionId ?? '';
    const launches = [...model.histories.values()].filter(history => history.appId === sessionId && history.runtimeSession !== 0);
    const launchSignature = launches.map(history => history.id).join('\n');
    if (launchChooser.dataset.launches !== launchSignature) {
      launchChooser.replaceChildren(element(document, 'option', {value: '', text: 'Latest launch'}), ...launches.map(history =>
        element(document, 'option', {value: history.id, text: `Worker ${history.generation ?? '?'} · launch ${history.runtimeSession ?? '?'}`})));
      launchChooser.dataset.launches = launchSignature;
    }
    if (launchId && !model.histories.has(launchId)) launchId = '';
    launchChooser.value = launchId;
    const history = launchId ? model.histories.get(launchId) : model.sessions.get(sessionId);
    const session = sessions?.get(sessionId);
    snapshot.disabled = !session?.live || session.runtimeSession === null || !!history && history.identity !== (session.identity ?? session.id);
    pause.textContent = executionCapture?.paused ? 'Resume CPU updates' : 'Pause CPU updates';
    grid?.dispose();
    body.replaceChildren();
    grid = diagnosticBody(body, history, tab, model);
  };
  toolbar.append(sessionChooser, launchChooser,
    select(document, 'Diagnostic view', [{value: 'summary', label: 'Summary'}, {value: 'events', label: 'Events'},
      {value: 'memory', label: 'Memory Usage'}, {value: 'cpu', label: 'CPU Usage'}], tab, value => { tab = value; refresh(); }), snapshot);
  if (executionCapture) toolbar.append(pause);
  refresh();
  return {refresh, dispose: () => grid?.dispose()};
}
