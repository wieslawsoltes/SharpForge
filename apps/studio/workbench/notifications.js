import {WorkbenchEvents} from './events.js';
import {button, element, runAction} from './ui.js';

export class Notifications extends WorkbenchEvents {
  constructor({limit = 500, clock = () => Date.now(), announce = () => {}} = {}) {
    super();
    this.limit = limit;
    this.clock = clock;
    this.announce = announce;
    this.items = [];
    this.serial = 0;
  }
  add({id, message, severity = 'info', actions = [], documentUri = null, code = '', persistent = false}) {
    if (typeof message !== 'string' || !message || !['info', 'warning', 'error', 'success'].includes(severity)) {
      throw new TypeError('Invalid notification');
    }
    const item = {id: id ?? 'notification-' + ++this.serial, message, severity, actions, documentUri, code,
      persistent, timestamp: this.clock(), read: false, dismissed: false};
    const previous = this.items.findIndex(entry => entry.id === item.id);
    if (previous >= 0) this.items.splice(previous, 1);
    this.items.push(item);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
    this.emit({type: 'added', item});
    this.announce(message, {id: item.id, politeness: severity === 'error' ? 'assertive' : 'polite'});
    return item.id;
  }
  get unread() { return this.items.filter(item => !item.read && !item.dismissed).length; }
  list({documentUri, includeDismissed = false} = {}) {
    return this.items.filter(item => (includeDismissed || !item.dismissed) &&
      (documentUri === undefined || item.documentUri === documentUri)).map(item => ({...item}));
  }
  markRead(id) {
    for (const item of this.items) if (!id || item.id === id) item.read = true;
    this.emit({type: 'read', id});
  }
  dismiss(id) {
    const item = this.items.find(entry => entry.id === id);
    if (item) { item.dismissed = true; this.emit({type: 'dismissed', item}); }
  }
  mount(host, {documentUri, infoBar = false, onError = error => this.add({message: error.message, severity: 'error'})} = {}) {
    const render = () => {
      const document = host.ownerDocument;
      host.replaceChildren();
      if (!infoBar) host.append(button(document, 'Mark all read', () => this.markRead()));
      const items = this.list({documentUri}).filter(item => !infoBar || item.persistent).reverse();
      for (const item of items) {
        const row = element(document, 'section', {className: 'wb-notification wb-' + item.severity});
        row.append(element(document, 'p', {text: (item.code ? item.code + ': ' : '') + item.message}));
        for (const action of item.actions) row.append(button(document, action.label, runAction(action.run, onError)));
        row.append(button(document, 'Dismiss', () => this.dismiss(item.id), {'aria-label': 'Dismiss: ' + item.message}));
        host.append(row);
      }
      if (!items.length && !infoBar) host.append(element(document, 'p', {text: 'No notifications.'}));
    };
    render();
    return this.subscribe(render);
  }
}
