/**
 * The state of definite assignment analysis: the set of variables (and struct fields) that are definitely assigned
 * on one control-flow path. `null` stands for an unreachable path, on which everything counts as assigned.
 */
import { TypeKind } from '../../symbols/types.js';

/** A user-declared struct, whose locals are assigned field by field. */
export const isUserStruct = type =>
  !!type && type.typeKind === TypeKind.Struct && !type.specialType && !type.isNullableValueType && type.isSource;

export class AssignmentState {
  constructor(assigned = new Set()) {
    this.set = assigned;
  }
  clone() {
    return new AssignmentState(new Set(this.set));
  }
  has(key) {
    return this.set.has(key);
  }
  add(key) {
    this.set.add(key);
    return this;
  }
}

/** The state where two paths meet: what is assigned on both. An unreachable path does not constrain the other. */
export function join(a, b) {
  if (!a) return b ? b.clone() : null;
  if (!b) return a.clone();
  const assigned = new Set();
  for (const key of a.set) if (b.set.has(key)) assigned.add(key);
  return new AssignmentState(assigned);
}

/** The key under which one field of a struct variable is tracked. */
export function fieldKey(variable, field) {
  variable.daId ??= Symbol(variable.name);
  const definition = field.originalDefinition ?? field;
  return `${variable.daId.toString()}#${definition.name}@${definition.locations?.[0]?.start ?? ''}`;
}

const singleChildFields = [
  'receiver',
  'operand',
  'left',
  'right',
  'array',
  'condition',
  'whenTrue',
  'whenFalse',
  'governing',
  'handler',
  'expression',
  'target',
  'value',
];
const listChildFields = ['indices', 'elements', 'parts', 'sizes', 'args', 'arms', 'initializers'];
const isBoundNode = value => !!value && typeof value === 'object' && typeof value.kind === 'string' && !value.toDisplayString;

/** Child expressions of a bound node in evaluation order (the generic walk for kinds without special rules). */
export function boundChildren(node) {
  const children = [];
  for (const field of singleChildFields) {
    if (isBoundNode(node[field])) children.push(node[field]);
  }
  for (const field of listChildFields) {
    const list = node[field];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item) continue;
      if (Array.isArray(item)) children.push(...item.filter(isBoundNode));
      else if (item.spread) children.push(item.spread);
      else {
        const child = item.expression ?? item.value ?? item;
        if (isBoundNode(child)) children.push(child);
      }
    }
  }
  return children;
}
