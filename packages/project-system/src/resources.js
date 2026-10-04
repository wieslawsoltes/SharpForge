import { parseXml } from './xml.js';
import { baseName, directoryName } from './paths.js';
import { EvaluationError, getCaseInsensitive, toBoolean } from './evaluation/errors.js';
import { writeResources, readResources } from './resource-binary.js';
export { writeResources, readResources } from './resource-binary.js';

const numericTypes = new Set(['byte', 'sbyte', 'int16', 'uint16', 'int32', 'uint32', 'single', 'double']);

function fileReference(value, path, resolvePath) {
  const [file, fileType = 'System.Byte[]', encoding = 'utf-8'] = value.split(';');
  return { file, fileType, encoding, target: resolvePath(file, directoryName(path)) };
}

function typedValue(value, type, path, options) {
  const name = type.split(',')[0].trim().replace(/^System\./, '').toLowerCase();
  if (!name || name === 'string') return { type: 'string', value };
  if (name === 'boolean') return { type: 'boolean', value: toBoolean(value) };
  if (name === 'char' && value.length === 1) return { type: 'char', value };
  if (numericTypes.has(name)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new EvaluationError(`Invalid numeric resource '${value}'.`, 'SFP1501');
    const bounds = { byte: [0, 255], sbyte: [-128, 127], int16: [-32768, 32767], uint16: [0, 65535],
      int32: [-2147483648, 2147483647], uint32: [0, 4294967295] };
    if (bounds[name] && (!Number.isInteger(numeric) || numeric < bounds[name][0] || numeric > bounds[name][1])) {
      throw new EvaluationError(`Resource value overflows ${name}.`, 'SFP1501');
    }
    return { type: name, value: numeric };
  }
  if (name === 'int64' || name === 'uint64') {
    const numeric = BigInt(value);
    const minimum = name === 'int64' ? -(1n << 63n) : 0n;
    const maximum = name === 'int64' ? (1n << 63n) - 1n : (1n << 64n) - 1n;
    if (numeric < minimum || numeric > maximum) throw new EvaluationError('64-bit resource overflow.', 'SFP1501');
    return { type: name, value: numeric };
  }
  if (name === 'resources.resxfileref') {
    if (!options.readFile || !options.resolvePath) throw new EvaluationError('ResXFileRef requires explicit virtual file access.', 'SFP1501');
    const { file, fileType, encoding, target } = fileReference(value, path, options.resolvePath);
    const record = options.readFile(target);
    if (!record) throw new EvaluationError(`Resource file reference '${file}' is missing.`, 'SFP1501');
    if (record.lazy || (typeof record.text !== 'string' && !(record.bytes instanceof Uint8Array))) {
      throw new EvaluationError(`Resource file reference '${file}' must be hydrated before evaluation.`, 'SFP1501', {requiredFiles: [target]});
    }
    const bytes = record.bytes ?? new TextEncoder().encode(record.text);
    if (fileType.split(',')[0] === 'System.String') {
      return { type: 'string', value: typeof record.text === 'string' ? record.text : new TextDecoder(encoding, { fatal: true }).decode(bytes) };
    }
    if (fileType.split(',')[0] === 'System.Byte[]') return { type: 'bytes', value: bytes };
  }
  throw new EvaluationError(`Resource type '${type}' requires the native resource toolchain.`, 'SFP1501');
}

/** Parse string/primitive/file-reference resx data; serialized objects and DTDs are rejected. */
export function parseResx(text, { path = 'Resources.resx', ...options } = {}) {
  const root = parseXml(text, { maxLength: options.maxLength ?? 2_000_000 });
  if (root.name !== 'root') throw new EvaluationError('Expected a resx <root> element.', 'SFP1501');
  const entries = [];
  const names = new Set();
  for (const node of root.children) {
    if (node.name !== 'data') continue;
    const name = node.attributes.name;
    if (!name || names.has(name)) throw new EvaluationError(`Missing or duplicate resource name '${name ?? ''}'.`, 'SFP1501', { start: node.start });
    if (node.attributes.mimetype) throw new EvaluationError('Serialized resx objects require native resource conversion.', 'SFP1501', { start: node.start });
    const value = node.children.find(child => child.name === 'value');
    if (!value) throw new EvaluationError(`Resource '${name}' has no value.`, 'SFP1501', { start: node.start });
    names.add(name);
    entries.push({ name, ...typedValue(value.text, node.attributes.type ?? '', path, options) });
  }
  return entries;
}

