import {canonicalType, frameworkType} from '@sharpforge/framework';
import {numericAliases} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

const delegateMarker = /^SharpForge\.<>Delegate\{(.+)\}$/;
const loweredDelegate = name => 'SharpForge.<>Delegate{' + encodeURIComponent(name) + '}';
const imageName = name => name.includes('`') ? name.replace(/`\d+/g, '').replace(/</g, '{').replace(/>/g, '}').replace(/,\s*/g, ';') : name;
const primitiveAliases = Object.freeze({
  ...numericAliases, 'System.Object': 'object', 'System.String': 'string', 'System.Boolean': 'bool', 'System.Void': 'void'
});
const normalized = name => primitiveAliases[name] ?? canonicalType(name);
const mappedContractType = name => frameworkType(name)?.kind === 'delegate' ? loweredDelegate(name) : normalized(name);
const sameParameters = (left, right) => left.length === right.length && left.every((type, index) => normalized(type) === normalized(right[index]));

function restoreDelegate(type, methods, encoded) {
  let contractName;
  try { contractName = decodeURIComponent(encoded); } catch { throw new CilError('Invalid canonical delegate type name'); }
  if (loweredDelegate(contractName) !== type.name || contractName.length > 4096) throw new CilError('Invalid canonical delegate marker');
  const methodField = type.fields.find(field => field.name === 'method');
  const nextField = type.fields.find(field => field.name === 'next');
  const invokes = methods.filter(method => method.name === 'Invoke' && method.isStatic);
  const invoke = invokes[0];
  if (type.base || !methodField || normalized(methodField.type) !== 'int' || nextField?.type !== type.name
    || invokes.length !== 1 || invoke.parameters[0]?.type !== type.name || invoke.parameters.length > 1025) {
    throw new CilError('Invalid canonical delegate field or invocation shape');
  }
  const contract = frameworkType(contractName);
  const parameters = invoke.parameters.slice(1).map(parameter => parameter.type);
  const forwarders = methods.filter(method => method.name === '<framework-invoke>');
  if (contract?.kind === 'delegate') {
    if (!sameParameters(parameters, contract.parameters.map(mappedContractType))
      || normalized(invoke.returnType) !== mappedContractType(contract.result)) {
      throw new CilError('Canonical delegate signature does not match its registered contract');
    }
    const forwarder = forwarders[0];
    if (forwarders.length !== 1 || forwarder.isStatic || normalized(forwarder.returnType) !== normalized(invoke.returnType)
      || !sameParameters(forwarder.parameters.map(parameter => parameter.type), parameters)) {
      throw new CilError('Invalid canonical framework delegate forwarder');
    }
    type.frameworkInvoke = forwarder.id;
  } else if (forwarders.length) throw new CilError('An unregistered delegate cannot claim a framework forwarder');
  type.delegateContract = contractName;
  type.delegateInvoke = invoke.id;
}

/** Infer compiler-owned storage only from reserved metadata names plus the actual emitted field/method signatures. */
export function restoreCanonicalCompilerShapes(types, methods) {
  const ownedMethods = new Map();
  for (const method of methods) {
    const entries = ownedMethods.get(method.owner) ?? [];
    entries.push(method);
    ownedMethods.set(method.owner, entries);
  }
  for (const type of types) {
    const marker = delegateMarker.exec(type.name);
    if (marker) restoreDelegate(type, ownedMethods.get(type.name) ?? [], marker[1]);
    if (!type.name.startsWith('<>Cell(')) continue;
    const field = type.fields[0];
    const valueType = primitiveAliases[field?.type] ?? field?.type;
    if (type.base || type.fields.length !== 1 || field.name !== 'Value' || type.name !== '<>Cell(' + imageName(valueType) + ')') {
      throw new CilError('Invalid canonical reference-cell shape');
    }
    type.referenceCell = {valueType, field: field.index};
  }
}
