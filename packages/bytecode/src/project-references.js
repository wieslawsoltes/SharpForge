import {projectAssemblyKey, validProjectIdentity} from './project-reference-identity.js';

export {projectAssemblyKey} from './project-reference-identity.js';

export const PROJECT_REFERENCE_FORMAT = 'SharpForge.ProjectReferences/1';

/** Maximum supplied PE bytes and external descriptor counts for a closed project assembly graph. */
export const projectReferenceLimits = Object.freeze({
  assemblies: 512,
  totalBytes: 64 * 1024 * 1024,
  assemblyBytes: 32 * 1024 * 1024,
  types: 8192,
  methods: 65536,
  fields: 65536,
});

const textLimit = 4096;
const parameterLimit = 1024;
const metadataTextLimit = 16 * 1024 * 1024;
const errorLimit = 100;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isIndex = (value, array) => Number.isInteger(value) && value >= 0 && value < array.length;
const isToken = (value, table) => Number.isInteger(value) && value > table * 0x1000000
  && value < (table + 1) * 0x1000000;

class ReferenceValidation {
  constructor(references) {
    this.references = references;
    this.errors = [];
    this.textBytes = 0;
  }

  fail(message) {
    if (this.errors.length < errorLimit) this.errors.push('Project references: ' + message);
    return false;
  }

  get stopped() {
    return this.errors.length >= errorLimit || this.textBytes > metadataTextLimit;
  }

  text(value, label, allowEmpty = false) {
    if (typeof value !== 'string' || value.length > textLimit || (!allowEmpty && !value) || value.includes('\0')) {
      return this.fail('invalid ' + label);
    }
    this.textBytes += value.length * 2;
    if (this.textBytes > metadataTextLimit) return this.fail('metadata text exceeds 16 MiB');
    return true;
  }

  unique(keys, key, label) {
    if (keys.has(key)) return this.fail('duplicate ' + label);
    keys.add(key);
    return true;
  }
}

function validateAssemblies(validation) {
  const identities = new Set();
  for (const assembly of validation.references.assemblies) {
    if (validation.stopped) break;
    if (!isRecord(assembly) || !validProjectIdentity(assembly.identity)) {
      validation.fail('invalid assembly identity');
      continue;
    }
    const identity = assembly.identity;
    validation.text(identity.name, 'assembly name');
    validation.text(identity.cultureName, 'assembly culture', true);
    if (!validation.text(assembly.key, 'assembly key') || assembly.key !== projectAssemblyKey(identity)) {
      validation.fail('assembly key does not match its full identity');
    }
    if (typeof assembly.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(assembly.sha256)) {
      validation.fail('invalid assembly SHA-256');
    }
    const comparisonKey = projectAssemblyKey({...identity, name: identity.name.toLowerCase(),
      cultureName: identity.cultureName.toLowerCase()});
    validation.unique(identities, comparisonKey, 'assembly identity');
  }
}

function validateTypes(validation) {
  const {assemblies, types} = validation.references;
  const tokens = new Set();
  const names = new Set();
  for (const type of types) {
    if (validation.stopped) break;
    if (!isRecord(type) || !isIndex(type.assembly, assemblies) || !isToken(type.token, 2)) {
      validation.fail('invalid type definition token or assembly index');
      continue;
    }
    const validName = validation.text(type.name, 'type name');
    const validImageName = validation.text(type.imageName, 'qualified image type name');
    if (!validName || !validImageName || typeof assemblies[type.assembly]?.key !== 'string') continue;
    if (type.imageName !== '[' + assemblies[type.assembly].key + ']' + type.name) {
      validation.fail('image type name does not match its assembly and metadata name');
    }
    validation.unique(tokens, type.assembly + ':' + type.token, 'type definition token');
    validation.unique(names, type.imageName, 'qualified type name');
  }
}

function validateMembers(validation, kind, table) {
  const {types} = validation.references;
  const tokens = new Set();
  for (const member of validation.references[kind]) {
    if (validation.stopped) break;
    if (!isRecord(member) || !isIndex(member.type, types) || !isRecord(types[member.type])
      || !isToken(member.token, table) || typeof member.isStatic !== 'boolean') {
      validation.fail('invalid ' + kind + ' definition token, declaring type or static flag');
      continue;
    }
    validation.text(member.name, 'member name');
    validation.unique(tokens, types[member.type].assembly + ':' + member.token, kind + ' definition token');
    if (kind === 'methods') validateMethod(validation, member);
    else validation.text(member.fieldType, 'field signature');
  }
}

function validateMethod(validation, method) {
  validation.text(method.returnType, 'return signature');
  if (!Array.isArray(method.parameters) || method.parameters.length > parameterLimit) {
    validation.fail('invalid method parameters or more than 1024 parameters');
    return;
  }
  for (const parameter of method.parameters) {
    if (validation.stopped) break;
    validation.text(parameter, 'parameter signature');
  }
  if (method.name === '.ctor' && method.isStatic) validation.fail('instance constructor cannot be static');
}

/** Validate descriptor structure in bounded linear time, returning up to 100 errors without resolving PE bytes. */
export function verifyProjectReferences(references) {
  const validation = new ReferenceValidation(references);
  if (!isRecord(references) || references.format !== PROJECT_REFERENCE_FORMAT) {
    return ['Project references: invalid profile format'];
  }
  for (const name of ['assemblies', 'types', 'methods', 'fields']) {
    if (!Array.isArray(references[name]) || references[name].length > projectReferenceLimits[name]) {
      validation.fail('invalid or oversized ' + name + ' table');
    }
  }
  if (validation.errors.length) return validation.errors;
  validateAssemblies(validation);
  validateTypes(validation);
  validateMembers(validation, 'methods', 6);
  validateMembers(validation, 'fields', 4);
  return validation.errors;
}
