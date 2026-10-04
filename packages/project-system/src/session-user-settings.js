import { portablePath } from '@sharpforge/archive';

export const startupActions = Object.freeze(['none', 'start', 'startWithoutDebugging']);
export const startupModes = Object.freeze(['single', 'multiple', 'currentSelection']);
export const sessionUserSettingsLimits = Object.freeze({ projects: 1024, profiles: 64, characters: 4_194_304 });

function record(value, label) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (!value || (prototype !== Object.prototype && prototype !== null)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function text(value, label, maximum = 512) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) throw new TypeError(`Invalid ${label}`);
  return value;
}

function flag(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${label}`);
  return value;
}

function projectId(value, context) {
  text(value, 'session project ID', 2048);
  if (value !== '$workspace') portablePath(value);
  if (context.projectIds && !context.projectIds.has(value)) throw new Error(`Unknown session project '${value}'`);
  if (context.paths && value !== '$workspace' && (!context.paths.has(value) || !/\.csproj$/i.test(value))) {
    throw new Error(`Session project is missing from the workspace: ${value}`);
  }
  return value;
}

/** Sanitize versioned startup data; loaded-project semantics are checked by the workbench before commit. */
export function sanitizeStartupConfiguration(value, context = {}) {
  record(value, 'startup configuration');
  if (value.version !== 1 || !startupModes.includes(value.mode)) throw new TypeError('Unsupported startup configuration');
  if (!Array.isArray(value.entries) || value.entries.length > sessionUserSettingsLimits.projects) {
    throw new RangeError('Invalid startup project count');
  }
  const seen = new Set();
  const entries = value.entries.map((entry, index) => {
    record(entry, 'startup entry');
    const id = projectId(entry.projectId, context);
    if (seen.has(id)) throw new TypeError(`Duplicate startup project '${id}'`);
    seen.add(id);
    if (!startupActions.includes(entry.action)) throw new TypeError('Invalid startup action');
    const order = entry.order ?? index;
    if (!Number.isSafeInteger(order) || order < 0) throw new RangeError('Invalid startup order');
    return { projectId: id, action: entry.action, order, profile: text(entry.profile ?? 'default', 'startup profile') };
  });
  entries.sort((left, right) => left.order - right.order || left.projectId.localeCompare(right.projectId));
  return { version: 1, mode: value.mode, entries: entries.map((entry, order) => ({ ...entry, order })) };
}

function computePreferences(value) {
  if (value === undefined) return undefined;
  record(value, 'compute preferences');
  const result = {};
  if (value.backend !== undefined) result.backend = text(value.backend, 'compute backend', 64);
  if (value.workers !== undefined) {
    if (!Number.isInteger(value.workers) || value.workers < 1 || value.workers > 8) throw new RangeError('Invalid compute worker count');
    result.workers = value.workers;
  }
  if (value.maxElements !== undefined) {
    if (value.maxElements !== 1_000_000) throw new RangeError('Invalid compute element limit');
    result.maxElements = value.maxElements;
  }
  return result;
}

/** Retain display/compute preferences only; executable arguments, environment and grants have no import path. */
export function sanitizeLaunchProfileMetadata(value, context = {}) {
  record(value, 'launch profile metadata');
  if (value.version !== 1 || !Array.isArray(value.projects) || value.projects.length > sessionUserSettingsLimits.projects) {
    throw new TypeError('Unsupported launch profile metadata');
  }
  const seenProjects = new Set();
  const projects = value.projects.map(project => {
    record(project, 'launch profile project');
    const id = projectId(project.projectId, context);
    if (seenProjects.has(id)) throw new TypeError(`Duplicate launch profile project '${id}'`);
    seenProjects.add(id);
    if (!Array.isArray(project.profiles) || project.profiles.length > sessionUserSettingsLimits.profiles) {
      throw new RangeError('Invalid launch profile count');
    }
    const seenProfiles = new Set();
    const profiles = project.profiles.map(profile => {
      record(profile, 'launch profile');
      const profileId = text(profile.id, 'launch profile ID');
      if (seenProfiles.has(profileId)) throw new TypeError(`Duplicate launch profile '${profileId}'`);
      seenProfiles.add(profileId);
      const renderer = profile.renderer ?? 'auto';
      if (!['auto', 'webgpu', 'canvas2d', 'dom'].includes(renderer)) throw new TypeError('Invalid launch renderer');
      const result = {
        id: profileId, name: text(profile.name ?? profileId, 'launch profile name', 200),
        stopOnEntry: flag(profile.stopOnEntry, 'stop on entry'), renderer
      };
      const compute = computePreferences(profile.compute);
      if (compute) result.compute = compute;
      return result;
    });
    profiles.sort((left, right) => left.id.localeCompare(right.id));
    const selected = text(project.selected ?? 'default', 'selected launch profile');
    if (selected !== 'default' && !seenProfiles.has(selected)) throw new Error(`Unknown selected launch profile '${selected}'`);
    return { projectId: id, selected, profiles };
  });
  projects.sort((left, right) => left.projectId.localeCompare(right.projectId));
  return { version: 1, projects };
}

/** Immutable data-setting registrations. New settings extend this table instead of the archive parser. */
export const sessionUserSettingsContributions = Object.freeze([
  Object.freeze({ key: 'startupConfiguration', sanitize: sanitizeStartupConfiguration }),
  Object.freeze({ key: 'launchProfiles', sanitize: sanitizeLaunchProfileMetadata })
]);

/** Return only the registered session metadata, validating optional workspace paths or loaded project IDs. */
export function sanitizeSessionUserSettings(input, context = {}) {
  record(input, 'session user settings');
  const output = {};
  for (const contribution of sessionUserSettingsContributions) {
    if (input[contribution.key] !== undefined) output[contribution.key] = contribution.sanitize(input[contribution.key], context);
  }
  if (JSON.stringify(output).length > sessionUserSettingsLimits.characters) throw new RangeError('Session user settings exceed the limit');
  return output;
}
