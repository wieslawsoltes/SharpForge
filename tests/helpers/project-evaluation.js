import assert from 'node:assert/strict';
import { ProjectSystem, xmlEscape } from '../../packages/project-system/src/index.js';

export function evaluate(xml, files = {}, options = {}) {
  const records = Object.entries({ 'App/App.csproj': xml, 'App/Program.cs': 'class Program {}', ...files })
    .map(([path, value]) => typeof value === 'string' ? { path, text: value } : { ...value, path });
  const system = new ProjectSystem(records, options);
  const snapshot = system.load('App/App.csproj');
  return { system, ...snapshot, project: snapshot.projects.find(project => project.path === 'App/App.csproj') };
}

export function propertyProject(properties, contents = '', attributes = '') {
  return `<Project ${attributes}><PropertyGroup>${Object.entries(properties)
    .map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`).join('')}</PropertyGroup>${contents}</Project>`;
}

export function noErrors(result) {
  assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
}

export const identities = (result, type) => (result.project.evaluatedItems[type] ?? []).map(item => item.identity);
