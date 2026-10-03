/**
 * Lowering of the comparison members of the simple types (SF-A02-T02): what a call through
 * `where T : IComparable<T>` or `where T : IEquatable<T>` reaches when `T` is `int`, `double`, `bool` or `string`,
 * and the same members called directly (`a.CompareTo(b)`, `x.Equals(y)`).
 *
 * The framework registry has no contract for these members. Where the result is defined by the language's own
 * operators it is expanded in place, with each operand evaluated once:
 *
 *   int.CompareTo(int)        ->  a < b ? -1 : a > b ? 1 : 0
 *   double.CompareTo(double)  ->  the same, with NaN below every number and equal to itself
 *   bool.CompareTo(bool)      ->  a == b ? 0 : a ? 1 : -1
 *   int.Equals(int), bool.Equals(bool), string.Equals(string)  ->  a == b   (ordinal for strings, as on .NET)
 *   double.Equals(double)     ->  a == b || (a != a && b != b)
 *
 * Everything else is refused (SF2200) with the missing contract named: `string.CompareTo(string)` is a
 * culture-sensitive comparison the registry does not have (it lists `CompareOrdinal` only), and
 * `CompareTo(object)` needs a run-time type test.
 */
import { n } from '../../codegen/semantic/node-factory.js';

const int = value => n.literal(value, 'int');
const less = (a, b) => n.binary('<', a, b, 'bool');
const greater = (a, b) => n.binary('>', a, b, 'bool');
/** `x != x`: true for NaN only. */
const isNaN = value => n.notEquals(value(), value());

const ordered = (a, b, unordered = int(0)) => n.conditional(less(a(), b()), int(-1), n.conditional(greater(a(), b()), int(1), unordered));

const expansions = Object.freeze({
  CompareTo: {
    int: (a, b) => ordered(a, b),
    // Neither less nor greater: equal, or at least one NaN (NaN compares below every number and equal to NaN).
    double: (a, b) =>
      ordered(a, b, n.conditional(n.equals(a(), b()), int(0), n.conditional(isNaN(a), n.conditional(isNaN(b), int(0), int(-1)), int(1)))),
    bool: (a, b) => n.conditional(n.equals(a(), b()), int(0), n.conditional(a(), int(1), int(-1))),
  },
  Equals: {
    int: (a, b) => n.equals(a(), b()),
    bool: (a, b) => n.equals(a(), b()),
    string: (a, b) => n.equals(a(), b()),
    double: (a, b) => n.logicalOr(n.equals(a(), b()), n.logicalAnd(isNaN(a), isNaN(b))),
  },
});

/** Class mixin for the body translator. */
export const PrimitiveMemberTranslation = Base =>
  class extends Base {
    frameworkInvocation(node, method) {
      const operation = (method.originalDefinition ?? method).primitiveMember;
      if (!operation) return super.frameworkInvocation(node, method);
      const type = this.imageType(method.containingType, node.syntax),
        expand = expansions[operation]?.[type];
      if (!expand || !node.receiver) return this.unsupported(`'${method.toDisplayString()}' (not in the framework registry)`, node.syntax);
      const receiver = this.once(this.expression(node.receiver), 'left'),
        argument = this.once(this.arguments(node, method)[0], 'right'),
        effects = [...receiver.effects, ...argument.effects];
      // A member of a null string throws before anything is compared: reading its length does that.
      if (type === 'string') effects.push(this.stringLength(receiver.read()));
      const value = expand(receiver.read, argument.read);
      return effects.length ? n.sequence([...receiver.locals, ...argument.locals], effects, value) : value;
    }
    /** `text.Length` through the registry's own accessor. */
    stringLength(receiver) {
      const get = this.g.analysis.core.string.getMembers('Length').find(member => member.kind === 'Property')?.getMethod;
      if (!get?.builtin && !get?.contract) return this.unsupported("'string.Length' (not in the framework registry)", null);
      const property = get.builtin ? { builtin: get.builtin } : { getMethod: get, setMethod: null };
      return { kind: 'PropertyAccess', legacyType: 'int', isExpression: true, property, receiver };
    }
  };
