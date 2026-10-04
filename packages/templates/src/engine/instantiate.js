import { portablePath, decodeWorkspaceFile, encodeWorkspaceFile } from '@sharpforge/archive';
import { TemplateError } from '../common.js';
import { validateFilePlan } from '../file-plan.js';
import { parseTemplateConfig, evaluateTemplateSymbols } from './template-config.js';
import { applyValueForm } from './value-forms.js';
import { conditionValue, compileSourceRules, processTemplateConditionals } from './file-rules.js';
import { processMsbuildConditions } from './msbuild-conditions.js';

function replacementFunction(config, values, paths) {
  const replacements = new Map();
  if (config.sourceName) {
    const name = !paths && config.tags?.language === 'C#' ? applyValueForm(values.name, 'safe_namespace') : String(values.name);
    replacements.set(config.sourceName, name);
  }
  for (const [name, symbol] of Object.entries(config.symbols)) {
    const token = paths ? symbol.fileRename : symbol.replaces;
    if (token) replacements.set(token, String(values[name] ?? ''));
    const forms = symbol.forms?.global ?? [];
    if (token) for (const form of forms) replacements.set(applyValueForm(token, form, config.forms), applyValueForm(values[name], form, config.forms));
  }
  if (!replacements.size) return value => value;
  const tokens = [...replacements.keys()].sort((left, right) => right.length - left.length || left.localeCompare(right));
  if (tokens.some(token => !token || token.length > 65536)) throw new TemplateError('SFTPL018', 'Invalid replacement token');
  const pattern = new RegExp(tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return text => text.replace(pattern, token => replacements.get(token));
}

export function templatePostActions(config, values) {
  const replace = replacementFunction(config, values, false);
  const transform = value => {
    if (typeof value === 'string') return replace(value);
    if (Array.isArray(value)) return value.map(transform);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]));
    return value;
  };
  return (config.postActions ?? []).filter(action => conditionValue(action.condition, values)).map(action => {
    const id = String(action.actionId ?? '').toLowerCase();
    const kind = id === '210d431b-a78b-4d2f-b762-4ed3e3ea9025' ? 'restore' :
      id === '84c0da21-51c8-4541-9940-6ca19af04ee6' ? 'open-file' : 'manual';
    return { actionId: action.actionId, kind, manual: true, description: replace(action.description ?? 'Manual template post-action'),
      args: transform(action.args ?? {}), instructions: (action.manualInstructions ?? []).map(item => replace(item.text ?? '')) };
  });
}

/** Apply data-only .NET template rules to files, producing a complete bounded plan and manual post-actions. */
export function instantiateTemplate(input, files, options = {}) {
  const config = input.parameters && input.shortNames ? input : parseTemplateConfig(input);
  if (!Array.isArray(files) || files.length > (options.maxFiles ?? 20000)) throw new TemplateError('SFTPL018', 'Template input file limit exceeded');
  const values = evaluateTemplateSymbols(config, options.parameters ?? {}, options);
  const replaceText = replacementFunction(config, values, false);
  const replacePath = replacementFunction(config, values, true);
  const records = [];
  const provenance = [];
  let total = 0;
  const sources = config.sources ?? [{ source: './', target: './' }];
  if (!Array.isArray(sources) || sources.length > 128) throw new TemplateError('SFTPL016', 'Template sources limit exceeded');
  for (const source of sources) {
    if (!conditionValue(source.condition, values)) continue;
    const rules = compileSourceRules(source, values);
    for (const file of files) {
      options.signal?.throwIfAborted();
      if (file.directory) continue;
      const path = portablePath(file.path);
      if (!path.startsWith(rules.source)) continue;
      const relative = path.slice(rules.source.length);
      if (!rules.include.some(pattern => pattern.test(relative)) || rules.exclude.some(pattern => pattern.test(relative))) continue;
      const renamed = rules.rename[relative] ?? relative;
      const target = portablePath([options.output, rules.target + replacePath(renamed)].filter(Boolean).join('/'));
      const original = typeof file.text === 'string' ? { ...file } : decodeWorkspaceFile(path, file.bytes);
      let record = { ...original, path: target };
      if (typeof record.text === 'string' && !rules.copyOnly.some(pattern => pattern.test(relative))) {
        record.text = processTemplateConditionals(record.text, values);
        if (/\.(?:[a-z]*proj|props|targets)$/i.test(relative)) record.text = processMsbuildConditions(record.text, values, config.forms);
        record.text = replaceText(record.text);
      }
      const bytes = encodeWorkspaceFile(record);
      total += bytes.length;
      if (bytes.length > (options.maxFileBytes ?? 64 * 1024 * 1024) || total > (options.maxTotalBytes ?? 128 * 1024 * 1024)) {
        throw new TemplateError('SFTPL018', 'Template output byte budget exceeded');
      }
      record = { ...record, bytes };
      records.push(record);
      provenance.push({ source: path, target });
      if (records.length > (options.maxFiles ?? 20000)) throw new TemplateError('SFTPL018', 'Template output file limit exceeded');
    }
  }
  records.sort((left, right) => left.path.localeCompare(right.path));
  const primaryOutputs = (config.primaryOutputs ?? []).filter(item => conditionValue(item.condition, values))
    .map(item => portablePath([options.output, replacePath(item.path)].filter(Boolean).join('/')));
  const plan = {
    template: config.identity, records, folders: [], modifications: [], warnings: [], values, provenance,
    primaryOutputs, openFile: primaryOutputs[0] ?? records[0]?.path ?? null, postActions: templatePostActions(config, values)
  };
  return validateFilePlan(plan, options.existing ?? []);
}
