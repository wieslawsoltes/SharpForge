import {DesignerAppSessions, DesignerLiveError, LiveDesignAttachment} from '../../packages/designer/src/index.js';
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
    const document = this.view.document;
    const revision = document.revision;
    const sourceSession = this.view.sourceSync?.session;
    const analysis = sourceSession?.analysis;
    if (options.standalone && sourceSession) {
      return this.openStandalone(choice, 'Opened separately from the linked C# document; source writeback is disabled.', options.signal);
    }
    const assertCurrent = () => {
      if (this.disposed || this.view.document !== document || document.revision !== revision ||
        this.view.sourceSync?.session !== sourceSession || sourceSession?.analysis !== analysis) {
        throw new DesignerLiveError('The design or source link changed during attachment. Retry the current document.', 'SFDL0004');
      }
    };
    let result;
    try {
      result = await this.attachment.attach(choice.sessionId, {
        ...choice, signal: options.signal, assertCurrent,
        linkedDocument: sourceSession ? document.snapshot() : undefined, linkedBaseline: analysis?.document
      });
    } catch (error) {
      if (error.code !== 'SFDL0009' || !sourceSession || !this.view.openStandaloneLiveDesign || !this.view.choose) throw error;
      this.view.accessibility?.announce(error.message);
      const open = 'Open separate live design (no C# writeback)';
      const answer = await this.view.choose(error.message, [open, 'Keep linked source only'], 'Keep linked source only');
      if (answer !== open) return null;
      return this.openStandalone(choice, error.reason, options.signal);
    }
    if (sourceSession) {
      this.view.live = result.live;
      this.bindRuntimeIds();
    } else this.view.replace(result.document, {live: result.live, path: this.view.path});
    this.view.status = `Attached ${this.sessions.get(choice.sessionId).projectName ?? 'app'} · session ${choice.sessionId}` +
      (sourceSession ? ' · C# link and staged edits retained' : ' · standalone live design');
    this.view.update({kind: 'live attach'});
    this.view.accessibility?.announce(this.view.status);
    return this.snapshot();
  }

  async openStandalone(choice, reason, signal) {
    if (!this.view.openStandaloneLiveDesign) {
      throw new DesignerLiveError('Open a separate design document before attaching without a source link.', 'SFDL0009');
    }
    const candidate = new LiveDesignAttachment(this.sessions);
    try {
      const result = await candidate.attach(choice.sessionId, {...choice, signal});
      if (this.disposed) throw new DesignerLiveError('The source document was closed before the live design opened.', 'SFDL0004');
      return await this.view.openStandaloneLiveDesign(result.document, {live: result.live, reason});
    } finally {
      candidate.dispose();
    }
  }

  bindRuntimeIds() {
    const baseline = this.attachment.target?.baseline;
    if (!baseline) return;
    if (this.boundBaseline !== baseline) {
      this.boundBaseline = baseline;
      this.runtimeIds = new Map(baseline.nodes.map(node => [node.id, node.runtimeId]));
    }
    for (const node of this.view.document.value.nodes) {
      delete node.runtimeId;
      if (this.runtimeIds.has(node.id)) node.runtimeId = this.runtimeIds.get(node.id);
    }
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
      const session = this.attachment.resolve(target);
      if (this.view.writeDesignerSourceForSession) return this.view.writeDesignerSourceForSession(identity, this.view);
      if (session.assertSourceOwnership || session.authorizeSourceChanges) {
        throw new DesignerLiveError('This app requires its source receipt callback before editing C# for Hot Reload.', 'SFDL0006');
      }
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
    if (event.kind !== 'selection' && this.view.live && this.attachment.target?.sourceLinked) this.bindRuntimeIds();
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
