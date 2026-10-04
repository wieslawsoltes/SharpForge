/**
 * Equality and text of values whose members the compiler synthesizes (SF-A02-T08.4, T08.6).
 *
 * `==` on tuples, `Equals` and `ToString` of tuples and records are defined member by member, and on .NET they reach
 * each member through virtual calls (`EqualityComparer<T>.Default`, `object.ToString`). The runtime has no virtual
 * dispatch, so the member operation is selected here from the member's static type: primitives are compared and
 * formatted directly, tuples and records by their synthesized static methods (the providers), and a member whose
 * behaviour depends on its run-time type is reported as not executable.
 *
 * Operands are thunks that return a fresh lowered read of the value; an operation may read its operand several times.
 */
import { numericTypeNames } from '@sharpforge/bytecode';
import { findContracts } from '@sharpforge/framework';
import { TypeKind } from '../../symbols/types.js';
import { n } from '../../codegen/semantic/node-factory.js';

const formatValue = () => findContracts('SharpForge.Runtime.Formatting', 'FormatValue', true)[0];
const directlyCompared = new Set([...numericTypeNames.filter(type => type !== 'float' && type !== 'double'), 'bool', 'string']);
const formatted = new Set([...numericTypeNames, 'bool', 'string']);

export class StructuralMembers {
  /** @param host the generator: `{types, isSource(symbol), methodOf(symbol, syntax), unsupported(construct, syntax)}` */
  constructor(host) {
    this.host = host;
    this.providers = [];
  }
  /** Adds a provider `{handles(type), equals(type, left, right, mode, syntax), toString(type, value, syntax)}`. */
  register(provider) {
    this.providers.push(provider);
    return provider;
  }
  providerOf(type) {
    return this.providers.find(provider => provider.handles(type)) ?? null;
  }
  /** True when the text of a value of this type is produced by a synthesized member (a tuple, a record). */
  hasSynthesizedText(type) {
    return !!type && this.providerOf(type) !== null;
  }
  /**
   * A boolean expression comparing two values of `type`.
   * @param {'operator'|'equals'} mode `operator` is the type's `==`; `equals` is `EqualityComparer<T>.Default.Equals`
   */
  equals(type, left, right, mode, syntax = null) {
    const provider = this.providerOf(type);
    if (provider) return provider.equals(type, left, right, mode, syntax);
    const imageType = this.host.types.imageType(type, syntax);
    if (directlyCompared.has(imageType) && type.typeKind !== TypeKind.Enum) return n.equals(left(), right());
    if (type.typeKind === TypeKind.Enum) return n.equals(left(), right());
    if (imageType === 'double' || imageType === 'float') {
      const same = n.equals(left(), right());
      if (mode === 'operator') return same;
      // Single/Double.Equals treat NaN as equal to itself; `==` does not.
      return n.logicalOr(same, n.logicalAnd(n.notEquals(left(), left()), n.notEquals(right(), right())));
    }
    if (type.typeKind === TypeKind.Delegate) return this.host.unsupported('comparing delegates member by member', syntax);
    if (imageType === 'object') {
      if (mode === 'operator') return n.equals(left(), right());
      return this.host.unsupported(`comparing members of type 'object' (needs virtual dispatch)`, syntax);
    }
    if (mode === 'operator' && this.host.isSource(type)) {
      const operator = type.getMembers('op_Equality')[0];
      if (operator) return n.call(this.host.methodOf(operator, syntax), null, [left(), right()]);
    }
    // A class without synthesized members: reference identity (an Equals override would need virtual dispatch,
    // and a class that declares one is not generated at all).
    return n.equals(left(), right());
  }
  /** A string expression with the text `value.ToString()` produces; a null reference gives the empty string. */
  toString(type, value, syntax = null) {
    const provider = this.providerOf(type);
    if (provider) return provider.toString(type, value, syntax);
    if (type.typeKind === TypeKind.Enum) return this.host.unsupported('formatting an enum value', syntax);
    const imageType = this.host.types.imageType(type, syntax);
    if (formatted.has(imageType)) {
      const args = [value(), n.nullLiteral('string'), n.literal(0, 'int'), n.literal(imageType, 'string')];
      return n.frameworkCall({ contract: formatValue() }, null, args, 'string');
    }
    return this.host.unsupported(`the text of a member of type '${type.toDisplayString()}' (needs virtual dispatch)`, syntax);
  }
}
