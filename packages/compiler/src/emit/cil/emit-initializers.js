/**
 * Object and collection initializers (SF-A02-T30).
 *
 *   new T(...) { A = x, B = { C = y }, L = { 1, 2 }, [k] = v }
 *
 * The new object goes to a temporary and each initializer works through it: a member initializer assigns, a nested
 * initializer (`B = { ... }`) reads the member and initializes the object it holds, and a collection initializer
 * calls `Add` on it. The bound targets name the object being initialized as their receiver: the creation node, the
 * enclosing target, or an `ImplicitReceiver` placeholder.
 */
const isNestedInitializer = value => value?.kind === 'ObjectInitializer' || value?.kind === 'CollectionInitializer';

/** Class mixin: initializers. */
export const InitializerEmission = Base =>
  class extends Base {
    /** Runs the initializers of a creation expression on the new object, which is on the stack and stays there. */
    objectInitializers(node) {
      const il = this.il,
        slot = this.temp(node.type);
      il.emit('stloc', slot);
      this.initialize(node, { value: () => il.emit('ldloc', slot), address: () => il.emit('ldloca', slot) });
      il.emit('ldloc', slot);
    }
    /**
     * Runs member and collection initializers on an object.
     * @param list `{initializers?, collectionInitializers?}`  @param {{value: () => void, address: () => void}} created
     *   pushes the object being initialized (its address, for a struct)
     */
    initialize(list, created) {
      const outer = this.implicitReceiver;
      this.implicitReceiver = created;
      try {
        for (const initializer of list.initializers ?? []) this.memberInitializer(initializer, created);
        // (A spread of a collection expression into a type without `AddRange` is a `foreach` that adds each item.)
        for (const element of list.collectionInitializers ?? []) {
          if (element.kind === 'ForEach') this.statement(element);
          else this.effect(element);
        }
      } finally {
        this.implicitReceiver = outer;
      }
    }
    /** `Member = value` or `Member = { ... }`; the receiver of the target stands for the object being initialized. */
    memberInitializer(initializer, created) {
      const target = initializer.target,
        receiver = target?.receiver ?? target?.array ?? null,
        isPlaceholder = !receiver || receiver.kind === 'ImplicitReceiver',
        outer = this.assignmentTarget;
      if (!target || !initializer.value) return this.unsupported('this initializer form', target?.syntax);
      if (!isPlaceholder) this.substitutions.set(receiver, created);
      try {
        if (isNestedInitializer(initializer.value)) return this.nestedInitializer(target, initializer.value);
        this.assignmentTarget = target;
        const location = this.location(target);
        this.assignmentTarget = outer;
        location.beginStore();
        this.expression(initializer.value);
        location.endStore();
      } finally {
        this.assignmentTarget = outer;
        if (!isPlaceholder) this.substitutions.delete(receiver);
      }
      return undefined;
    }
    /**
     * `Member = { ... }` initializes the object the member holds. The member is read again for every nested
     * initializer (`x.Items.Add(a); x.Items.Add(b);`), which is what C# specifies and what a getter with side
     * effects observes; a struct member is initialized in place.
     */
    nestedInitializer(target, value) {
      const location = this.location(target);
      location.capture();
      const inner = { value: () => location.load(), address: () => location.address() };
      // The nested targets name this target as their receiver.
      this.substitutions.set(target, inner);
      try {
        this.initialize(value, inner);
      } finally {
        this.substitutions.delete(target);
      }
    }
    exprImplicitReceiver(node) {
      if (!this.implicitReceiver) return this.unsupported('an initializer receiver in this position', node.syntax);
      this.implicitReceiver.value();
      return undefined;
    }
    address(node) {
      if (node.kind === 'ImplicitReceiver' && this.implicitReceiver) return this.implicitReceiver.address();
      return super.address(node);
    }
  };
