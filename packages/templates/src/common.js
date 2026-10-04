import { portablePath } from '@sharpforge/archive';

export const joinPath = (...parts) => parts.filter(Boolean).join('/');
export const directoryName = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const fileName = path => path.split('/').at(-1);
const keywords = new Set(('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double ' +
  'else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new ' +
  'null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string ' +
  'struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await var dynamic ' +
  'record required file global').split(' '));

export class TemplateError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'TemplateError'; this.code = code; }
}

export function validateIdentifier(value, label = 'Name') {
  if (typeof value !== 'string' || value.length > 100 || !/^[_A-Za-z][_A-Za-z0-9]*$/.test(value) || keywords.has(value)) {
    throw new TemplateError('SFTPL001', label + ' must be a C# identifier (not a keyword), at most 100 characters');
  }
  return value;
}

export function validateProjectName(value) {
  if (typeof value !== 'string' || !value || value.length > 100 || !/^[_A-Za-z][_A-Za-z0-9.-]*$/.test(value)) {
    throw new TemplateError('SFTPL001', 'Project name must start with a letter or underscore and contain only letters, digits, dots, hyphens or underscores');
  }
  portablePath(value);
  return value;
}

export function validateNamespace(value) {
  if (typeof value !== 'string' || !value || value.length > 200) throw new TemplateError('SFTPL001', 'Enter a namespace');
  for (const part of value.split('.')) validateIdentifier(part, 'Namespace component');
  return value;
}

export function defaultNamespace(name) {
  return name.split(/[.-]/).filter(Boolean).map(part => {
    part = part.replace(/[^\w]/g, '_');
    return keywords.has(part) || /^\d/.test(part) ? '_' + part : part;
  }).join('.');
}

export function definition(id, name, description, category, extra = {}) {
  return Object.freeze({ id, name, description, category, language: 'C#', platform: 'SharpForge browser', ...extra });
}

export const winuiUsings = 'using Microsoft.UI.Xaml;\nusing Microsoft.UI.Xaml.Controls;\nusing Microsoft.UI.Xaml.Media;\nusing Microsoft.UI;\n';

export function wrapNamespace(namespace, body, usings = '', { namespaceStyle = 'block', nullable } = {}) {
  const mode = nullable === true || nullable === 'enable' ? 'enable' : nullable === 'warnings' ? 'enable warnings' :
    nullable === 'annotations' ? 'enable annotations' : 'disable';
  const prefix = (nullable === undefined ? '' : '#nullable ' + mode + '\n') + usings + (usings ? '\n' : '');
  if (namespaceStyle === 'file-scoped') return prefix + 'namespace ' + namespace + ';\n\n' + body + '\n';
  return prefix + 'namespace ' + namespace + '\n{\n' + body.split('\n').map(line => line ? '    ' + line : '').join('\n') + '\n}\n';
}

const componentNote = '// Code-first SharpForge component: use .View. User inheritance from WinUI classes\n' +
  '// and XAML/ControlTemplate/DataTemplate loading are not part of this profile.\n';

export function component(name, view, body, extra = '', usings = winuiUsings) {
  return {
    body: `${componentNote}public partial class ${name}\n{\n    public ${view} View { get; private set; }\n${extra}\n` +
      `    public ${name}()\n    {\n        View = new ${view}();\n${body}\n    }\n}`,
    usings
  };
}
