import { TemplateError } from '../common.js';
import { evaluateTemplateExpression } from './expression.js';
import { applyValueForm, templateRegex } from './value-forms.js';

function jsonSource(source) {
  let output = '';
  let quote = false;
  let escape = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      output += char;
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') quote = false;
    } else if (char === '"') { quote = true; output += char; }
    else if (char === '/' && source[index + 1] === '/') {
      while (index + 1 < source.length && source[index + 1] !== '\n') index++;
    } else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new TemplateError('SFTPL012', 'Unterminated template JSON comment');
      output += ' ';
      index = end + 1;
    } else output += char;
  }
  return output.replace(/^\uFEFF/, '');
}

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function checkUtf8Size(source, maxBytes) {
  let bytes = 0;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff &&
        source.charCodeAt(index + 1) >= 0xdc00 && source.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > maxBytes) throw new TemplateError('SFTPL012', 'Template config size limit exceeded');
  }
}

/** Parse data-only template JSON within maxBytes UTF-8 bytes, including any input BOM; errors use SFTPL012. */
export function parseTemplateConfig(input, { maxBytes = 4 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TemplateError('SFTPL012', 'Invalid template config byte limit');
  if (input instanceof Uint8Array && input.byteLength > maxBytes) {
    throw new TemplateError('SFTPL012', 'Template config size limit exceeded');
  }
  if (typeof input === 'string') checkUtf8Size(input, maxBytes);
  let value;
  let serialized;
  try {
    if (input instanceof Uint8Array) input = new TextDecoder('utf-8', { fatal: true }).decode(input);
    value = typeof input === 'string' ? JSON.parse(jsonSource(input)) : structuredClone(input);
    if (isObject(value)) serialized = JSON.stringify(value);
  }
  catch (cause) { throw new TemplateError('SFTPL012', 'Invalid template.json: ' + cause.message, { cause }); }
  if (!isObject(value)) throw new TemplateError('SFTPL012', 'Template config size or shape is invalid');
  checkUtf8Size(serialized, maxBytes);
  for (const key of ['customOperations', 'specialCustomOperations']) {
    if (value[key] !== undefined) throw new TemplateError('SFTPL012', 'Unsupported template operation configuration: ' + key);
  }
  if (typeof value.identity !== 'string' || !value.identity || value.identity.length > 200)
    throw new TemplateError('SFTPL012', 'Template identity is required');
  const shortNames = typeof value.shortName === 'string' ? [value.shortName] : value.shortName;
  if (!Array.isArray(shortNames) || !shortNames.length || shortNames.length > 32 ||
      shortNames.some(name => typeof name !== 'string' || !name || name.length > 100)) {
    throw new TemplateError('SFTPL012', 'Template shortName must be a name or a bounded list of names');
  }
  const symbols = value.symbols ?? {};
  if (!isObject(symbols) || Object.keys(symbols).length > 1024) throw new TemplateError('SFTPL012', 'Template symbol limit exceeded');
  const parameters = [];
  for (const [name, symbol] of Object.entries(symbols)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,199}$/.test(name) || !isObject(symbol)) throw new TemplateError('SFTPL012', 'Invalid template symbol: ' + name);
    if (!['parameter', 'computed', 'generated', 'derived', 'bind'].includes(symbol.type))
      throw new TemplateError('SFTPL012', 'Unsupported symbol type: ' + symbol.type);
    if (symbol.type === 'parameter') {
      symbol.dataType ??= symbol.datatype ?? 'string';
      if (symbol.choices !== undefined && (!Array.isArray(symbol.choices) || symbol.choices.length > 256 ||
        symbol.choices.some(choice => !isObject(choice) || typeof choice.choice !== 'string')))
        throw new TemplateError('SFTPL012', 'Invalid symbol choices: ' + name);
      parameters.push({ name, dataType: symbol.dataType ?? 'string', defaultValue: symbol.defaultValue,
        required: !!symbol.isRequired, choices: (symbol.choices ?? []).map(choice => ({ ...choice })) });
    }
  }
  return Object.freeze({ ...value, shortNames: Object.freeze([...shortNames]), symbols, parameters: Object.freeze(parameters) });
}

function parameterValue(name, symbol, input) {
  let value = input;
  if (value === undefined) value = symbol.defaultValue;
  if (value === undefined && symbol.isRequired) throw new TemplateError('SFTPL013', 'Required template parameter: ' + name);
  if (value === undefined) value = (symbol.dataType === 'bool' || symbol.dataType === 'boolean') ? false : '';
  const type = symbol.dataType ?? 'string';
  if (type === 'bool' || type === 'boolean') {
    if (typeof value === 'string' && /^(true|false)$/i.test(value)) value = value.toLowerCase() === 'true';
    if (typeof value !== 'boolean') throw new TemplateError('SFTPL013', 'Expected boolean parameter: ' + name);
  } else if (type === 'int' || type === 'integer' || type === 'float') {
    const number = Number(value);
    if (!String(value).trim() || !Number.isFinite(number) || type !== 'float' && !Number.isSafeInteger(number)) {
      throw new TemplateError('SFTPL013', 'Expected numeric parameter: ' + name);
    }
    value = number;
  } else if (type === 'choice') {
    const choices = symbol.choices ?? [];
    const values = symbol.allowMultipleValues ? (Array.isArray(value) ? value : String(value).split(/[|,]/)) : [String(value)];
    const selected = values.map(item => choices.find(choice => choice.choice.toLowerCase() === item.toLowerCase()));
    if (selected.some(item => !item)) throw new TemplateError('SFTPL013', 'Invalid choice for parameter ' + name);
    value = symbol.allowMultipleValues ? selected.map(item => item.choice).join('|') : selected[0].choice;
  } else if (type === 'string' || type === 'text') value = String(value);
  else throw new TemplateError('SFTPL013', 'Unsupported parameter data type: ' + type);
  if (String(value).length > 65536) throw new TemplateError('SFTPL013', 'Template parameter value is too long');
  return value;
}

