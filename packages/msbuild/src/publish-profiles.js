import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseXml } from '@sharpforge/project-system';
import { validateOutputProperties } from './argument-policy.js';

const visibleProperties = new Set(['PublishDir', 'RuntimeIdentifier', 'SelfContained', 'PublishSingleFile', 'PublishTrimmed',
  'PublishAot', 'TargetFramework', 'Configuration', 'PublishProtocol', 'WebPublishMethod']);

/** Inspect profiles as XML data. Imports/conditions/functions stay explicit until trusted native evaluation. */
export function inspectPublishProfile(text, { path = null } = {}) {
  const root = parseXml(text), properties = Object.create(null), diagnostics = [];
  if (root.name !== 'Project') throw new Error('Publish profile root must be Project');
  for (const group of root.children) {
    if (group.name !== 'PropertyGroup') {
      diagnostics.push({ code: 'SFMSB_PROFILE_EVALUATION', severity: 'info', message: 'Profile includes native evaluation: ' + group.name });
      continue;
    }
    for (const property of group.children) {
      if (!visibleProperties.has(property.name)) continue;
      const evaluated = !group.attributes.Condition && !property.attributes.Condition && !/\$\(|@\(|%\(/.test(property.text);
      properties[property.name] = { value: property.text, evaluated, condition: property.attributes.Condition ?? group.attributes.Condition ?? null };
    }
  }
  return { path, properties, diagnostics, inspectionOnly: true };
}

export async function discoverPublishProfiles(workspace, project) {
  const projectPath = await workspace.path(project), directory = resolve(dirname(projectPath), 'Properties', 'PublishProfiles');
  const relative = workspace.relative(directory);
  if (!relative) throw new Error('Publish profiles directory escapes the workspace');
  let files;
  try { await workspace.path(relative); files = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (files.length > 1024) throw new Error('Publish profile count limit exceeded');
  const profiles = [];
  for (const file of files.filter(item => item.isFile() && /\.pubxml$/i.test(item.name))) {
    const path = workspace.relative(resolve(directory, file.name));
    const { text } = await workspace.read(path);
    profiles.push({ name: file.name.slice(0, -7), ...inspectPublishProfile(text, { path }) });
  }
  return profiles.sort((left, right) => left.name.localeCompare(right.name));
}

export function createPublishProfileRequest(request, profile) {
  if (!profile || typeof profile.path !== 'string' || !/\.pubxml$/i.test(profile.path)) throw new Error('Select an existing publish profile');
  const output = profile.properties.PublishDir;
  if (output?.evaluated) validateOutputProperties({ PublishDir: output.value });
  return { ...request, action: 'publish', properties: { ...request.properties, PublishProfile: profile.name ?? profile.path } };
}
