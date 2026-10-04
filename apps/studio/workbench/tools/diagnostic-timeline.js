import {WorkbenchEvents} from '../events.js';
import {button, element, select, runAction} from '../ui.js';
import {VirtualTable} from './virtual-table.js';

export class DiagnosticTimeline extends WorkbenchEvents {
  constructor({limit = 2000, clock = () => performance.now()} = {}) {
    super(); this.limit = limit; this.clock = clock; this.sessions = new Map(); this.serial = 0;
  }
  record(sessionId, event) {
    let session = this.sessions.get(sessionId);
    if (!session) this.sessions.set(sessionId, session = {events: [], samples: [], snapshots: []});
    const timestamp = this.clock();
    session.events.push({id: 'event:' + ++this.serial, timestamp, kind: event.type ?? event.event ?? 'state',
      description: event.description ?? event.reason?.description ?? event.state ?? '', ...event});
    if (session.events.length > this.limit) session.events.shift();
    const stats = event.stats ?? event.debug?.stats;
    if (stats) {
      session.samples.push({timestamp, liveBytes: stats.heap?.liveBytes ?? stats.liveBytes,
        liveObjects: stats.heap?.liveObjects ?? stats.liveObjects, cpuPercent: stats.cpuPercent,
        instructions: stats.instructions, elapsedMs: stats.elapsedMs});
      if (session.samples.length > this.limit) session.samples.shift();
    }
    this.emit({type: 'sample', sessionId});
  }
  async snapshot(session) {
    if (!session) throw new Error('Select an app session before taking a heap snapshot');
    const census = await session.request('heapCensus');
    let history = this.sessions.get(session.id);
    if (!history) this.sessions.set(session.id, history = {events: [], samples: [], snapshots: []});
    const result = {id: 'snapshot:' + ++this.serial, timestamp: this.clock(), ...census};
    history.snapshots.push(result);
    if (history.snapshots.length > 20) history.snapshots.shift();
    this.emit({type: 'snapshot', sessionId: session.id});
    return result;
  }
  diff(sessionId, beforeId, afterId) {
    const snapshots = this.sessions.get(sessionId)?.snapshots ?? [];
    const before = snapshots.find(item => item.id === beforeId), after = snapshots.find(item => item.id === afterId);
    if (!before || !after) throw new Error('Select two snapshots from the same session');
    const types = new Map((before.types ?? []).map(item => [item.type, {type: item.type, objects: -item.objects, bytes: -item.bytes}]));
    for (const item of after.types ?? []) {
      const previous = types.get(item.type) ?? {type: item.type, objects: 0, bytes: 0};
      previous.objects += item.objects; previous.bytes += item.bytes; types.set(item.type, previous);
    }
    return {objects: after.objects - before.objects, bytes: after.bytes - before.bytes, types: [...types.values()]};
  }
}

function drawTimeline(canvas, samples, metric) {
  const context = canvas.getContext('2d');
  const ratio = globalThis.devicePixelRatio ?? 1;
  const width = canvas.clientWidth || 600, height = 130;
  canvas.width = width * ratio; canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const values = samples.filter(sample => Number.isFinite(sample[metric]));
  if (!values.length) return false;
  const maximum = Math.max(1, ...values.map(sample => sample[metric]));
  const start = values[0].timestamp, span = Math.max(1, values.at(-1).timestamp - start);
  const color = globalThis.getComputedStyle?.(canvas).getPropertyValue('--wb-accent') || 'CanvasText';
  context.strokeStyle = color; context.lineWidth = 2; context.beginPath();
  values.forEach((sample, index) => {
    const x = 8 + (sample.timestamp - start) / span * (width - 16);
    const y = height - 8 - sample[metric] / maximum * (height - 16);
    if (index) context.lineTo(x, y); else context.moveTo(x, y);
  });
  context.stroke();
  return true;
}

export function mountDiagnosticTimeline(host, {model, sessions, onError}) {
  const document = host.ownerDocument;
  let sessionId = sessions?.active?.id ?? sessions?.list()[0]?.id;
  let tab = 'summary';
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const body = element(document, 'div', {className: 'wb-timeline'});
  host.replaceChildren(toolbar, body);
  let grid;
  const sessionChooser = select(document, 'Application session', [], sessionId, value => { sessionId = value; refresh(); });
  const refresh = () => {
    const available = sessions?.list() ?? [];
    const signature = available.map(session => session.id + ':' + session.name).join('\n');
    if (sessionChooser.dataset.sessions !== signature) {
      sessionChooser.replaceChildren(...available.map(session => element(document, 'option', {value: session.id, text: session.name})));
      sessionChooser.dataset.sessions = signature;
    }
    if (!available.some(session => session.id === sessionId)) sessionId = sessions?.active?.id ?? available[0]?.id;
    sessionChooser.value = sessionId ?? '';
    grid?.dispose(); grid = null;
    body.replaceChildren();
    const history = model.sessions.get(sessionId);
    if (!history) { body.append(element(document, 'p', {text: 'No samples for the selected app session.'})); return; }
    if (tab === 'events') {
      grid = new VirtualTable(body, {label: 'Diagnostic events', rows: history.events, columns: [
        {id: 'timestamp', title: 'Time (ms)', width: '120px'}, {id: 'kind', title: 'Event', width: '140px'},
        {id: 'description', title: 'Description'}
      ]});
      return;
    }
    for (const metric of tab === 'cpu' ? ['cpuPercent'] : tab === 'memory' ? ['liveBytes', 'liveObjects'] : ['liveBytes', 'cpuPercent']) {
      const canvas = element(document, 'canvas', {role: 'img', 'aria-label': metric + ' timeline'});
      body.append(element(document, 'h4', {text: metric}), canvas);
      if (!drawTimeline(canvas, history.samples, metric)) body.append(element(document, 'p', {
        text: metric === 'cpuPercent' ? 'This runtime does not report process CPU utilization.' : 'No heap sample has been reported yet.'
      }));
    }
    body.append(element(document, 'h4', {text: 'Heap snapshots'}));
    for (const snapshot of history.snapshots) body.append(element(document, 'p', {
      text: `${snapshot.id}: ${snapshot.objects} objects · ${snapshot.bytes} bytes`
    }));
    if (history.snapshots.length >= 2) {
      const [before, after] = history.snapshots.slice(-2);
      const diff = model.diff(sessionId, before.id, after.id);
      body.append(element(document, 'pre', {text: `Latest delta: ${diff.objects} objects, ${diff.bytes} bytes\n` +
        diff.types.map(type => `${type.type}: ${type.objects} objects, ${type.bytes} bytes`).join('\n')}));
    }
  };
  toolbar.append(sessionChooser,
  select(document, 'Diagnostic view', [{value: 'summary', label: 'Summary'}, {value: 'events', label: 'Events'},
    {value: 'memory', label: 'Memory Usage'}, {value: 'cpu', label: 'CPU Usage'}], tab, value => { tab = value; refresh(); }),
  button(document, 'Take heap snapshot', runAction(async () => { await model.snapshot(sessions?.get(sessionId)); refresh(); }, onError)));
  refresh();
  return {refresh, dispose: () => grid?.dispose()};
}
