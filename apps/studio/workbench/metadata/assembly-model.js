import {AssemblyInspector, decodeCoded} from '@sharpforge/cil';
import {metadataLimits, metadataError, boundedMetadataText} from './limits.js';

const access = ['private', 'private', 'private protected', 'internal', 'protected', 'protected internal', 'public'];
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

function genericParameters(metadata) {
  const names = new Map();
  for (const row of metadata.rows[42] ?? []) {
    const owner = decodeCoded('TypeOrMethodDef', row[2]);
    const parameters = names.get(owner) ?? [];
    parameters[row[0]] = boundedMetadataText(metadata.string(row[3]));
    names.set(owner, parameters);
  }
  return names;
}

function genericText(text, owner, method, names) {
  return boundedMetadataText(text).replace(/(!!?)(\d+)/gu, (match, scope, index) =>
    names.get(scope === '!!' ? method : owner)?.[Number(index)] ?? match);
}

function genericTypeName(name, parameters = []) {
  let index = 0;
  return name.split('+').map(part => part.replace(/`(\d+)$/u, (match, count) => {
    const values = parameters.slice(index, index + Number(count));
    index += Number(count);
    return values.length ? '<' + values.join(', ') + '>' : match;
  })).join('.');
}

function memberSignature(inspector, member, names) {
  const signature = inspector.signature(member.token);
  const format = value => genericText(value, member.ownerToken, member.token, names);
  const prefix = (access[member.flags & 7] ?? 'private') + (member.flags & 16 ? ' static ' : ' ');
  if (signature.kind === 'field') return {signature: prefix + format(signature.type) + ' ' + member.name + ';', type: format(signature.type)};
  const parameterNames = new Map(inspector.metadata.list(member.token, 'ParamList').map(token => {
    const row = inspector.metadata.row(token);
    return [row[1], boundedMetadataText(inspector.metadata.string(row[2]))];
  }));
  const parameters = signature.parameters.map((type, index) => ({type: format(type), name: parameterNames.get(index + 1) || 'arg' + index}));
  const generic = names.get(member.token);
  const methodName = member.name === '.ctor' ? member.owner.split(/[.+]/u).at(-1).replace(/`\d+$/u, '') :
    member.name === '.cctor' ? member.owner.split(/[.+]/u).at(-1) : member.name;
  const result = ['.ctor', '.cctor'].includes(member.name) ? '' : format(signature.returnType) + ' ';
  return {parameters, type: format(signature.returnType), signature: prefix + result + methodName +
    (generic?.length ? '<' + generic.join(', ') + '>' : '') + '(' + parameters.map(item => item.type + ' ' + item.name).join(', ') + ');'};
}

function propertyAccessors(inspector) {
  const result = new Map();
  for (const row of inspector.metadata.rows[24] ?? []) {
    const owner = decodeCoded('HasSemantics', row[2]), accessors = result.get(owner) ?? [];
    const method = inspector.methods.get(0x06000000 + row[1]);
    if (method) accessors.push({semantics: row[0], method});
    result.set(owner, accessors);
  }
  return result;
}

function propertySignature(inspector, type, property, names, accessors) {
  const signature = inspector.signature(property.token);
  const methods = accessors.get(property.token) ?? [];
  const visibility = Math.max(0, ...methods.map(item => item.method.flags & 7));
  const format = value => genericText(value, type.token, null, names);
  const parameters = signature.parameters.map((value, index) => ({type: format(value), name: 'arg' + index}));
  const suffix = parameters.length ? '[' + parameters.map(item => item.type + ' ' + item.name).join(', ') + ']' : '';
  const get = methods.some(item => item.semantics & 2), set = methods.some(item => item.semantics & 1);
  return {type: format(signature.returnType), parameters, signature: (access[visibility] ?? 'private') +
    (methods.some(item => item.method.flags & 16) ? ' static ' : ' ') + format(signature.returnType) + ' ' + property.name + suffix +
    ' { ' + (get ? 'get; ' : '') + (set ? 'set; ' : '') + '}'};
}

function typeModel(inspector, type, names, accessors, diagnostics) {
  const metadata = inspector.metadata, namespace = metadata.string(metadata.row(type.token)[2]) ||
    type.name.slice(0, Math.max(0, type.name.lastIndexOf('.')));
  const base = type.baseToken ? metadata.typeName(type.baseToken) : null;
  const kind = type.flags & 32 ? 'interface' : base === 'System.Enum' ? 'enum' :
    ['System.ValueType', 'System.ValueTuple'].includes(base) ? 'struct' : 'class';
  const displayName = genericTypeName(type.name, names.get(type.token));
  const result = {token: type.token, name: boundedMetadataText(type.name), namespace: boundedMetadataText(namespace),
    displayName, kind, base, interfaces: type.interfaces.map(token => metadata.typeName(token)), members: []};
  const add = (member, kind, read) => {
    let details;
    try { details = read(); }
    catch (error) {
      details = {signature: 'Signature unavailable: ' + error.message, error: error.message};
      diagnostics.push({code: 'METADATA_SIGNATURE', token: member.token, message: error.message});
    }
    result.members.push({token: member.token, name: boundedMetadataText(member.name), owner: result.name, kind, ...details});
  };
  for (const field of type.fields) add(field, 'field', () => memberSignature(inspector, field, names));
  for (const method of type.methods) add(method, method.name.startsWith('.') ? 'constructor' : 'method',
    () => memberSignature(inspector, method, names));
  for (const property of type.properties) add(property, 'property', () => propertySignature(inspector, type, property, names, accessors));
  for (const event of type.events) add(event, 'event', () => {
    const eventType = genericText(metadata.typeName(decodeCoded('TypeDefOrRef', event.signatureOrType)), type.token, null, names);
    return {type: eventType, signature: 'event ' + eventType + ' ' + event.name + ';'};
  });
  result.signature = kind + ' ' + displayName + ([base, ...result.interfaces].filter(Boolean).length ?
    ' : ' + [base, ...result.interfaces].filter(Boolean).join(', ') : '');
  return result;
}

/** Inspect CLI declaration/signature tables only; method bodies are neither decoded nor executed. Worker-only in Studio. */
export function inspectMetadata(bytes, {source = {}, limits = metadataLimits} = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > limits.bytes) {
    throw metadataError('METADATA_BYTES_LIMIT', 'Assembly metadata inspection requires a PE file of at most ' + limits.bytes + ' bytes');
  }
  const inspector = new AssemblyInspector(bytes), metadata = inspector.metadata;
  const symbols = inspector.types.length + inspector.methods.size + inspector.fields.size +
    (metadata.rows[23]?.length ?? 0) + (metadata.rows[20]?.length ?? 0);
  if (symbols > limits.symbols) throw metadataError('METADATA_SYMBOL_LIMIT', 'Assembly exceeds the ' + limits.symbols + ' declaration limit');
  const row = metadata.rows[32]?.[0], module = metadata.rows[0]?.[0];
  const name = boundedMetadataText(row ? metadata.string(row[7]) : metadata.string(module?.[1] ?? 0));
  const version = row ? row.slice(1, 5).join('.') : 'module';
  const culture = row ? boundedMetadataText(metadata.string(row[8])) || 'neutral' : 'neutral';
  const publicKey = row?.[6] ? hex(metadata.blob(row[6])) : 'none';
  if (publicKey.length > 4096) throw metadataError('METADATA_KEY_LIMIT', 'Assembly public key exceeds the inspection limit');
  const mvid = hex(metadata.guid(module?.[2] ?? 0));
  const identity = `${name}, Version=${version}, Culture=${culture}, PublicKey=${publicKey}`;
  const diagnostics = [...inspector.diagnostics], names = genericParameters(metadata), accessors = propertyAccessors(inspector);
  const types = inspector.types.filter(type => type.name !== '<Module>').map(type => typeModel(inspector, type, names, accessors, diagnostics));
  let textSize = 0;
  for (const type of types) {
    textSize += type.signature.length;
    for (const member of type.members) textSize += member.signature.length + member.name.length;
  }
  if (textSize > limits.text) throw metadataError('METADATA_TEXT_LIMIT', 'Assembly declaration text exceeds its inspection limit');
  return {schemaVersion: 1, kind: 'pe', name, version, identity, mvid, symbols, bytes: bytes.byteLength,
    source: {...source}, types, diagnostics};
}
