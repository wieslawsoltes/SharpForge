import { StudioDocking as WorkbenchStudioDocking } from '../workbench/layout-workspace.js';
export { defaultDockLayout, toolDefinitions } from '../workbench/layout-workspace.js';

/** The workbench owns document views and disposal; Studio adds its Test Explorer placement. */
export class StudioDocking extends WorkbenchStudioDocking {
  activate(id) {
    if (id === 'tests' && this.layout.locate(id).kind === 'closed') {
      this.adapt();
      const group = this.layout.group('tools-bottom');
      if (group) this.layout.open(id, group.id, { activate: false });
    }
    return super.activate(id);
  }

  reset(preset = 'coding') {
    const result = super.reset(preset);
    if (preset === 'build' && this.layout.panels.has('tests')) {
      const group = this.layout.group('tools-bottom');
      if (group) this.layout.open('tests', group.id, { activate: false });
    }
    return result;
  }
}
