/**
 * Lowering of partial methods without an implementing part: the method does not exist in the image and a call to
 * it is removed together with its arguments, which are never evaluated (C# spec 15.6.9).
 */
import { n } from '../../codegen/semantic/node-factory.js';

const definitionOf = symbol => symbol?.originalDefinition ?? symbol;

/** Generator mixin: an unimplemented partial method is not declared. */
export const PartialMemberGeneration = Base =>
  class extends Base {
    declareMethod(owner, symbol) {
      if (symbol.isUnimplementedPartial) return undefined;
      return super.declareMethod(owner, symbol);
    }
  };

/** Translator mixin: a call to an unimplemented partial method is nothing. */
export const PartialMemberLowering = Base =>
  class extends Base {
    exprCall(node) {
      if (definitionOf(node.method)?.isUnimplementedPartial) return n.nullLiteral('object');
      return super.exprCall(node);
    }
  };
