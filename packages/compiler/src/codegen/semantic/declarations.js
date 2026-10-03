/**
 * Declares the image shape of a program from its source symbols: one image class per source class, its fields and
 * statics, one image method per method, constructor and accessor, and the per-class instance initializer.
 * Bodies are produced later (generator.js); this pass only fixes names, slots and signatures so that bodies can
 * refer to members declared after them.
 */
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { backingFieldName } from '../../lowering/generated-names.js';
import { isByReference } from '../../lowering/by-reference.js';
import { spanOf } from './node-factory.js';
import { isUnimplementedPartial } from '../../binder/partial-methods.js';

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
        this.checkClassShape(type);
        this.classes.set(type, this.program.addClass(this.classNameOf(type), this.nodeOf(type)));
      }
      for (const type of this.classes.keys()) this.declareMembers(type);
    }
    classNameOf(type) {
      return type.toDisplayString();
    }
    /** Classes the runtime can represent today: no base class but object, no interfaces, no type parameters. */
    checkClassShape(type) {
      const at = type.locations?.[0];
      if (type.arity || type.typeParameters?.length) this.unsupported('user-defined generics', at);
      const base = type.baseType;
      if (base && base.specialType !== 'System_Object') this.unsupported('class inheritance', at);
      // Three interfaces need no dispatch: `using` and `await using` call the method of the static type, and a
      // collection initializer only requires IEnumerable to be listed (its Add calls are bound statically).
      const core = this.analysis.core,
        dispatchFree = [core.iasyncDisposable, core.ienumerable],
        needsDispatch = i => i.specialType !== 'System_IDisposable' && !dispatchFree.includes(i);
      if (type.interfaces?.some(needsDispatch)) this.unsupported('interface implementation', at);
    }
    /** The image class of a source class symbol. */
    classOf(type, syntax = null) {
      const record = this.classes.get(definitionOf(type));
      return record ?? this.unsupported(`type '${type.toDisplayString()}'`, syntax);
    }
    declareMembers(type) {
      const owner = this.classes.get(type);
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
    }
    declareMethod(owner, symbol) {
      // Synthesized record members are declared when code first refers to them (lowering/records/record-members.js).
      if (this.methods.has(symbol) || symbol.recordMember) return;
      // A partial method without an implementing declaration has no code: calls to it were omitted by the binder.
      if (isUnimplementedPartial(symbol)) return undefined;
      const at = symbol.locations?.[0];
      switch (symbol.methodKind) {
        case MethodKind.Destructor:
          return this.unsupported('finalizers', at);
        case MethodKind.EventAdd:
        case MethodKind.EventRemove:
          if (!symbol.hasBody) return undefined;
          break;
        default:
          break;
      }
      if (symbol.typeParameters?.length) this.unsupported('user-defined generics', at);
      const isVirtual = symbol.isAbstract || symbol.isVirtual || symbol.isOverride;
      if (isVirtual && !this.records.dispatchesStatically(symbol)) this.unsupported('virtual dispatch', at);
      if (symbol.isExtern) this.unsupported('extern methods', at);
      const isConstructor = symbol.methodKind === MethodKind.Constructor;
      // The implicit parameterless constructor has nothing to run: creation allocates and runs the field initializers.
      if (isConstructor && symbol.isImplicitlyDeclared) return undefined;
      const name = isConstructor ? '.ctor' : symbol.methodKind === MethodKind.StaticConstructor ? '<cctor>' : symbol.name;
      const record = this.program.addMethod(owner, name, {
        isStatic: symbol.isStatic,
        returnType: isConstructor || symbol.methodKind === MethodKind.StaticConstructor ? 'void' : this.types.imageType(symbol.returnType, at),
        parameters: this.parametersOf(symbol),
        node: this.nodeOf(symbol),
        hasSource: !symbol.isImplicitlyDeclared,
        accessor: this.accessorOf(symbol),
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
      if (!property || property.parameters?.length) return null;
      return { property: property.name, kind: symbol.methodKind === MethodKind.PropertyGet ? 'get' : 'set', access: 'public' };
    }
    /** The image method of a source method symbol. */
    methodOf(symbol, syntax = null) {
      const definition = definitionOf(symbol),
        record = this.methods.get(definition) ?? this.records.methodOf(definition, syntax);
      return record ?? this.unsupported(`method '${symbol.toDisplayString()}'`, syntax);
    }
  };
