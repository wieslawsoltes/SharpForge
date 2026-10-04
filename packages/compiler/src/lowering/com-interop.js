/**
 * COM interop in code generation (SF-A02-T56): the binder accepts what the language allows on COM types
 * (binder/com-interop.js); the runtime has no COM, so each use is SF2200 naming it and nothing is emitted.
 *
 *   new I()        on a COM interface with a coclass: needs COM activation (CoCreateInstance)
 *   w.M(value)     for a `ref` parameter of a COM interface method: the call itself needs a COM object
 */

/** Class mixin for the body translator: COM creation and calls are reported as runtime gaps. */
export const ComInteropLowering = Base =>
  class extends Base {
    expression(node) {
      if (!node.hasErrors && node.isComCreation) {
        const coClass = node.coClass?.toDisplayString() ?? 'a coclass';
        return this.unsupported(`creating the COM class '${coClass}' (the runtime has no COM activation)`, node.syntax);
      }
      if (!node.hasErrors && node.omitsRef)
        return this.unsupported('a call to a COM interface method that omits ref (the runtime has no COM objects)', node.syntax);
      return super.expression(node);
    }
    effect(node) {
      return node.isComCreation || node.omitsRef ? this.expression(node) : super.effect(node);
    }
  };
