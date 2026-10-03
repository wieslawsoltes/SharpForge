import {DesignerAppSessions, LiveDesignAttachment} from '../../packages/designer/src/index.js';
import {chooseDesignerAttachment} from './designer-live-picker.js';
import {DesignerLiveSelection} from './designer-live-selection.js';
import {designerButton} from './designer-command-buttons.js';

/** Studio composition for scoped snapshots, patches, app selection and source Hot Reload. */
export class DesignerLiveAttachment {
  constructor(view, {sessions = view.appSessions} = {}) {
    this.view = view;
    this.ownsSessions = !sessions;
    this.sessions = sessions ?? new DesignerAppSessions();
    this.attachment = new LiveDesignAttachment(this.sessions);
    this.selection = new DesignerLiveSelection(view, this.attachment);
    this.installed = false;
    this.disposed = false;
  }

  install() {
    if (this.installed || this.disposed || !this.view.chrome.commandBar) return;
    this.installed = true;
    const holder = this.view.panel('designer').ownerDocument.createElement('div');
    holder.innerHTML = designerButton('refresh', 'Apply to source and hot reload', 'source-hot-reload');
    this.hotReloadButton = holder.firstElementChild;
    this.hotReloadButton.onclick = () => this.view.safe(() => this.hotReload());
    this.view.chrome.commandBar.add(this.hotReloadButton);
  }

  async attach(sessionId, options = {}) {
    this.view.refreshAppSessions?.();
    const choice = sessionId === undefined ? await chooseDesignerAttachment(this.view, this.sessions) : {
      sessionId, generation: options.generation ?? this.sessions.get(sessionId)?.generation, windowId: options.windowId
    };
    if (!choice) return null;
    const result = await this.attachment.attach(choice.sessionId, {...choice, signal: options.signal});
    if (this.disposed) return null;
    this.view.replace(result.document, {live: result.live, path: this.view.path});
    this.view.status = `Attached ${this.sessions.get(choice.sessionId).projectName ?? 'app'} · session ${choice.sessionId}`;
    this.view.update({kind: 'live attach'});
    this.view.accessibility?.announce(this.view.status);
    return this.snapshot();
  }

  async apply(options = {}) {
    const revision = this.view.document.revision;
    const result = await this.attachment.apply(this.view.document.snapshot(), options);
    this.acceptResult(result);
    this.view.status = `Applied ${result.commands ?? 0} live changes to session ${this.attachment.target.sessionId}` +
      (revision !== this.view.document.revision ? ' · newer edits remain staged' : '');
    this.view.update({kind: 'live apply'});
    return result;
  }

  acceptResult(result) {
    for (const node of this.view.document.value.nodes) {
      if (Object.hasOwn(result.bindings, node.id)) node.runtimeId = result.bindings[node.id];
    }
    this.view.live = this.attachment.target;
  }

  async hotReload({signal} = {}) {
    if (!this.view.sourceSync.session) throw new Error('Connect the attached design to its C# source before Hot Reload');
    const target = this.attachment.target;
    const writeSource = async identity => {
      this.attachment.resolve(target);
      if (this.view.writeDesignerSourceForSession) return this.view.writeDesignerSourceForSession(identity, this.view);
      if (this.view.state.readOnly) throw new Error('Enable source editing for this paused app before Hot Reload');
      return this.view.sourceSync.write();
    };
    const result = await this.attachment.hotReload(this.view.document.snapshot(), {writeSource, signal});
    this.acceptResult(result);
    this.view.status = `Source and code generation ${result.codeVersion} applied to session ${target.sessionId}`;
    this.view.update({kind: 'live apply'});
    return result;
  }

  update(event = {}) {
    this.install();
    if (this.hotReloadButton) this.hotReloadButton.disabled = !this.view.live || !this.view.sourceSync.session;
    if (event.kind === 'selection' && this.view.live) this.view.safe(() => this.selection.fromDesigner());
    if (!this.view.live && this.attachment.target) this.attachment.detach();
  }

  snapshot() {
    const target = this.attachment.target;
    return target ? {sessionId: target.sessionId, generation: target.generation, sceneRevision: target.sceneRevision} : null;
  }

  dispose() {
    this.disposed = true;
    this.selection.dispose();
    this.attachment.dispose();
    if (this.ownsSessions) this.sessions.dispose();
  }
}