function cultureFromName(name) {
  const match = /\.([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/i.exec(name);
  return match?.[1] ?? '';
}

function dependentType(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
  const namespace = /\bnamespace\s+([A-Za-z_][\w.]*)/.exec(stripped)?.[1];
  const type = /\b(?:class|struct|enum|interface|record(?:\s+class|\s+struct)?)\s+([A-Za-z_]\w*)/.exec(stripped)?.[1];
  return type ? [namespace, type].filter(Boolean).join('.') : null;
}

function namingInputs(item, context) {
  const metadata = item.metadata ?? {};
  const logical = getCaseInsensitive(metadata, 'LogicalName');
  const explicit = getCaseInsensitive(metadata, 'ManifestResourceName');
  const identity = getCaseInsensitive(metadata, 'Link') ?? item.identity;
  const extension = /\.[^.\/]+$/.exec(identity)?.[0] ?? '';
  const stem = extension ? identity.slice(0, -extension.length) : identity;
  const culture = getCaseInsensitive(metadata, 'Culture') ?? (toBoolean(getCaseInsensitive(metadata, 'WithCulture'), true) ? cultureFromName(stem) : '');
  const withoutCulture = culture ? stem.slice(0, -(culture.length + 1)) : stem;
  const dependent = getCaseInsensitive(metadata, 'DependentUpon');
  const convention = toBoolean(context.properties.embeddedresourceusedependentuponconvention, true);
  const sourcePath = logical || explicit ? null : dependent ? context.resolvePath(dependent, directoryName(item.path))
    : convention ? context.resolvePath(withoutCulture + '.cs') : null;
  return { logical, explicit, extension, culture, withoutCulture, sourcePath };
}

/** Compute resource identity and culture; explicit LogicalName and ManifestResourceName take precedence. */
export function manifestResourceName(item, context) {
  const { logical, explicit, extension, culture, withoutCulture, sourcePath } = namingInputs(item, context);
  if (logical) return { manifestName: logical, culture };
  if (explicit) return { manifestName: explicit.endsWith('.resources') ? explicit : explicit + '.resources', culture };
  const sourceRecord = sourcePath && context.files.get(sourcePath);
  if (sourceRecord && typeof sourceRecord.text !== 'string') {
    throw new EvaluationError(`Dependent resource source '${sourcePath}' must be hydrated before evaluation.`,
      'SFP1501', {requiredFiles: [sourcePath]});
  }
  const source = sourceRecord?.text;
  const type = source ? dependentType(source) : null;
  const name = type ?? [context.properties.rootnamespace, withoutCulture.replaceAll('/', '.').replaceAll('\\', '.')].filter(Boolean).join('.');
  const suffix = extension.toLowerCase() === '.resx' ? '.resources' : extension;
  return { manifestName: name + (culture ? '.' + culture : '') + suffix, culture };
}

/** Discover required file contents without substituting empty text for unloaded resources or source files. */
export function resourceEvaluationInputs(context, { files = context.files } = {}) {
  const paths = new Set();
  const diagnostics = [];
  for (const item of getCaseInsensitive(context.items, 'EmbeddedResource') ?? []) {
    paths.add(item.path);
    try {
      const names = namingInputs(item, context);
      if (!names.logical && !names.explicit && names.sourcePath && files.has(names.sourcePath)) paths.add(names.sourcePath);
      const file = files.get(item.path);
      if (!/\.resx$/i.test(item.path) || typeof file?.text !== 'string') continue;
      const root = parseXml(file.text, { maxLength: 2_000_000 });
      for (const node of root.children) {
        if (node.name !== 'data' || !/^System\.Resources\.ResXFileRef(?:\s*,|\s*$)/.test(node.attributes.type ?? '')) continue;
        const value = node.children.find(child => child.name === 'value');
        if (value) paths.add(fileReference(value.text, item.path, (path, base) => context.resolvePath(path, base)).target);
      }
    } catch (error) {
      diagnostics.push({ path: item.path, project: context.path, contextId: context.contextId,
        code: 'SFP1501', severity: 'error', message: error.message, start: error.start ?? 0, length: error.length ?? 1 });
    }
  }
  return { paths: [...paths], diagnostics };
}

export function evaluateResources(context) {
  const output = [];
  for (const item of getCaseInsensitive(context.items, 'EmbeddedResource') ?? []) {
    try {
      const file = context.files.get(item.path);
      if (!file) throw new EvaluationError(`Embedded resource '${item.path}' is missing.`, 'SFP1501');
      if (file.lazy) throw new EvaluationError(`Embedded resource '${item.path}' must be hydrated before evaluation.`,
        'SFP1501', {requiredFiles: [item.path]});
      const names = manifestResourceName(item, context);
      const resx = /\.resx$/i.test(item.path);
      const entries = resx ? parseResx(file.text, { path: item.path, readFile: path => context.files.get(path),
        resolvePath: (path, base) => context.resolvePath(path, base) }) : null;
      const bytes = entries ? writeResources(entries) : file.bytes ?? new TextEncoder().encode(file.text);
      output.push({ path: item.path, ...names, bytes, entries, itemType: 'EmbeddedResource' });
    } catch (error) { context.diagnostic(error, null, error.code ?? 'SFP1501'); }
  }
  return output;
}
