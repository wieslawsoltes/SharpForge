import {geometryInvariant} from './geometry-coordinates.js';

export const defaultGuideSettings = Object.freeze({version: 1, gridSize: 8, gridVisible: true,
  snapGrid: true, snapGuides: true, snapSiblings: true, tolerance: 6, guides: Object.freeze([])});

/** Guide settings are document metadata; they never become runtime properties. */
export function validateGuideSettings(value = {}) {
  geometryInvariant(value && typeof value === 'object' && !Array.isArray(value),
    'SFD_GUIDE_SETTINGS', 'Guide settings must be an object.');
  const settings = structuredClone({...defaultGuideSettings, ...value});
  geometryInvariant(settings.version === 1, 'SFD_GUIDE_VERSION', 'Unsupported guide settings version.');
  geometryInvariant(Number.isFinite(settings.gridSize) && settings.gridSize >= .25 && settings.gridSize <= 1024,
    'SFD_GUIDE_GRID', 'Grid size must be between 0.25 and 1024 design pixels.');
  geometryInvariant(Number.isFinite(settings.tolerance) && settings.tolerance >= 0 && settings.tolerance <= 100,
    'SFD_GUIDE_TOLERANCE', 'Snap tolerance must be between 0 and 100 design pixels.');
  for (const key of ['gridVisible', 'snapGrid', 'snapGuides', 'snapSiblings']) {
    geometryInvariant(typeof settings[key] === 'boolean', 'SFD_GUIDE_BOOLEAN', `${key} must be a Boolean.`);
  }
  geometryInvariant(Array.isArray(settings.guides) && settings.guides.length <= 256,
    'SFD_GUIDE_LIMIT', 'A document supports at most 256 guides.');
  const ids = new Set();
  for (const guide of settings.guides) {
    geometryInvariant(typeof guide.id === 'string' && /^[\w.-]{1,80}$/.test(guide.id) && !ids.has(guide.id),
      'SFD_GUIDE_ID', 'Guide identifiers must be unique.');
    geometryInvariant(['x', 'y'].includes(guide.axis) && Number.isFinite(guide.position) && Math.abs(guide.position) <= 1000000,
      'SFD_GUIDE_POSITION', 'Guide position or axis is invalid.');
    ids.add(guide.id);
  }
  return settings;
}

export function guideSettings(document) {
  return validateGuideSettings(document.designer?.guides);
}

export function updateGuideSettings(document, patch) {
  return document.change('Edit guides and grid', candidate => {
    candidate.designer ??= {};
    candidate.designer.guides = validateGuideSettings({...guideSettings(candidate), ...patch});
  });
}

export function setUserGuide(document, {id = null, axis, position, remove = false}) {
  const settings = guideSettings(document.value);
  const existing = settings.guides.find(guide => guide.id === id);
  if (remove) settings.guides = settings.guides.filter(guide => guide.id !== id);
  else if (existing) Object.assign(existing, {axis, position});
  else {
    let serial = 1;
    while (settings.guides.some(guide => guide.id === `guide-${serial}`)) serial++;
    settings.guides.push({id: id ?? `guide-${serial}`, axis, position});
  }
  return updateGuideSettings(document, settings);
}
