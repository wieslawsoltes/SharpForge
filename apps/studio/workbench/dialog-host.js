import {button, element} from './ui.js';

/** Modal dialog lifecycle owns focus, cancellation and rollback; only the topmost dialog receives keys. */
export class DialogHost {
  constructor({document = globalThis.document, root = document.body, onError = error => { throw error; }} = {}) {
    this.document = document;
    this.root = root;
    this.onError = onError;
    this.stack = [];
    this.serial = 0;
  }

  open({title, render, actions = [], onCancel = () => {}, initialFocus, signal}) {
    signal?.throwIfAborted();
    const document = this.document;
    const previous = document.activeElement;
    const controller = new AbortController();
    const overlay = element(document, 'div', {className: 'wb-dialog-overlay'});
    const dialog = element(document, 'section', {className: 'wb-dialog', role: 'dialog', 'aria-modal': 'true', tabIndex: -1});
    const titleId = 'wb-dialog-title-' + ++this.serial;
    const heading = element(document, 'h2', {id: titleId, text: title});
    dialog.setAttribute('aria-labelledby', titleId);
    const body = element(document, 'div', {className: 'wb-dialog-body'});
    const footer = element(document, 'footer', {className: 'wb-dialog-footer'});
    const error = element(document, 'p', {className: 'wb-error', role: 'alert', hidden: true});
    const handle = {dialog, body, signal: controller.signal, closed: false, close: null, cancel: null};
    let cleanup;
    const finish = value => {
      if (handle.closed) return;
      handle.closed = true;
      controller.abort();
      signal?.removeEventListener('abort', handle.cancel);
      const index = this.stack.indexOf(handle);
      if (index >= 0) this.stack.splice(index, 1);
      cleanup?.();
      overlay.remove();
      const active = this.stack.at(-1)?.dialog;
      if (active) active.focus();
      else if (previous?.isConnected) previous.focus();
      handle.resolve(value);
    };
    handle.close = finish;
    handle.cancel = () => {
      try { onCancel(); finish(null); } catch (failure) { this.onError(failure); }
    };
    handle.result = new Promise(resolve => { handle.resolve = resolve; });
    const invoke = async action => {
      if (handle.busy) return;
      handle.busy = true;
      try {
        const value = await action.run(handle);
        if (value !== false && action.close !== false) finish(value);
      } catch (failure) {
        error.hidden = false;
        error.textContent = failure.message;
      } finally { handle.busy = false; }
    };
    for (const action of actions) footer.append(button(document, action.label, () => invoke(action)));
    if (!actions.some(action => action.cancel)) footer.append(button(document, 'Cancel', handle.cancel));
    dialog.append(heading, body, error, footer);
    overlay.append(dialog);
    this.root.append(overlay);
    this.stack.push(handle);
    dialog.addEventListener('keydown', event => this.handleKey(event, handle), {signal: controller.signal});
    signal?.addEventListener('abort', handle.cancel, {once: true});
    try { cleanup = render?.(body, handle); } catch (failure) { finish(null); throw failure; }
    const target = typeof initialFocus === 'function' ? initialFocus(body) : initialFocus ? body.querySelector(initialFocus) : null;
    (target ?? body.querySelector('input,button,select,textarea,[tabindex="0"]') ?? dialog).focus();
    return handle;
  }

  handleKey(event, handle) {
    if (this.stack.at(-1) !== handle) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handle.cancel();
    }
    if (event.key !== 'Tab') return;
    const nodes = [...handle.dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && !node.hidden && !node.closest('[hidden]'));
    if (!nodes.length) { event.preventDefault(); handle.dialog.focus(); return; }
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (this.document.activeElement === first || this.document.activeElement === handle.dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  confirm(title, message, label = 'Continue') {
    return this.open({
      title, render: host => { host.append(element(this.document, 'p', {text: message})); },
      actions: [{label, run: () => true}]
    }).result;
  }

  dispose() {
    for (const handle of [...this.stack].reverse()) handle.cancel();
  }
}
