import { ControlEvents, ControlError, registerFamily, stateFor } from '../policy/events.js';
import { HostPermissionPolicy } from '../policy/capabilities.js';

/** Sandboxed frame navigation; cross-origin DOM/script injection is never an implicit capability. */
export class WebViewSession extends ControlEvents {
  constructor({ policy = new HostPermissionPolicy() } = {}) {
    super();
    this.policy = policy;
    this.history = [];
    this.index = -1;
    this.source = '';
    this.html = null;
  }
  get canGoBack() { return this.index > 0; }
  get canGoForward() { return this.index + 1 < this.history.length; }
  navigate(uri, { approved = false } = {}) {
    let source;
    try { source = this.policy.url(uri, { capability: 'webview' }); }
    catch (error) {
      this.emit('NavigationCompleted', { IsSuccess: false, WebErrorStatus: 'PermissionDenied', Code: error.code });
      return false;
    }
    if (!approved) {
      const args = this.emit('NavigationStarting', { Uri: source, Cancel: false });
      if (args.Cancel) return false;
    }
    this.history.splice(this.index + 1);
    this.history.push(source);
    if (this.history.length > 1000) this.history.shift();
    this.index = this.history.length - 1;
    this.source = source;
    this.html = null;
    return true;
  }
  navigateToString(html) {
    if (typeof html !== 'string' || html.length > 4 * 1024 * 1024) throw new ControlError('SFUI16B4', 'WebView document exceeds its size limit');
    this.html = html;
    this.source = '';
  }
  goBack() { return this.moveHistory(-1); }
  goForward() { return this.moveHistory(1); }
  moveHistory(direction) {
    const index = this.index + direction;
    if (index < 0 || index >= this.history.length) return false;
    const source = this.policy.url(this.history[index], { capability: 'webview' });
    if (this.emit('NavigationStarting', { Uri: source, Cancel: false }).Cancel) return false;
    this.index = index;
    this.source = source;
    this.html = null;
    return true;
  }
  executeScriptAsync() { throw new ControlError('SFUI16B5', 'ExecuteScriptAsync is unavailable in the sandboxed WebView adapter'); }
  snapshot() { return { version: 1, history: [...this.history], index: this.index, source: this.source, html: this.html }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI16B4', 'Invalid WebView snapshot');
    this.history = [...snapshot.history]; this.index = snapshot.index; this.source = snapshot.source; this.html = snapshot.html;
  }
}

function sanitizedDocument(document, html) {
  const parser = new document.defaultView.DOMParser();
  const result = parser.parseFromString(html, 'text/html');
  for (const element of result.querySelectorAll('script,iframe,object,embed,link,meta,base,form,style,svg,math')) element.remove();
  for (const element of result.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
    if (attribute.name.startsWith('on') || ['style', 'srcdoc', 'formaction'].includes(attribute.name)) element.removeAttribute(attribute.name);
    else if (['href', 'src'].includes(attribute.name) && !/^(?:https?:|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
  }
  return '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:;">' + result.body.outerHTML;
}

function webViewState(context, node) {
  return stateFor(context, node, 'webview', () => {
    const model = new WebViewSession({ policy: context.services.permissions });
    for (const name of ['NavigationStarting', 'NavigationCompleted']) model.on(name, args => context.emit(node, name, args));
    return model;
  });
}

export function registerWebViewRenderer(registry) {
  registerFamily(registry, 'WebView2', { create(context) {
    const element = context.document.createElement('iframe');
    element.sandbox = 'allow-forms';
    element.referrerPolicy = 'no-referrer';
    element.title = 'Embedded web content';
    return element;
  }, render(context, node, element) {
    const model = webViewState(context, node);
    if (node.properties.Source && node.properties.Source !== model.source) model.navigate(node.properties.Source, { approved: true });
    if (!node.properties.Source && typeof node.properties.Html === 'string' && node.properties.Html !== model.html) {
      model.navigateToString(node.properties.Html);
    }
    if (model.html !== null) {
      element.removeAttribute('src');
      const html = sanitizedDocument(context.document, model.html);
      if (element.srcdoc !== html) element.srcdoc = html;
    } else {
      element.removeAttribute('srcdoc');
      if (model.source && element.src !== model.source) element.src = model.source;
    }
  }, events: {
    load(context, node) { context.emit(node, 'NavigationCompleted', { IsSuccess: true }); return true; },
    error(context, node) { context.emit(node, 'NavigationCompleted', { IsSuccess: false, WebErrorStatus: 'Unknown' }); return true; }
  } });
}
