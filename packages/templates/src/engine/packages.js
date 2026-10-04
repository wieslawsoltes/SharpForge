import { readZip, decodeWorkspaceFile } from '@sharpforge/archive';
import { parseXml } from '@sharpforge/project-system';
import { TemplateCatalog } from '../registry.js';
import { TemplateError, joinPath } from '../common.js';
import { parseTemplateConfig } from './template-config.js';
import { instantiateTemplate } from './instantiate.js';

function packageIdentity(entries) {
  const nuspec = entries.find(entry => !entry.directory && entry.path.endsWith('.nuspec'));
  if (!nuspec) return { id: 'template-package', version: 'unspecified' };
  const root = parseXml(new TextDecoder('utf-8', { fatal: true }).decode(nuspec.bytes));
  const metadata = root.children.find(child => child.name === 'metadata');
  return { id: metadata?.children.find(child => child.name === 'id')?.text ?? 'template-package',
    version: metadata?.children.find(child => child.name === 'version')?.text ?? 'unspecified' };
}

function generateInstalled(template, settings) {
  const options = settings.options ?? settings;
  const output = settings.folder ?? options.folder;
  const plan = instantiateTemplate(template.config, template.files, { ...options, output,
    name: settings.name ?? options.identifier ?? options.projectName, parameters: options.parameters ?? {} });
  if (template.kind === 'item') return plan;
  const projects = plan.records.filter(record => record.path.endsWith('.csproj'));
  if (projects.length !== 1) throw new TemplateError('SFTPL019',
    'Installed project templates must expose one project to the wizard; use instantiateTemplate for multi-project packages');
  return { ...plan, projectPath: projects[0].path, library: /<OutputType>Library<\/OutputType>/.test(projects[0].text ?? '') ||
    !/<OutputType>/.test(projects[0].text ?? ''), openFile: plan.openFile };
}

/** Inspect and validate every template before making any catalog changes; no code or post-action executes. */
export function installTemplatePackage(bytes, { catalog = new TemplateCatalog(), ...options } = {}) {
  options.signal?.throwIfAborted();
  const entries = readZip(bytes, options);
  const metadata = packageIdentity(entries);
  const configurations = entries.filter(entry => !entry.directory && /(?:^|\/)\.template\.config\/template\.json$/i.test(entry.path));
  if (!configurations.length) throw new TemplateError('SFTPL019', 'Package contains no .template.config/template.json');
  if (configurations.length > (options.maxTemplates ?? 256)) throw new TemplateError('SFTPL019', 'Template package catalog budget exceeded');
  const additions = [];
  const identities = new Set();
  for (const entry of configurations) {
    options.signal?.throwIfAborted();
    const config = parseTemplateConfig(entry.bytes);
    const prefix = entry.path.slice(0, -'.template.config/template.json'.length);
    if (catalog.get(config.identity) || identities.has(config.identity)) throw new TemplateError('SFTPL004', 'Template already installed: ' + config.identity);
    identities.add(config.identity);
    const files = entries.filter(file => !file.directory && file.path.startsWith(prefix)).map(file =>
      decodeWorkspaceFile(file.path.slice(prefix.length), file.bytes));
    const kind = config.tags?.type === 'item' ? 'item' : 'project';
    additions.push({
      id: config.identity, name: config.name ?? config.identity, description: config.description ?? '', category: 'Installed',
      kind, language: config.tags?.language ?? 'C#', platform: '.NET SDK', nativeOnly: true, targets: ['native-dotnet'],
      prerequisites: ['Native SDK and template-specific package restore'], qualification: { 'native-dotnet': 'pending' },
      tags: [...config.shortNames, ...(config.classifications ?? [])], fileName: kind === 'item' ? (config.defaultName ?? 'Item1.cs') : undefined,
      package: metadata, config, files, generate: generateInstalled
    });
  }
  // All records and configs are already checked; catalog insertion cannot leave a partially validated package.
  for (const template of additions) catalog.add(template);
  return { catalog, package: metadata, templates: additions, postActions: additions.flatMap(template =>
    (template.config.postActions ?? []).map(action => ({ template: template.id, actionId: action.actionId, manual: true,
      description: action.description ?? 'Run this post-action manually after inspecting the generated files.' }))) };
}

export function uninstallTemplatePackage(catalog, id, version) {
  const removed = [];
  for (const template of catalog.list({ kind: 'all' })) {
    if (template.package?.id === id && (version === undefined || template.package.version === version)) {
      catalog.remove(template.id);
      removed.push(template.id);
    }
  }
  return removed;
}
