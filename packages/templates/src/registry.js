import { TemplateError } from './common.js';
import { legacyProjectTemplates, legacyItemTemplates, builtInTemplates } from './catalog.generated.js';

// The released example inventories retain their identifiers, order and object shape.
export const projectTemplates = legacyProjectTemplates;
export const itemTemplates = legacyItemTemplates;
export { builtInTemplates };

/** Explicit catalog instance: installed packages never mutate process-global template state. */
export class TemplateCatalog {
  constructor(templates = builtInTemplates) {
    this.templates = new Map();
    for (const template of templates) this.add(template);
  }
  add(template) {
    if (!template || typeof template.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(template.id)) {
      throw new TemplateError('SFTPL004', 'Invalid template identity');
    }
    if (this.templates.has(template.id)) throw new TemplateError('SFTPL004', 'Template already installed: ' + template.id);
    if (!['project', 'item', 'solution'].includes(template.kind)) throw new TemplateError('SFTPL004', 'Invalid template kind');
    this.templates.set(template.id, Object.freeze({ ...template }));
    return this;
  }
  get(id) { return this.templates.get(id); }
  remove(id) { return this.templates.delete(id); }
  list({ kind = 'project' } = {}) {
    return [...this.templates.values()].filter(template => kind === 'all' || (kind === 'project' && template.kind === 'solution') || template.kind === kind);
  }
  fork() { return new TemplateCatalog([...this.templates.values()]); }
}

const defaultCatalog = new TemplateCatalog();

export function getTemplate(id, catalog = defaultCatalog) {
  const template = catalog.get(id);
  if (!template) throw new TemplateError('SFTPL004', 'Unknown template: ' + id);
  return template;
}

export function templateAvailability(template, environment = {}) {
  if (template.windowsOnly && !['win32', 'windows'].includes(String(environment.platform).toLowerCase())) {
    return { available: false, code: 'SFTPL_TARGET', reason: 'Requires Windows and Windows App SDK; generation and export remain available.' };
  }
  if (template.nativeOnly && !environment.native) {
    return { available: false, code: 'SFTPL_TARGET', reason: 'Requires a native .NET toolchain and package restore; browser execution is unavailable.' };
  }
  return { available: true, code: null, reason: '' };
}

export function searchTemplates({ kind = 'project', query = '', category = '', language = '', platform = '', catalog = defaultCatalog, target = '' } = {}) {
  const words = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.list({ kind }).filter(template => (!category || template.category === category) &&
    (!language || template.language === language) && (!platform || template.platform === platform) &&
    (!target || template.targets?.includes(target)) && words.every(word =>
      [template.name, template.description, template.category, template.id, ...(template.tags ?? [])].join(' ').toLowerCase().includes(word)));
}
