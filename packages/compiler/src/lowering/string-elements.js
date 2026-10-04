/**
 * Lowering of the elements of a string (SF-A02-T46) onto the runtime's `string.get_Chars` intrinsic, which both
 * engines execute: the bytecode VM as a builtin, the CIL back end as `callvirt String::get_Chars`.
 *
 *   s[i]                    ->  (char) string.get_Chars(s, i)
 *   foreach (char c in s)   ->  $s = s; $i = 0; for (; $i < $s.Length; $i++) { char c = (char) string.get_Chars($s, $i); body }
 *
 * The intrinsic yields the UTF-16 code unit as an `int`; the conversion gives it the `char` identity the image keeps
 * for scalar values. A null string or an index outside the string is rejected by the intrinsic itself
 * (NullReferenceException, IndexOutOfRangeException), as on .NET. `s[^n]` reaches this through the index lowering.
 */
import { BuiltinMap } from '@sharpforge/bytecode';
import { n } from '../codegen/semantic/node-factory.js';

const CHARS = 'string.get_Chars';
const isString = type => type?.specialType === 'System_String';

/** Class mixin for the body translator: string element reads and foreach over a string. */
export const StringElementLowering = Base =>
  class extends Base {
    exprIndexerAccess(node) {
      // The binder gives a string element access a stand-in property: the registry lists no indexer for System.String.
      if (!isString(node.receiver?.type) || this.g.isSource(node.property) || node.args.length !== 1) return super.exprIndexerAccess(node);
      return this.stringElement(this.expression(node.receiver), this.expression(node.args[0].expression), node.syntax);
    }
    /** `text[index]` as a `char`. */
    stringElement(text, index, syntax) {
      const builtin = BuiltinMap.get(CHARS);
      if (!builtin) return this.unsupported(`'string.this[int]' (the runtime has no ${CHARS} intrinsic)`, syntax);
      return n.convert(n.frameworkCall({ builtin }, null, [text, index], 'int'), 'char');
    }
    stmtForEach(node) {
      if (!node.local || node.isAwait || !isString(node.collection?.type)) return super.stmtForEach(node);
      return this.scoped(() => {
        const span = this.span(node.syntax),
          text = this.holder('string', 'text'),
          index = this.holder('int', 'index'),
          elementType = this.imageType(node.local.type, node.syntax);
        const body = this.scoped(() => {
          const element = this.stringElement(text.read(), index.read(), node.syntax),
            value = elementType === 'char' ? element : n.convert(element, elementType);
          return [...this.declareVariable(node.local, value, span), this.embedded(node.body)];
        });
        const loop = {
          kind: 'ForStatement',
          syntax: span,
          locals: [],
          initializer: null,
          condition: n.binary('<', index.read(), this.stringLength(text.read()), 'bool'),
          body,
          increment: n.increment('++', index.read(), true),
          labels: [],
        };
        return [text.init(this.expression(node.collection), span), index.init(n.literal(0, 'int')), loop];
      });
    }
  };
