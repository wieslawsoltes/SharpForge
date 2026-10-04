import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * Unsafe code in iterators (SF-A02-T82, C# 13 "ref and unsafe in async and iterator methods"): an iterator may
 * contain unsafe blocks, with two restrictions Roslyn reports while binding:
 *
 *   CS9238  `yield return` inside an `unsafe` block (on the `yield` keyword); `yield break` is allowed
 *   CS9239  `&` applied to a local or a parameter of an iterator (on the operand): its storage is a field of the
 *           iterator object
 *
 * Below C# 13 the unsafe block itself is the gated construct, so neither rule is applied there.
 */

/** Binder mixin: the restrictions on unsafe code in iterators. */
export const UnsafeIteratorBinding = Base =>
  class extends Base {
    statement(syntax) {
      if (syntax.kind === 'YieldReturnStatement' && this.unsafeBlocks > 0 && this.version.number >= 13) this.report(syntax.yieldKeyword, DiagnosticId.CS9238);
      return super.statement(syntax);
    }
    addressOf(syntax, inFixedInitializer) {
      const result = super.addressOf(syntax, inFixedInitializer),
        operand = result.operand?.kind;
      // Whether the method is an iterator is known once its body is bound (a `yield` may follow): CSharp13BodyRules
      // reports CS9239 for the operands recorded here.
      if (this.version.number >= 13 && (operand === 'Local' || operand === 'Parameter')) (this.rootBinder.addressOfLocals ??= []).push(syntax.operand);
      return result;
    }
  };
