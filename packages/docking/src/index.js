export * from './model.js';
export * from './host.js';
export { DOCK_LAYOUT_VERSION, DOCK_LAYOUT_LIMITS, migrateLayout, restorePersistedLayout, clampFloatingBounds } from './model/schema.js';
export { DOCK_SIDES, panelIds } from './model/nodes.js';
export { dockGuideTargets, hitDockGuide, DockGuideOverlay } from './host/guides.js';
