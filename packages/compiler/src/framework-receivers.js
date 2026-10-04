import {canonicalType, frameworkType, findContracts} from '@sharpforge/framework';
import {memberPath} from './binder/member-path.js';

/** Resolve framework receivers only after source types have had their normal lookup precedence. */
export function frameworkReceiver(compiler, node) {
  if (node?.kind !== 'Member') return null;
  const path = memberPath(node.target);
  const root = path?.split('.')[0];
  const value = root && (compiler.lookup(root) || compiler.m.owner?.fields?.some(field => field.name === root) ||
    compiler.m.owner?.properties?.some(property => property.name === root));
  const staticType = path && !value && !compiler.c.findType(path, compiler.m) &&
    frameworkType(path === 'string' ? 'System.String' : path);
  if (staticType) return {type: staticType.name, isStatic: true, node: null};
  const inferred = compiler.infer(node.target);
  const type = inferred === 'string' ? 'System.String' : canonicalType(inferred);
  const entry = frameworkType(type);
  return entry ? {type: entry.name, isStatic: false, node: node.target} : null;
}

/** A property remains an accessor contract and is distinct from registered field metadata. */
export function frameworkProperty(compiler, node) {
  const receiver = compiler.frameworkReceiver(node);
  if (!receiver) return null;
  const get = findContracts(receiver.type, 'get_' + node.name, receiver.isStatic)[0];
  const set = findContracts(receiver.type, 'set_' + node.name, receiver.isStatic)[0];
  return get || set ? {receiver, get, set, type: get?.result ?? set.parameters[0]} : null;
}
