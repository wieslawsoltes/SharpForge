import { migrateLayout } from '@sharpforge/docking';
import { StudioDocking as WorkbenchDocking, defaultDockLayout, toolDefinitions } from './workbench/layout-workspace.js';
import { migrateDesignerLayout } from './designer-layout-migration.js';
import { designerDockPreset } from './designer-layout-preset.js';

export { defaultDockLayout, toolDefinitions };

/** The workbench owns tabs, close flows and disposal; A18 adds document-based designer layouts. */
export class StudioDocking extends WorkbenchDocking {
  sync(files, tabs, active) {
    if (this.pendingRestore) {
      try {
        const snapshot = migrateLayout(this.pendingRestore);
        // Secondary views and dynamic tools are registered by the workbench during restore.
        this.pendingRestore = migrateDesignerLayout(snapshot, {activeUri: active});
      } catch (error) {
        this.onError(error);
      }
    }
    return super.sync(files, tabs, active);
  }

  reset(preset = 'coding') {
    if (preset !== 'designer') return super.reset(preset);
    this.layout.restore({
      ...this.layout.snapshot(),
      ...designerDockPreset(this.layout, toolDefinitions),
      floating: [],
      autoHide: {left: [], right: [], top: [], bottom: []},
      returnLocations: {}
    });
    this.mobile = false;
    this.adapt();
    return true;
  }
}
