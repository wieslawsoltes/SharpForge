import { TemplateError } from './common.js';

/** The catalog uses one explicit option schema; target framework metadata never grants execution capability. */
export const templateOptions = Object.freeze({
  framework: { type: 'choice', values: ['net8.0', 'net9.0', 'net10.0', 'netstandard2.0'], default: 'net10.0' },
  langVersion: { type: 'choice', values: ['10', '11', '12', '13', '14', 'latest', 'preview'], default: null },
  nullable: { type: 'choice', values: ['enable', 'disable', 'warnings', 'annotations'], default: 'disable' },
  implicitUsings: { type: 'boolean', default: false },
  useProgramMain: { type: 'boolean', default: true },
  noRestore: { type: 'boolean', default: true },
  outputType: { type: 'choice', values: ['Exe', 'WinExe', 'Library'], default: null },
  namespaceStyle: { type: 'choice', values: ['block', 'file-scoped'], default: 'block' },
  checked: { type: 'boolean', default: false },
  solutionFormat: { type: 'choice', values: ['slnx', 'sln'], default: 'slnx' }
});

const aliases = Object.freeze({
  'use-program-main': 'useProgramMain', 'no-restore': 'noRestore', 'implicit-usings': 'implicitUsings',
  'lang-version': 'langVersion', 'output-type': 'outputType', 'namespace-style': 'namespaceStyle'
});

export function normalizeTemplateOptions(input = {}) {
  const options = { ...input };
  for (const [alias, name] of Object.entries(aliases)) {
    if (input[alias] === undefined) continue;
    if (input[name] !== undefined && input[name] !== input[alias]) throw new TemplateError('SFTPL002', 'Conflicting option: ' + name);
    options[name] = input[alias];
  }
  if (typeof options.nullable === 'boolean') options.nullable = options.nullable ? 'enable' : 'disable';
  for (const [name, schema] of Object.entries(templateOptions)) {
    if (options[name] === undefined) options[name] = schema.default;
    const value = options[name];
    if (value === null && schema.default === null) continue;
    if (schema.type === 'boolean' && typeof value !== 'boolean' || schema.type === 'choice' && !schema.values.includes(value)) {
      throw new TemplateError('SFTPL002', 'Invalid template option ' + name + ': ' + value);
    }
  }
  return options;
}
