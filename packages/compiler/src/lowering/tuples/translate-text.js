/**
 * The text of tuples and records where a program asks for it (SF-A02-T08.4, T08.6).
 *
 * On .NET `Console.WriteLine(t)`, `"" + t`, `$"{t}"` and `t.ToString()` reach the synthesized `ToString` through a
 * virtual call on `object`. Here the static type of the operand selects the synthesized method at compile time
 * (lowering/tuples/structural-members.js), so these four forms produce the same text. Any other conversion of such a
 * value to `object` would lose the only thing that identifies its members and is reported as not executable.
 */
import { n } from '../../codegen/semantic/node-factory.js';
import { lowered } from './translate-tuples.js';

const consoleOutput = new Set(['Console.WriteLine', 'Console.Write']);
const toObject = new Set(['Boxing', 'ImplicitReference']);

/** Class mixin: text of values with synthesized members. */
export const SynthesizedTextTranslation = Base =>
  class extends Base {
    hasSynthesizedText(type) {
      return this.g.structural.hasSynthesizedText(type);
    }
    /** The text of a bound value, evaluated once. */
    textOf(node) {
      const value = this.once(this.expression(node), 'text');
      return n.sequence(value.locals, value.effects, this.g.structural.toString(node.type, value.read, node.syntax));
    }
    /** `(object)value` where the value has synthesized text: the same conversion applied to its text. */
    textOperand(node) {
      const isBoxed = node?.kind === 'Conversion' && toObject.has(node.conversion?.kind) && node.type?.specialType === 'System_Object';
      const value = isBoxed ? node.operand : node;
      if (!this.hasSynthesizedText(value?.type)) return node;
      return lowered(this.textOf(value), this.g.analysis.core.string, node.syntax);
    }
    exprCall(node) {
      const method = node.method;
      if (consoleOutput.has(method.builtin?.name) && node.args?.length === 1) {
        const args = [{ ...node.args[0], expression: this.textOperand(node.args[0].expression) }];
        return super.exprCall({ ...node, args });
      }
      const isToString = method.name === 'ToString' && !method.parameters.length && node.receiver;
      if (isToString && this.hasSynthesizedText(node.receiver.type) && !this.g.isSource(method)) return this.textOf(node.receiver);
      return super.exprCall(node);
    }
    exprBinary(node) {
      if (node.family !== 'string' || node.operator !== '+') return super.exprBinary(node);
      return super.exprBinary({ ...node, left: this.textOperand(node.left), right: this.textOperand(node.right) });
    }
    exprInterpolatedString(node) {
      if (!node.parts.some(part => this.hasSynthesizedText(part.type))) return super.exprInterpolatedString(node);
      return super.exprInterpolatedString({ ...node, parts: node.parts.map(part => this.textOperand(part)) });
    }
    exprConversion(node) {
      if (toObject.has(node.conversion?.kind) && this.hasSynthesizedText(node.operand?.type) && !this.hasSynthesizedText(node.type))
        return this.unsupported(
          `converting '${node.operand.type.toDisplayString()}' to '${node.type.toDisplayString()}' (its members need virtual dispatch)`,
          node.syntax,
        );
      return super.exprConversion(node);
    }
  };
