import {defaultGuideSettings, validateGuideSettings} from './guides-document.js';

/** Recovery contains only bounded guide scalars and positions, never arbitrary designer metadata or executable objects. */
export function recoverSessionGuides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const guides = value.guides ?? [];
  if (!Array.isArray(guides) || guides.length > 256) return null;
  const candidate = {};
  for (const key of ['version', 'gridSize', 'gridVisible', 'snapGrid', 'snapGuides', 'snapSiblings', 'tolerance']) {
    const scalar = Object.hasOwn(value, key) ? value[key] : defaultGuideSettings[key];
    if (typeof scalar !== typeof defaultGuideSettings[key]) return null;
    candidate[key] = scalar;
  }
  candidate.guides = [];
  for (const guide of guides) {
    if (!guide || typeof guide !== 'object' || typeof guide.id !== 'string' || guide.id.length > 80 ||
        typeof guide.axis !== 'string' || guide.axis.length !== 1 || typeof guide.position !== 'number') return null;
    candidate.guides.push({id: guide.id, axis: guide.axis, position: guide.position});
  }
  try { return validateGuideSettings(candidate); }
  catch { return null; }
}

/** Install validated editor metadata without changing source, nodes, indexes, revisions, or undo history. */
export function installSessionGuides(document, settings) {
  if (!settings) return false;
  const previous = recoverSessionGuides(document.value.designer?.guides);
  if (JSON.stringify(previous) === JSON.stringify(settings)) return false;
  document.value = {...document.value, designer: {...document.value.designer, guides: structuredClone(settings)}};
  return true;
}
