import { portablePath } from '@sharpforge/archive';
import { editProjectMembership, parseXml } from '@sharpforge/project-system';
import { getTemplate } from './registry.js';
import { validateFilePlan } from './file-plan.js';
import { normalizeTemplateOptions } from './options.js';
import { joinPath, validateIdentifier, validateNamespace, wrapNamespace, TemplateError } from './common.js';
import { legacyCodeItems } from './item/legacy-code.js';
import { legacyWinuiItems } from './item/legacy-winui.js';
import { packageReferences } from './project/tests.js';

const legacyCode = { ...legacyCodeItems, ...legacyWinuiItems };
const legacyText = {
  json: '{}\n',
  editorconfig: 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\n\n[*.cs]\nindent_style = space\nindent_size = 4\n',
  'build-props': '<Project>\n  <PropertyGroup>\n    <DebugType>portable</DebugType>\n  </PropertyGroup>\n</Project>\n',
  'build-targets': '<Project>\n  <!-- Add native MSBuild targets explicitly. Loading does not execute tasks. -->\n</Project>\n'
};

function appendPackages(text, packages) {
  if (!packages?.length) return text;
  const root = parseXml(text);
  const names = new Set();
  const visit = node => {
    if (node.name === 'PackageReference' && node.attributes.Include) names.add(node.attributes.Include.toLowerCase());
    node.children.forEach(visit);
  };
  visit(root);
  const missing = packages.filter(([name]) => !names.has(name.toLowerCase()));
  if (!missing.length) return text;
  const close = text.lastIndexOf('</Project>');
  if (close < 0) throw new TemplateError('SFTPL003', 'A complete Project root is required for package references');
  return text.slice(0, close) + packageReferences(missing) + text.slice(close);
}

function legacyItem(template, options, input) {
  const { name, identifier, namespace, folder } = options;
  const records = [];
  if (template.language === 'C#') {
    const source = legacyCode[template.id](identifier);
    const format = input.namespaceStyle || input.nullable !== undefined ? {
      namespaceStyle: options.namespaceStyle,
      ...(input.nullable !== undefined ? { nullable: options.nullable } : {})
    } : {};
    records.push({ path: joinPath(folder, name), text: wrapNamespace(namespace, source.body, source.usings, format) });
    if (source.second) records.push({ path: joinPath(folder, identifier + '.Methods.cs'),
      text: wrapNamespace(namespace, source.second, source.usings, format) });
  } else records.push({ path: joinPath(folder, name), text: legacyText[template.id] ?? '' });
  return { records, warnings: template.winui ? ['Code-first composition using .View; native WinUI inheritance and XAML templates are not implied.'] : [] };
}

/** Generate a complete item and its project membership edits; no filesystem mutation occurs here. */
export function createItemPlan(templateId, input = {}) {
  const template = getTemplate(templateId, input.catalog);
  if (template.kind !== 'item') throw new TemplateError('SFTPL004', 'Unknown item template');
  const options = { namespace: 'Application', folder: '', projectPath: null, projectText: null, existing: [], ...normalizeTemplateOptions(input) };
  let name = input.name ?? template.fileName;
  if (options.folder) portablePath(options.folder);
  portablePath(name);
  if (name.includes('/')) throw new TemplateError('SFTPL001', 'Use Location for folders, not the item name');
  if (template.language === 'C#' && !name.endsWith('.cs')) name += '.cs';
  if (template.fileName.endsWith('.xaml') && !name.endsWith('.xaml')) name += '.xaml';
  const needsIdentifier = template.language === 'C#' || template.language === 'XAML';
  const identifier = needsIdentifier ? validateIdentifier(name.replace(/\.(?:xaml|cs)$/i, ''), 'Class name') : '';
  if (needsIdentifier) validateNamespace(options.namespace);
  Object.assign(options, { name, identifier });
  input.signal?.throwIfAborted();
  const generated = template.generate ? template.generate(template, options) : legacyItem(template, options, input);
  const plan = {
    template: templateId, records: generated.records, folders: generated.folders ?? [], openFile: generated.openFile ?? generated.records[0]?.path ?? null,
    modifications: generated.modifications ?? [], warnings: generated.warnings ?? []
  };
  for (const key of ['postActions', 'primaryOutputs', 'provenance', 'values']) {
    if (generated[key] !== undefined) plan[key] = generated[key];
  }
  if (template.nativeOnly) plan.warnings = [...plan.warnings, ...(template.prerequisites ?? [])];
  if (options.projectPath && options.projectText !== null) {
    let text = options.projectText;
    const metadata = new Map((generated.membership ?? []).map(item => [item.path, item]));
    for (const record of plan.records) {
      const item = metadata.get(record.path) ?? {};
      text = editProjectMembership(text, { projectPath: options.projectPath, path: record.path,
        itemType: item.itemType ?? (/\.cs$/i.test(record.path) ? 'Compile' : /\.xaml$/i.test(record.path) ? 'Page' : 'None'), metadata: item.metadata ?? {} });
    }
    text = appendPackages(text, generated.packageReferences);
    plan.modifications.push({ path: options.projectPath, text, expectedText: options.projectText });
  }
  input.signal?.throwIfAborted();
  return validateFilePlan(plan, options.existing);
}
