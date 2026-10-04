import { GitError } from '@sharpforge/git';

/** Bind an existing editor through explicit host hooks; no editor or Studio global is captured. */
export function createCollaborationEditorBinding(host, session) {
  const subscriptions = [];
  let disposed = false;
  let applyingRemote = false;
  let initialized = false;
  let restoring = false;
  const earlyChanges = [];

  function report(error) {
    if (!disposed) host.announce?.(error.message);
  }

  function synchronizeText() {
    if (!host.getText || !host.applyRemoteTextChange) return true;
    applyingRemote = true;
    try {
      const current = host.getText();
      if (current === session.document.text) { initialized = true; return true; }
      host.applyRemoteTextChange({ start: 0, deleteCount: current.length, insertText: session.document.text });
      initialized = true;
      return true;
    } catch (error) {
      report(error);
      host.invalidate?.(error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function updateSelection(selection = host.getSelection?.()) {
    if (!selection || applyingRemote || disposed || !session.status.loaded) return;
    session.setPresence({ anchor: selection.anchor, focus: selection.focus });
  }

  if (host.onTextChange) subscriptions.push(host.onTextChange(change => {
    if (applyingRemote || disposed) return;
    if (!session.status.loaded) {
      if (earlyChanges.length >= session.maxPending) {
        const error = new GitError('Limit', 'Too many editor changes arrived before the collaboration journal loaded');
        report(error);
        host.invalidate?.(error);
      } else earlyChanges.push(change);
      return;
    }
    try {
      const saved = session.replace(change.start, change.deleteCount, change.insertText);
      updateSelection();
      void saved.catch(report);
    } catch (error) {
      synchronizeText();
      report(error);
    }
  }));
  if (host.onSelectionChange) subscriptions.push(host.onSelectionChange(updateSelection));
  subscriptions.push(session.subscribe(event => {
    if (disposed) return;
    if (event.type === 'document' && !event.change.local) {
      if (!initialized || event.change.type === 'snapshot') {
        if (!synchronizeText()) return;
      }
      else if (host.applyRemoteTextChange) {
        applyingRemote = true;
        try {
          for (const change of event.change.changes) host.applyRemoteTextChange(change);
        } catch (error) {
          report(error);
          host.invalidate?.(error);
          return;
        } finally {
          applyingRemote = false;
        }
      }
      const selection = session.presence.local.selection;
      if (selection && host.setSelection) {
        const anchor = session.document.resolveAnchor(selection.anchor);
        const focus = session.document.resolveAnchor(selection.focus);
        if (anchor !== null && focus !== null) host.setSelection({ anchor, focus });
      }
    } else if (event.type === 'presence') host.setRemoteCursors?.(event.peers);
    else if (event.type === 'state' && event.status?.loaded && !initialized && !restoring) {
      if (earlyChanges.length) {
        restoring = true;
        const changes = earlyChanges.splice(0);
        for (const change of changes) {
          try { void session.replace(change.start, change.deleteCount, change.insertText).catch(report); }
          catch (error) { report(error); }
        }
        restoring = false;
      }
      if (event.status.synchronized || session.document.stats.operations) synchronizeText();
    }
  }));
  if (session.status.loaded && (session.status.synchronized || session.document.stats.operations)) synchronizeText();

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      earlyChanges.length = 0;
      for (const unsubscribe of subscriptions) if (typeof unsubscribe === 'function') unsubscribe();
      host.setRemoteCursors?.([]);
    }
  });
}
