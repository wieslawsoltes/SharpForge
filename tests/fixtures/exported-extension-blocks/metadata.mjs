/** Raw CLI snapshots for compiler/Roslyn parity tests; token numbers and generated type names are not compared. */
import { MetadataView, Table, tokenOf, ridOf, tableOf, parseMethodSignature, parseTypeSignature } from
  '../../../packages/compiler/src/metadata-import/pe-metadata.js';
import { decodeAttributeBlob } from '../../../packages/compiler/src/metadata-import/attributes.js';

export { MetadataView, Table, tokenOf, ridOf };

export function findType(view, fullName) {
  const rid = view.rows(Table.TypeDef).findIndex(row =>
    [view.string(row[2]), view.string(row[1])].filter(Boolean).join('.') === fullName) + 1;
  if (!rid) throw new Error('Missing metadata type: ' + fullName);
  return tokenOf(Table.TypeDef, rid);
}

export function methodsOf(view, owner) {
  const [start, end] = view.listRange(Table.TypeDef, ridOf(owner), 5, Table.MethodDef);
  return Array.from({ length: end - start }, (_, index) => tokenOf(Table.MethodDef, start + index));
}

export function findMethod(view, owner, name) {
  const method = methodsOf(view, owner).find(token => view.string(view.row(Table.MethodDef, ridOf(token))[3]) === name);
  if (!method) throw new Error('Missing metadata method: ' + name);
  return method;
}

function typeName(view, token) {
  if (tableOf(token) === Table.TypeSpec) return canonicalSignature(view, parseTypeSignature(view.blob(view.row(Table.TypeSpec, ridOf(token))[0])));
  const name = view.typeTokenName(token);
  return [name.namespace, name.name].filter(Boolean).join('.');
}

export function canonicalSignature(view, node) {
  if (Array.isArray(node)) return node.map(child => canonicalSignature(view, child));
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([key, value]) =>
    [key, key === 'token' ? typeName(view, value) : canonicalSignature(view, value)]));
}

export function attributeSnapshot(view, owner, include = () => true) {
  return view.customAttributes(owner).filter(attribute => include(attribute.fullName)).map(attribute => {
    const decoded = decodeAttributeBlob(attribute.blob, attribute.parameterTypes);
    if (decoded.hasErrors) throw new Error('Malformed custom attribute: ' + attribute.fullName);
    return { name: attribute.fullName, arguments: decoded.constructorArguments.map(argument => argument.value),
      named: decoded.namedArguments.map(argument => [argument.name, argument.value.value]) };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function parameterSnapshot(view, method, include = () => true) {
  const [start, end] = view.listRange(Table.MethodDef, ridOf(method), 5, Table.Param);
  return Array.from({ length: end - start }, (_, index) => {
    const rid = start + index, [flags, sequence, name] = view.row(Table.Param, rid);
    return { flags, sequence, name: view.string(name), attributes: attributeSnapshot(view, tokenOf(Table.Param, rid), include) };
  }).filter(parameter => parameter.sequence !== 0 || parameter.flags || parameter.attributes.length)
    .sort((left, right) => left.sequence - right.sequence);
}

export function genericSnapshot(view, owner, include = () => true) {
  return view.genericParameters(owner).map(parameter => ({
    name: parameter.name, flags: parameter.flags, number: parameter.number,
    attributes: attributeSnapshot(view, tokenOf(Table.GenericParam, parameter.rid), include),
    constraints: view.genericConstraints(parameter.rid).map(constraint => typeName(view, constraint.token)),
  }));
}

export function methodSnapshot(view, method, include = () => true) {
  const row = view.row(Table.MethodDef, ridOf(method));
  return {
    name: view.string(row[3]), signature: canonicalSignature(view, parseMethodSignature(view.blob(row[4]))),
    attributes: attributeSnapshot(view, method, include), parameters: parameterSnapshot(view, method, include),
    typeParameters: genericSnapshot(view, method, include),
  };
}

/** Marker names differ between compilers, so follow the declaration's actual attribute rather than guessing a hash. */
export function extensionMarker(view, owner, declarationName) {
  for (const groupRid of view.nesting.nested.get(ridOf(owner)) ?? []) {
    const group = tokenOf(Table.TypeDef, groupRid);
    const declaration = methodsOf(view, group).find(token => view.string(view.row(Table.MethodDef, ridOf(token))[3]) === declarationName);
    if (!declaration) continue;
    const markerAttribute = attributeSnapshot(view, declaration, name => name.endsWith('.ExtensionMarkerAttribute'))[0];
    const markerName = markerAttribute?.arguments[0];
    const markerRid = (view.nesting.nested.get(groupRid) ?? []).find(rid => view.typeDefName(rid).name === markerName);
    if (!markerRid) throw new Error('Missing extension marker: ' + declarationName);
    return { group, declaration, marker: tokenOf(Table.TypeDef, markerRid) };
  }
  throw new Error('Missing extension grouping declaration: ' + declarationName);
}
