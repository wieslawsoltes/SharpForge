/** Per-use preview context for union conversions, outside the public bound-node data model. */
import { OverloadResolver } from '../overload/resolution.js';

const contexts = new WeakMap();

/** Copies made by argument binding keep syntax identity, so both identities carry the same source context. */
export function rememberUnionContext(expression, context) {
  contexts.set(expression, context);
  if (expression.syntax) contexts.set(expression.syntax, context);
}

export const unionContextOf = expression => contexts.get(expression) ?? contexts.get(expression?.syntax);

/** Overload betterness uses the same per-file conversion rules as argument applicability. */
export class UnionOverloadResolver extends OverloadResolver {
  constructor(...args) {
    super(...args);
    this.previewResolvers = new Map();
  }
  resolve(methods, args, options) {
    const context = args.map(unionContextOf).find(Boolean);
    const conversions = context ? this.conversions.forPreview?.(context.preview) ?? this.conversions : this.conversions;
    if (conversions === this.conversions) return super.resolve(methods, args, options);
    let resolver = this.previewResolvers.get(conversions);
    if (!resolver) {
      resolver = new OverloadResolver(conversions, this.core);
      this.previewResolvers.set(conversions, resolver);
    }
    resolver.violatesConstraints = this.violatesConstraints;
    return resolver.resolve(methods, args, options);
  }
}
