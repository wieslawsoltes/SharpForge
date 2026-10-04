import {connectSourceInterfaceType} from '../../codegen/semantic/interface-shape.js';
import {sourceTypeShape} from '../../codegen/semantic/source-type-shape.js';
import {sourceConstructionIdentity} from './source-type-identity.js';
import {declareConstructedObjectOverrides} from './source-object-overrides.js';
/**
 * Declaration of generic constructions in the image (SF-A02-T02.6): the generator half of monomorphization.
 *
 * A construction of a generic class is declared like a class of its own - fields, statics, initializers - from the
 * members of the generic definition, with the substitution of the construction active so that every member type is
 * closed. Its methods, and the constructions of generic methods, are declared one by one when code first refers to
 * them: only what the program calls is generated, as on .NET.
 */
import { TypeKind } from '../../symbols/types.js';

/** Class mixin for the generator: `declareTypeInstance` and `declareMethodInstance`, called by `GenericInstantiations`. */
export const GenericDeclarations = Base =>
  class extends Base {
    /** Declares the image class, fields and initializers of a closed construction of a generic class. */
    declareTypeInstance(instance) {
      const definition = instance.definition,
        generics = this.generics,
        at = definition.locations?.[0];
      if (definition.isRecord) this.unsupported('generic records', at);
      instance.record = this.program.addClass(instance.name, this.nodeOf(definition), sourceTypeShape(definition));
      instance.record.sourceIdentity = sourceConstructionIdentity(this, instance.type);
      generics.withMap(instance.map, () => {
        this.checkClassShape(definition);
        const deferred = generics.deferMethods;
        generics.deferMethods = true;
        try {
          this.declareMembers(definition);
        } finally {
          generics.deferMethods = deferred;
        }
        connectSourceInterfaceType(this, definition, instance.record);
        declareConstructedObjectOverrides(this, instance);
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
    /** Declares the image method of a method of a construction, or of a generic method with closed type arguments. */
    declareMethodInstance(instance) {
      const definition = instance.definition,
        generics = this.generics,
        container = definition.containingType,
        at = definition.locations?.[0];
      if (!container || ![TypeKind.Class, TypeKind.Struct, TypeKind.Interface].includes(container.typeKind)) {
        this.unsupported('a generic method of a type that is not a class', at);
      }
      generics.withMap(instance.map, () => {
        const deferred = generics.deferMethods;
        generics.deferMethods = false;
        try {
          this.declareMethod(this.classOf(container, at), definition);
        } finally {
          generics.deferMethods = deferred;
        }
      });
      this.interfaceMethods.registerMethod(instance);
    }
    declareMethod(owner, symbol) {
      // A generic method exists only as its constructions, and the methods of a construction of a generic class are
      // declared when code refers to them.
      if (this.generics.isOpenMethod(symbol) || this.generics.deferMethods) return undefined;
      return super.declareMethod(owner, symbol);
    }
  };
