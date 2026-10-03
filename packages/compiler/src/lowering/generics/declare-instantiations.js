/**
 * Declaration of generic constructions in the image (SF-A02-T02.6): the generator half of monomorphization.
 *
 * A construction of a generic class is declared like a class of its own - fields, statics, methods, initializers -
 * from the members of the generic definition, with the substitution of the construction active so that every member
 * type is closed. A construction of a generic method is one more image method of its class.
 */
import { TypeKind } from '../../symbols/types.js';

/** Class mixin for the generator: `declareTypeInstance` and `declareMethodInstance`, called by `GenericInstantiations`. */
export const GenericDeclarations = Base =>
  class extends Base {
    /** Declares the image class, members and initializers of a closed construction of a generic class. */
    declareTypeInstance(instance) {
      const definition = instance.definition,
        at = definition.locations?.[0];
      if (definition.isRecord) this.unsupported('generic records', at);
      instance.record = this.program.addClass(instance.name, this.nodeOf(definition));
      this.generics.withMap(instance.map, () => {
        this.checkClassShape(definition);
        this.declareMembers(definition);
        const instanceWork = this.declareInstanceInitializer(definition, instance.record),
          typeWork = this.declareTypeInitializer(definition, instance.record);
        if (!instanceWork && !typeWork) return;
        // The initializers are lowered when the body that asked for the construction is done: lowering them here
        // would run the queue of that body in the middle of it.
        this.queueBody({
          run: () => {
            if (typeWork) this.buildTypeInitializers([typeWork]);
            if (instanceWork) this.buildInstanceInitializers([instanceWork]);
          },
        });
      });
    }
    /** Declares the image method of a generic method constructed with closed type arguments. */
    declareMethodInstance(instance) {
      const definition = instance.definition,
        container = definition.containingType,
        at = definition.locations?.[0];
      if (!container || container.typeKind !== TypeKind.Class) this.unsupported('a generic method of a type that is not a class', at);
      this.generics.withMap(instance.map, () => this.declareMethod(this.classOf(container, at), definition));
    }
  };
