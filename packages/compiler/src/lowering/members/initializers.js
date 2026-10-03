/**
 * Lowering of object and collection initializers (SF-A02-T10.6), in the order .NET evaluates them.
 *
 *   new T(a) { X = v, [i] = w, L = { 1, 2 }, P = { Y = u } }
 *     $new = new T(a);
 *     $new.X = v;
 *     $index = i; $new[$index] = w;        index arguments are evaluated once, before the value
 *     $new.L.Add(1); $new.L.Add(2);        a nested initializer reads its member again for every element,
 *     $new.P.Y = u;                        exactly as Roslyn emits it
 *     -> $new
 *
 * The object lives in a temporary while it is initialized; `initializerReceiver.read()` yields the object the
 * current (possibly nested) initializer works on.
 */
import { n } from '../../codegen/semantic/node-factory.js';

const indexKinds = new Set(['IndexerAccess', 'ArrayAccess']);

/** Class mixin for the body translator: object, collection, nested and index initializers. */
export const InitializerLowering = Base =>
  class extends Base {
    /** `new T(...) { ... }`: the created object is held in a temporary while its initializer runs. */
    withInitializers(node, creation) {
      const temp = this.temp(creation.legacyType, 'new'),
        sink = { locals: [temp], effects: [n.assign(n.local(temp), creation)] };
      this.initializerEffects(node, () => n.local(temp), sink);
      return n.sequence(sink.locals, sink.effects, n.local(temp));
    }
    /** Appends the effects of the initializer lists of `node` to `sink`, with `read()` as the object they work on. */
    initializerEffects(node, read, sink) {
      const saved = this.initializerReceiver;
      this.initializerReceiver = { read };
      try {
        for (const entry of node.initializers ?? []) this.memberInitializer(entry, sink);
        for (const call of node.collectionInitializers ?? []) sink.effects.push(this.effect(call));
      } finally {
        this.initializerReceiver = saved;
      }
    }
    memberInitializer(entry, sink) {
      if (!entry.target || !entry.value) return this.unsupported('this object initializer form', entry.target?.syntax);
      // Index arguments are evaluated once, before the value; the object itself is already in a temporary.
      const target = indexKinds.has(entry.target.kind) ? this.spillOperands(entry.target, sink, { receiver: false }) : entry.target;
      if (entry.value.kind === 'ObjectInitializer') return this.initializerEffects(entry.value, this.rereadIn(target), sink);
      sink.effects.push(this.storeIntoTarget(target, this.expression(entry.value)));
      return undefined;
    }
    /** A reader that evaluates `target` afresh on the object of the enclosing initializer. */
    rereadIn(target) {
      const outer = this.initializerReceiver;
      return () => {
        const saved = this.initializerReceiver;
        this.initializerReceiver = outer;
        try {
          return this.expression(target);
        } finally {
          this.initializerReceiver = saved;
        }
      };
    }
    /** The object a collection element is added to, or an index initializer indexes. */
    exprImplicitReceiver(node) {
      return this.initializerReceiver ? this.initializerReceiver.read() : this.unsupported('an initializer receiver in this position', node.syntax);
    }
  };
