/**
 * Strings (SF-A02-T30): concatenation, string equality and interpolation.
 *
 *   a + b              String.Concat(string, string) when both are strings, else String.Concat(object, object)
 *   a == b, a != b     String.op_Equality / op_Inequality
 *   $"x={a,5:F2}"      String.Format("x={0,5:F2}", new object[] { a })
 *
 * These are the framework's own entry points, so the same assembly runs on .NET and on the direct-CIL runtime.
 */
import { interpolatedText } from '../../binder/csharp6.js';
import { needsBox } from './type-facts.js';

const isString = type => type?.specialType === 'System_String';
const escapeBraces = text => text.replace(/\{/g, '{{').replace(/\}/g, '}}');

/** Class mixin: strings. */
export const StringEmission = Base =>
  class extends Base {
    stringOperator(node) {
      if (node.operator === '+') return this.concatenation(node);
      if (node.operator !== '==' && node.operator !== '!=') return this.unsupported(`'${node.operator}' on strings`, node.syntax);
      this.expression(node.left);
      this.expression(node.right);
      const name = node.operator === '==' ? 'op_Equality' : 'op_Inequality',
        string = this.core.string,
        shape = { isStatic: true, returnType: this.core.bool, parameters: [{ type: string }, { type: string }] };
      return this.il.emit('call', this.tokens.external(string, name, shape), { pops: 2, pushes: 1 });
    }
    /** One `+`: both operands as strings when they are, otherwise both as objects (a null operand is the empty string). */
    concatenation(node) {
      const { left, right } = node,
        string = this.core.string,
        bothStrings = isString(left.type) && isString(right.type),
        parameterType = bothStrings ? string : this.core.object;
      this.concatenationOperand(left, bothStrings);
      this.concatenationOperand(right, bothStrings);
      const shape = { isStatic: true, returnType: string, parameters: [{ type: parameterType }, { type: parameterType }] };
      return this.il.emit('call', this.tokens.external(string, 'Concat', shape), { pops: 2, pushes: 1 });
    }
    concatenationOperand(operand, asString) {
      this.expression(operand);
      if (!asString && operand.type && needsBox(operand.type)) this.il.emit('box', this.tokens.type(operand.type));
    }
    exprInterpolatedString(node) {
      const il = this.il,
        string = this.core.string,
        object = this.core.object,
        holes = [];
      let format = '',
        index = 0;
      for (const content of node.syntax.contents) {
        if (content.kind !== 'Interpolation') {
          format += escapeBraces(interpolatedText(content));
          continue;
        }
        const alignment = this.alignmentOf(content, node.alignments?.[index]),
          clause = content.formatClause ? ':' + escapeBraces(content.formatClause.formatStringToken.valueText) : '';
        format += '{' + holes.length + (alignment === null ? '' : ',' + alignment) + clause + '}';
        holes.push(node.parts[index++]);
      }
      if (!holes.length) return il.emit('ldstr', this.tokens.string(format.replace(/\{\{/g, '{').replace(/\}\}/g, '}')));
      il.emit('ldstr', this.tokens.string(format));
      il.emit('ldc.i4', holes.length).emit('newarr', this.tokens.type(object));
      holes.forEach((hole, position) => {
        il.emit('dup').emit('ldc.i4', position);
        this.concatenationOperand(hole, false);
        il.emit('stelem.ref');
      });
      const shape = { isStatic: true, returnType: string, parameters: [{ type: string }, { type: this.core.arrayOf(object) }] };
      return il.emit('call', this.tokens.external(string, 'Format', shape), { pops: 2, pushes: 1 });
    }
    /** The alignment of a hole: the constant the binder computed, else the literal as written; null when there is none. */
    alignmentOf(content, bound) {
      if (!content.alignmentClause) return null;
      const value = bound ?? Number(content.alignmentClause.value.toString().trim());
      if (!Number.isInteger(value)) return this.unsupported('a computed interpolation alignment', content);
      return value;
    }
  };
