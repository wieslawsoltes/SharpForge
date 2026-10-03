import {BoundTreeRewriter} from '../bound/rewriter.js';
import {LocalRewriter} from './local-rewriter.js';
/**
 * The lowering pipeline: an ordered list of passes that turn the binder's bound tree into the form code
 * generation consumes. The order is Roslyn's:
 *
 *   1. local rewriting      (using, pattern foreach, interpolation, boxing, await calls)
 *   2. closure conversion   (lambdas and local functions to display classes)
 *   3. iterator rewriting   (yield to state machines)
 *   4. async rewriting      (await to state machines)
 *   5. spilling             (evaluation order across awaits)
 *
 * Passes 2-5 are identity rewriters today: the profile has no lambdas or iterators and lowers async methods at the
 * syntax level (async-lowering.js). They are real pipeline stages so the per-language-version epics only have to
 * fill in the rewriter. A pass that changes nothing returns the identical tree.
 */
export class LoweringPass {
  /** @param name stage name; @param createRewriter `(context) -> BoundTreeRewriter`. */
  constructor(name,createRewriter){this.name=name;this.createRewriter=createRewriter;}
  run(body,context){return this.createRewriter(context).visit(body);}
}
/** A rewriter that lowers nothing: the placeholder for pipeline stages that have no constructs to lower yet. */
export class IdentityRewriter extends BoundTreeRewriter {
  constructor(context){super();this.context=context;}
}
export const localRewritingPass=new LoweringPass('local-rewriter',context=>new LocalRewriter(context));
export const closureConversionPass=new LoweringPass('closure-conversion',context=>new IdentityRewriter(context));
export const iteratorRewritingPass=new LoweringPass('iterator-rewriter',context=>new IdentityRewriter(context));
export const asyncRewritingPass=new LoweringPass('async-rewriter',context=>new IdentityRewriter(context));
export const spillingPass=new LoweringPass('spilling',context=>new IdentityRewriter(context));
export const defaultPasses=Object.freeze([localRewritingPass,closureConversionPass,iteratorRewritingPass,asyncRewritingPass,spillingPass]);
/**
 * Runs the passes in order over one method body.
 * @param body the bound body from the binder (null for methods without a body).
 * @param {object} context `{types, wellKnown, report, method}` shared by all passes; `trace` (optional) receives
 *   `(passName, before, after)` after each pass.
 * @returns the lowered body.
 */
export function lowerMethodBody(body,context,passes=defaultPasses){
  let current=body;if(!current)return current;
  for(const pass of passes){const before=current;current=pass.run(current,context);context.trace?.(pass.name,before,current);}
  return current;
}
