/**
 * Declares the image shape of a program from its source symbols: one image class per source class, its fields and
 * statics, one image method per method, constructor and accessor, and the per-class instance initializer.
 * Bodies are produced later (generator.js); this pass only fixes names, slots and signatures so that bodies can
 * refer to members declared after them.
 */
import { fileLocalClassName } from '../../binder/csharp11.js';
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { backingFieldName } from '../../lowering/generated-names.js';
import { isByReference } from '../../lowering/by-reference.js';
import { spanOf } from './node-factory.js';
import {declareUIEventAccessors} from './ui-event-accessors.js';
import {declareSourcePropertyMetadata} from './property-metadata.js';
import {accessorBaseName} from '../../binder/members/indexer-names.js';

const definitionOf = symbol => symbol.originalDefinition ?? symbol;

/** Class mixin: declaration of image classes and members. */
export const Declarations = Base =>
  class extends Base {
    /** The location shim of a source symbol (`{uri,start,end}` of its declaration). */
    nodeOf(symbol) {
      const syntax = symbol.syntax ?? symbol.declarations?.[0]?.syntax;
      const uri = symbol.uri ?? symbol.locations?.[0]?.uri ?? this.files[0]?.source.uri;
      return syntax ? spanOf(syntax, uri) : spanOf(symbol.locations?.[0] ?? { start: 0, end: 0 }, uri);
    }
    declareTypes() {
      for (const type of this.analysis.assembly.types) {
        if (type.typeKind !== TypeKind.Class) continue;
        // A generic class exists only as its constructions, declared when code refers to them (lowering/generics).
        if (this.generics.isGenericClass(type)) continue;
        this.checkClassShape(type);
        this.classes.set(type, this.program.addClass(this.classNameOf(type), this.nodeOf(type)));
      }
      for (const type of this.classes.keys()) this.declareMembers(type);
    }
    classNameOf(type) {
      if (!type.isFileLocal) return type.toDisplayString();
      // Two files may declare a file-local type of the same name: the image class is named after the file too.
      const uri = type.declarations?.[0]?.uri;
      return fileLocalClassName(type, this.files.findIndex(file => file.source.uri === uri));
    }
    /** Classes the runtime can represent today: no base class but object and no interface that needs dispatch. */
    checkClassShape(type) {
      const at = type.locations?.[0];
      const base = type.baseType;
      if (base && base.specialType !== 'System_Object' && !this.ui.accepts(type)) this.unsupported('class inheritance', at);
      // Three interfaces need no dispatch: `using` and `await using` call the method of the static type, and a
      // collection initializer only requires IEnumerable to be listed (its Add calls are bound statically).
      // Nor does an interface declared in source: the framework cannot call it, a value of the interface type is
      // refused where it is used ('interface dispatch'), and a call through a type parameter constrained to it is
      // bound to the implementing method of each construction (lowering/generics).
      const core = this.analysis.core,
        // ... nor do the comparison interfaces: no registry contract calls them back (a collection over a class that
        // implements one is not shared with the construction over `object`, and sorting such a collection is refused).
        // ... nor the awaiter interfaces: `await` calls the members of the awaiter's static type.
        awaiterInterfaces = [core.inotifyCompletion, core.icriticalNotifyCompletion],
        dispatchFree = [core.iasyncDisposable, core.ienumerable, core.icomparable, core.icomparableT, core.iequatableT, ...awaiterInterfaces],
        needsDispatch = i => i.specialType !== 'System_IDisposable' && !dispatchFree.includes(i.originalDefinition ?? i) &&
          !this.isSource(i) && !this.ui.supportedInterface(i);
      if (type.interfaces?.some(needsDispatch)) this.unsupported('interface implementation', at);
    }
    /** The image class of a source class symbol; for a generic class, of the construction `type` names. */
    classOf(type, syntax = null) {
      const key = this.generics.keyOf(type, syntax),
        record = key.record ?? this.classes.get(key);
      return record ?? this.unsupported(`type '${type.toDisplayString()}'`, syntax);
    }
    declareMembers(type) {
      const owner = this.classOf(type);
      if (owner.membersDeclared) return;
      if (owner.declaringMembers) this.unsupported('cyclic source inheritance', type.locations?.[0]);
      owner.declaringMembers = true;
      if (this.ui.accepts(type) && type.baseType && this.isSource(type.baseType)) this.declareMembers(type.baseType);
      this.ui.configure(type, owner);
      for (const member of type.getMembers()) {
        switch (member.kind) {
          case SymbolKind.Field:
            this.declareField(owner, member);
            break;
          case SymbolKind.Property:
            this.declareProperty(owner, member);
            break;
          case SymbolKind.Event:
            this.declareEvent(owner, member);
            break;
          case SymbolKind.Method:
            this.declareMethod(owner, member);
            break;
          default:
            break;
        }
      }
      owner.membersDeclared = true;
      owner.declaringMembers = false;
    }
    declareField(owner, symbol) {
      if (symbol.isConst || this.fields.has(symbol)) return;
      const type = this.types.imageType(symbol.type, symbol.locations?.[0]);
      const record = symbol.isStatic
        ? this.program.addStatic(owner, symbol.name, type)
        : this.program.addField(owner, symbol.name, type, { backing: !!symbol.associatedSymbol });
      this.fields.set(symbol, record);
    }
    declareProperty(owner, symbol) {
      if (symbol.parameters?.length && symbol.refKind && symbol.refKind !== 'none') this.unsupported('ref returns', symbol.locations?.[0]);
      for (const accessor of [symbol.getMethod, symbol.setMethod]) if (accessor) this.declareMethod(owner, accessor);
      declareSourcePropertyMetadata(this, owner, symbol);
      if (!symbol.isAutoProperty) return;
      // An auto-property: the backing field exists even when the symbol table did not materialise one.
      const backing = symbol.backingField;
      if (backing && this.fields.has(backing)) {
        this.autoProperties.set(symbol, this.fields.get(backing));
        return;
      }
      const type = this.types.imageType(symbol.type, symbol.locations?.[0]);
      const name = backingFieldName(symbol.name);
      const record = symbol.isStatic ? this.program.addStatic(owner, name, type) : this.program.addField(owner, name, type, { backing: true });
      if (backing) this.fields.set(backing, record);
      this.autoProperties.set(symbol, record);
    }
    /** A field-like event is a field of the delegate class; an event with accessors has only its accessor methods. */
    declareEvent(owner, symbol) {
      if (symbol.addMethod?.hasBody || symbol.removeMethod?.hasBody) {
        for (const accessor of [symbol.addMethod, symbol.removeMethod]) if (accessor?.hasBody) this.declareMethod(owner, accessor);
        return;
      }
      const type = this.types.imageType(symbol.type, symbol.locations?.[0]);
      const record = symbol.isStatic ? this.program.addStatic(owner, symbol.name, type) : this.program.addField(owner, symbol.name, type);
      this.eventFields.set(symbol, record);
      declareUIEventAccessors(this, owner, symbol, record);
    }
    declareMethod(owner, symbol) {
      // Synthesized record members are declared when code first refers to them (lowering/records/record-members.js).
      if (this.methods.has(symbol) || symbol.recordMember) return;
      const at = symbol.locations?.[0];
      switch (symbol.methodKind) {
        case MethodKind.Destructor:
          // A finalizer is compiled like any method and never called: the runtime has no finalization, and .NET does
          // not run finalizers at exit either. Its body is still lowered, so what it uses is still checked.
          break;
        case MethodKind.EventAdd:
        case MethodKind.EventRemove:
          if (!symbol.hasBody) return undefined;
          break;
        default:
          break;
      }
      const isVirtual = symbol.isAbstract || symbol.isVirtual || symbol.isOverride;
      if (isVirtual && !this.records.dispatchesStatically(symbol) && !this.ui.supportsMethod(symbol)) {
        this.unsupported('virtual dispatch outside the UI subclass profile', at);
      }
      // An extern method has no body to lower. Declaring one is harmless; calling it is reported (see methodOf).
      if (symbol.isExtern) return undefined;
      const isConstructor = symbol.methodKind === MethodKind.Constructor;
      // The implicit parameterless constructor has nothing to run: creation allocates and runs the field initializers.
      if (isConstructor && symbol.isImplicitlyDeclared) return undefined;
      const ordinary = this.generics.methodNameOf(symbol),
        name = isConstructor ? '.ctor' : symbol.methodKind === MethodKind.StaticConstructor ? '<cctor>' : ordinary;
      const record = this.program.addMethod(owner, name, {
        isStatic: symbol.isStatic,
        returnType: isConstructor || symbol.methodKind === MethodKind.StaticConstructor ? 'void' : this.types.imageType(symbol.returnType, at),
        parameters: this.parametersOf(symbol),
        node: this.nodeOf(symbol),
        hasSource: !symbol.isImplicitlyDeclared,
        accessor: this.accessorOf(symbol),
        ...this.ui.methodMetadata(symbol),
        access: symbol.declaredAccessibility,
      });
      this.methods.set(symbol, record);
      return record;
    }
    parametersOf(symbol) {
      return symbol.parameters.map(p => {
        if (p.isParams) this.paramsParameters.add(p);
        const type = this.types.imageType(p.type, p.locations?.[0] ?? symbol.locations?.[0]);
        // A by-reference parameter receives the cell that holds the argument variable (lowering/by-reference.js).
        return { name: p.name, type: isByReference(p) ? this.cellClass(type).record.name : type };
      });
    }
    accessorOf(symbol) {
      const property = symbol.associatedSymbol;
      if (symbol.methodKind !== MethodKind.PropertyGet && symbol.methodKind !== MethodKind.PropertySet) return null;
      if (!property) return null;
      return {property: accessorBaseName(property),
        kind: symbol.methodKind === MethodKind.PropertyGet ? 'get' : 'set', access: symbol.declaredAccessibility};
    }
    /** The image method of a source method symbol. */
    methodOf(symbol, syntax = null) {
      // The key is resolved here so that a construction declared by this reference is reported at the reference.
      const record = this.methods.get(this.generics.keyOf(symbol, syntax)) ?? this.records.methodOf(definitionOf(symbol), syntax);
      if (!record && definitionOf(symbol).isExtern)
        return this.unsupported(`a call to the extern method '${symbol.toDisplayString()}' (the runtime has no platform invoke)`, syntax);
      return record ?? this.unsupported(`method '${symbol.toDisplayString()}'`, syntax);
    }
  };