function seeded(seed) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value;
}

function generatedValue(name, symbol, resolve, config, options) {
  const parameters = symbol.parameters ?? {};
  const generator = String(symbol.generator).toLowerCase();
  const source = () => resolve(parameters.source ?? parameters.sourceVariableName);
  if (generator === 'constant') return parameters.value;
  if (generator === 'evaluate') return evaluateTemplateExpression(parameters.action, resolve);
  if (generator === 'regexmatch') return templateRegex(parameters.pattern, '').test(String(source()));
  if (generator === 'casing') return parameters.toLower ? String(source()).toLowerCase() : String(source()).toUpperCase();
  if (generator === 'regex') {
    let value = String(source());
    for (const step of parameters.steps ?? []) value = value.replace(templateRegex(step.regex), step.replacement ?? '');
    return value;
  }
  if (generator === 'join') return (parameters.symbols ?? [])
    .map(item => item.type === 'const' ? item.value : resolve(item.value)).join(parameters.separator ?? '');
  if (generator === 'switch') {
    for (const item of parameters.cases ?? []) if (!item.condition || evaluateTemplateExpression(item.condition, resolve)) return item.value;
    return '';
  }
  if (generator === 'now') {
    if (options.now === undefined) throw new TemplateError('SFTPL014', 'The now generator requires an explicit timestamp');
    const date = new Date(options.now);
    if (!Number.isFinite(date.valueOf())) throw new TemplateError('SFTPL014', 'Invalid generated timestamp');
    const fields = { yyyy: String(date.getUTCFullYear()), MM: String(date.getUTCMonth() + 1).padStart(2, '0'),
      dd: String(date.getUTCDate()).padStart(2, '0'), HH: String(date.getUTCHours()).padStart(2, '0'),
      mm: String(date.getUTCMinutes()).padStart(2, '0'), ss: String(date.getUTCSeconds()).padStart(2, '0') };
    return (parameters.format ?? 'yyyy-MM-dd').replace(/yyyy|MM|dd|HH|mm|ss/g, token => fields[token]);
  }
  const seed = String(options.seed ?? resolve('name')) + ':' + config.identity + ':' + name;
  if (generator === 'guid') {
    let hex = '';
    for (let index = 0; index < 4; index++) hex += seeded(seed + ':' + index).toString(16).padStart(8, '0');
    return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), 'a' + hex.slice(17, 20), hex.slice(20)].join('-');
  }
  if (generator === 'random' || generator === 'port') {
    const low = Number(parameters.low ?? (generator === 'port' ? 1024 : 0));
    const high = Number(parameters.high ?? (generator === 'port' ? 65535 : 2147483647));
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low > high || high - low > 0xffffffff)
      throw new TemplateError('SFTPL014', 'Invalid generator range');
    return low + seeded(seed) % (high - low + 1);
  }
  throw new TemplateError('SFTPL014', 'Unsupported template generator: ' + symbol.generator);
}

/** Resolve parameters/computed/generated/derived symbols with cycle detection and explicit host bindings. */
export function evaluateTemplateSymbols(config, parameters = {}, options = {}) {
  if (!isObject(parameters)) throw new TemplateError('SFTPL013', 'Template parameters must be an object');
  const values = Object.create(null);
  const resolving = new Set();
  const bindings = {
    name: options.name ?? config.defaultName ?? config.sourceName ?? 'Application',
    HostIdentifier: 'dotnetcli', 'host:HostIdentifier': 'dotnetcli', ...(options.bindings ?? {})
  };
  function resolve(name) {
    options.signal?.throwIfAborted();
    if (Object.hasOwn(values, name)) return values[name];
    if (resolving.has(name) || resolving.size > 128) throw new TemplateError('SFTPL015', 'Template symbol dependency cycle: ' + name);
    const symbol = Object.hasOwn(config.symbols, name) ? config.symbols[name] : null;
    if (!symbol) {
      if (Object.hasOwn(bindings, name)) return bindings[name];
      throw new TemplateError('SFTPL013', 'Unknown template symbol: ' + name);
    }
    resolving.add(name);
    let value;
    if (symbol.type === 'parameter') value = parameterValue(name, symbol, parameters[name] ?? (name === 'name' ? bindings.name : undefined));
    if (symbol.type === 'computed') value = evaluateTemplateExpression(symbol.value, resolve);
    if (symbol.type === 'generated') value = generatedValue(name, symbol, resolve, config, options);
    if (symbol.type === 'derived') value = applyValueForm(resolve(symbol.valueSource), symbol.valueTransform, config.forms);
    if (symbol.type === 'bind') {
      if (!Object.hasOwn(bindings, symbol.binding)) throw new TemplateError('SFTPL014', 'Missing host binding: ' + symbol.binding);
      value = bindings[symbol.binding];
    }
    values[name] = value;
    resolving.delete(name);
    return value;
  }
  for (const name of Object.keys(parameters)) {
    if (!Object.hasOwn(config.symbols, name)) throw new TemplateError('SFTPL013', 'Unknown template parameter: ' + name);
  }
  for (const [name, value] of Object.entries(bindings)) if (!Object.hasOwn(config.symbols, name)) values[name] = value;
  for (const name of Object.keys(config.symbols)) resolve(name);
  return values;
}
