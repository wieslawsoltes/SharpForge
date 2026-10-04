/** Background notifications never change the user's selected document or tool. */
export class RevealPolicy {
  constructor({ reveal = () => {}, activeProject = () => null, activeSession = () => null } = {}) {
    this.reveal = reveal;
    this.activeProject = activeProject;
    this.activeSession = activeSession;
    this.intent = 0;
    this.revealing = 0;
  }

  userIntent() { return this.revealing ? this.intent : ++this.intent; }

  /** Captured requests remain valid only while their initiating selection and intent are current. */
  allows({ userInitiated = false, projectId, sessionId, intent = this.intent } = {}) {
    if (!userInitiated || intent !== this.intent) return false;
    if (projectId !== undefined && this.activeProject() !== projectId) return false;
    if (sessionId !== undefined && this.activeSession() !== sessionId) return false;
    return true;
  }

  /** Apply a synchronous host reveal atomically; its own focus/activation events are not new user navigation. */
  request(panelId, options = {}) {
    if (!this.allows(options)) return false;
    this.revealing++;
    try { (options.onReveal ?? this.reveal)(panelId); }
    finally { this.revealing--; }
    return true;
  }
}
