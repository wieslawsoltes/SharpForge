import {captureAppSources, sameAppSources, appWorkspaceIdentity} from './designer-app-host-source.js';
import {DesignerAppHostError} from './designer-app-host-errors.js';

/** Pins the main worker's source identity at compilation, never from later editor refreshes. */
export class DesignerMainAppSources {
  constructor({files, workspaceId, revision}) {
    Object.assign(this, {files, workspaceId, revision});
    this.pending = null;
    this.active = null;
  }

  capture({compilationFiles, eligible = true}) {
    this.pending = null;
    if (!eligible) return null;
    const sourceProjection = captureAppSources(this.files());
    const compilation = captureAppSources(compilationFiles);
    const workspace = new Map(sourceProjection.map(file => [file.uri, file.text]));
    if (!compilation.length || compilation.some(file => workspace.get(file.uri) !== file.text)) {
      throw new DesignerAppHostError('Compilation inputs do not belong to this workspace snapshot', 'SFDA0012');
    }
    return Object.freeze({
      workspaceId: appWorkspaceIdentity(this.workspaceId()), revision: this.revision(), sourceProjection, compilation,
      compilationUris: Object.freeze(compilation.map(file => file.uri))
    });
  }

  arm(ticket, {compilationFiles, previousSessionId}) {
    this.pending = null;
    if (!ticket) return;
    if (!this.current(ticket) || !sameAppSources(ticket.compilation, captureAppSources(compilationFiles))) {
      throw new DesignerAppHostError('The workspace changed after compilation; launch the current sources again', 'SFDA0012');
    }
    this.pending = {ticket, previousSessionId};
  }

  current(ticket) {
    return ticket.workspaceId === this.workspaceId() && ticket.revision === this.revision() &&
      sameAppSources(ticket.sourceProjection, captureAppSources(this.files()));
  }

  loaded(sessionId) {
    const pending = this.pending;
    if (!pending || !Number.isSafeInteger(sessionId) || sessionId < 0 ||
      Number.isSafeInteger(pending.previousSessionId) && sessionId <= pending.previousSessionId) return false;
    this.pending = null;
    if (!this.current(pending.ticket)) return false;
    this.active = Object.freeze({sessionId, ...pending.ticket});
    return true;
  }

  state(value) {
    const active = this.active;
    if (!value || active?.sessionId !== value.sessionId || active.workspaceId !== this.workspaceId()) return value;
    return {...value, workspaceId: active.workspaceId, sourceProjection: active.sourceProjection,
      compilationUris: active.compilationUris};
  }

  cancelPending() { this.pending = null; }

  clear() { this.cancelPending(); this.active = null; }
}
