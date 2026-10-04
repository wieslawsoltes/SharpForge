import {WorkbenchEvents, assertId} from './events.js';
import {button, element} from './ui.js';

export class TaskCenter extends WorkbenchEvents {
  constructor({limit = 100, clock = () => performance.now()} = {}) {
    super();
    this.limit = limit;
    this.clock = clock;
    this.tasks = new Map();
    this.serial = 0;
  }
  begin({id = 'operation-' + ++this.serial, label, sessionId = null, projectId = null, cancel} = {}) {
    assertId(id);
    assertId(label, 'Operation label');
    if (this.tasks.has(id)) throw new Error('Duplicate operation ' + id);
    if (this.running.length >= this.limit) throw new Error('Too many concurrent workbench operations');
    const controller = new AbortController();
    const task = {id, label, sessionId, projectId, status: 'running', progress: null, started: this.clock(), cancel, controller};
    this.tasks.set(id, task);
    this.emit({type: 'started', task});
    const finish = (status, error) => {
      if (task.status !== 'running' && task.status !== 'cancelling') return;
      task.status = status;
      task.error = error?.message;
      task.elapsed = this.clock() - task.started;
      this.emit({type: 'finished', task});
      const completed = [...this.tasks.values()].filter(item => !['running', 'cancelling'].includes(item.status));
      for (const item of completed.slice(0, Math.max(0, completed.length - this.limit))) this.tasks.delete(item.id);
    };
    return {
      id, signal: controller.signal,
      report: (progress, message) => {
        if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new RangeError('Progress must be 0..1');
        if (task.status !== 'running') return;
        task.progress = progress;
        task.message = message;
        this.emit({type: 'progress', task});
      },
      complete: () => finish(controller.signal.aborted ? 'cancelled' : 'completed'),
      fail: error => finish(error?.name === 'AbortError' ? 'cancelled' : 'failed', error),
      cancel: () => this.cancel(id)
    };
  }
  get running() { return [...this.tasks.values()].filter(task => ['running', 'cancelling'].includes(task.status)); }
  list() { return [...this.tasks.values()].map(({controller, cancel, ...task}) => ({...task})); }
  cancel(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return false;
    task.status = 'cancelling';
    task.controller.abort();
    task.cancel?.();
    this.emit({type: 'cancelling', task});
    return true;
  }
  async run(options, action) {
    const operation = this.begin(options);
    try { const value = await action(operation); operation.complete(); return value; }
    catch (error) { operation.fail(error); throw error; }
  }
  mount(host) {
    const render = () => {
      const document = host.ownerDocument;
      host.replaceChildren();
      for (const task of this.list().reverse()) {
        const row = element(document, 'div', {className: 'wb-task'});
        row.append(element(document, 'strong', {text: task.label}), element(document, 'span', {text: task.message ?? task.status}));
        if (task.progress !== null) row.append(element(document, 'progress', {value: task.progress, max: 1, 'aria-label': task.label}));
        if (task.status === 'running') row.append(button(document, 'Cancel', () => this.cancel(task.id)));
        if (task.error) row.append(element(document, 'p', {className: 'wb-error', text: task.error}));
        host.append(row);
      }
      if (!this.tasks.size) host.append(element(document, 'p', {text: 'No background operations.'}));
    };
    render();
    return this.subscribe(render);
  }
  dispose() {
    for (const task of this.running) this.cancel(task.id);
    this.tasks.clear();
    super.dispose();
  }
}
