/** Background notifications never change the user's selected document or tool. */
export class RevealPolicy {
  constructor({ reveal = () => {}, activeProject = () => null, activeSession = () => null } = {}) {
    this.reveal = reveal;
    this.activeProject = activeProject;
    this.activeSession = activeSession;
    this.intent = 0;
  }

  userIntent() { return ++this.intent; }

  request(panelId, { userInitiated = false, projectId, sessionId, intent = this.intent } = {}) {
    if (!userInitiated || intent !== this.intent) return false;
    if (projectId !== undefined && this.activeProject() !== projectId) return false;
    if (sessionId !== undefined && this.activeSession() !== sessionId) return false;
    this.reveal(panelId);
    return true;
  }
}
