import { projectDecoration } from './build-decorations.js';

/** Bind the actual Explorer tree to service state. Runtime statistics never rebuild source records or unchanged rows. */
export function connectExplorerProjectDecorations({ services, explorer }) {
  if (!explorer?.model?.subscribe || !explorer.control?.render) throw new TypeError('An Explorer tree and view are required');
  const model = explorer.model;
  const projects = new Map();
  let indexedNodes = null;
  let disposed = false;

  const index = () => {
    if (indexedNodes === model.nodes) return false;
    indexedNodes = model.nodes;
    projects.clear();
    for (const node of model.nodes.values()) if (node.kind === 'project') {
      const id = node.project || node.path || '$workspace';
      const values = projects.get(id) ?? [];
      values.push(node);
      projects.set(id, values);
    }
    return true;
  };

  const update = projectId => {
    if (disposed) return;
    const rebuilt = index();
    let changed = false;
    for (const [id, nodes] of projects) {
      if (!rebuilt && projectId && id !== projectId) continue;
      const decoration = projectDecoration(id, services);
      const badge = decoration.badges.filter(value => value !== 'Startup project').join(' · ');
      for (const node of nodes) {
        const accessibleName = [node.label, ...decoration.badges].join(', ');
        if (node.startup === decoration.startup && node.badge === badge && node.accessibleName === accessibleName) continue;
        Object.assign(node, { startup: decoration.startup, badge, accessibleName });
        changed = true;
      }
    }
    if (changed) explorer.control.render();
  };

  const disconnect = [
    model.subscribe(() => { if (indexedNodes !== model.nodes) update(); }),
    services.sessions.subscribe(event => update(event.projectId)),
    services.builds.subscribe(event => update(['selected', 'removed'].includes(event.type) ? undefined : event.projectId)),
    services.startup.subscribe(() => update()),
    services.documents.subscribe(event => {
      if (services.startup.mode === 'currentSelection' && ['activated', 'membership'].includes(event.type)) update();
    })
  ];
  update();
  return () => {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of disconnect) unsubscribe();
    projects.clear();
    indexedNodes = null;
  };
}
