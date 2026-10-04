/**
 * Object creation and fields (SF-A02-T30): `new` for classes and structs with object initializers, field reads, and
 * what a constructor runs before its body - the instance initializers and the call of the base (or `this`)
 * constructor, in the order .NET runs them.
 */
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { isReference } from './type-facts.js';

const isConstructorSymbol = value => !!value && typeof value === 'object' && value.kind === SymbolKind.Method;

/** Class mixin: objects and fields. */
export const ObjectEmission = Base =>
  class extends Base {
    exprFieldAccess(node) {
      this.fieldLocation(node.field, node.receiver, node.type).load();
    }
    exprObjectCreation(node) {
      const type = node.type,
        constructor = isConstructorSymbol(node.constructor) ? node.constructor : null;
      if (type.typeKind === TypeKind.Delegate) return this.delegateCreation(node);
      if (type.typeKind === TypeKind.TypeParameter) return this.unsupported('creating an instance of a type parameter', node.syntax);
      const hasInitializers = !!(node.initializers?.length || node.collectionInitializers?.length);
      if (!constructor && node.args?.length) this.frameworkConstruction(node);
      else if (!constructor || (constructor.isImplicitlyDeclared && !constructor.parameters.length && !isReference(type))) {
        // A struct without a declared parameterless constructor is created by zero-initialization.
        if (isReference(type)) return this.unsupported(`creating '${type.toDisplayString()}' without a constructor`, node.syntax);
        this.defaultValue(type);
      } else {
        this.arguments(node, constructor);
        this.il.emit('newobj', this.tokens.method(constructor), { pops: constructor.parameters.length, pushes: 1 });
      }
      if (hasInitializers) this.objectInitializers(node);
      return undefined;
    }
    /**
     * `new T(args)` of a framework type whose constructors the symbol table does not list (`new Index(2, true)`):
     * the constructor is named by the types of the arguments as they are passed.
     */
    frameworkConstruction(node) {
      const types = node.args.map(argument => argument.expression.type);
      if (types.some(type => !type)) return this.unsupported(`creating '${node.type.toDisplayString()}' with these arguments`, node.syntax);
      for (const argument of node.args) this.expression(argument.expression);
      const shape = { isStatic: false, returnType: this.core.void, parameters: types.map(type => ({ type })) };
      return this.il.emit('newobj', this.tokens.external(node.type, '.ctor', shape), { pops: types.length, pushes: 1 });
    }
    objectInitializers(node) {
      return this.unsupported('object and collection initializers', node.syntax);
    }
    delegateCreation(node) {
      return this.unsupported('delegate creation', node.syntax);
    }
    /**
     * What an instance constructor runs before its body. A constructor that chains to `this(...)` only makes that
     * call; any other runs the instance initializers and then the base constructor.
     */
    constructorPrologue(constructor) {
      const type = constructor.containingType,
        call = constructor.initializerCall;
      if (call && constructor.thisTarget) return this.chainedConstructorCall(call);
      this.instanceInitializers(type);
      if (!isReference(type)) return undefined;
      if (call) return this.chainedConstructorCall(call);
      return this.implicitBaseCall(type, constructor);
    }
    chainedConstructorCall(call) {
      const target = call.method.containingType;
      if (call.method.isImplicitlyDeclared && !isReference(target)) {
        // `: this()` of a struct without a declared parameterless constructor zero-initializes the value.
        this.il.emit('ldarg', 0).emit('initobj', this.tokens.type(target));
        return;
      }
      this.il.emit('ldarg', 0);
      this.arguments(call, call.method);
      this.il.emit('call', this.tokens.method(call.method), { pops: call.method.parameters.length + 1, pushes: 0 });
    }
    /**
     * `~C() { body }` is `protected override void Finalize() { try { body } finally { base.Finalize(); } }`: the
     * destructors of the base classes run after this one, whatever the body does.
     */
    destructorBody(bound, type) {
      const shape = { isStatic: false, returnType: this.core.void, parameters: [] },
        base = type.baseType ?? this.core.object;
      this.enterBody();
      this.tryRegions(
        () => this.bodyStatements(bound),
        [],
        () => this.il.emit('ldarg', 0).emit('call', this.tokens.external(base, 'Finalize', shape), { pops: 1, pushes: 0 }),
      );
      return this.finish();
    }
    /** `base()`: the accessible parameterless constructor of the base class. */
    implicitBaseCall(type, constructor) {
      const base = type.baseType ?? this.core.object,
        target = base.getMembers('.ctor').find(member => member.methodKind === MethodKind.Constructor && !member.isStatic && !member.parameters.length);
      if (target) {
        this.il.emit('ldarg', 0).emit('call', this.tokens.method(target), { pops: 1, pushes: 0 });
        return undefined;
      }
      if (base.isSource || base.getMembers('.ctor').length) {
        return this.unsupported(`the implicit call of a base constructor of '${base.toDisplayString()}'`, constructor.locations?.[0]);
      }
      // A framework class whose constructors the symbol table does not list (`ExpressionVisitor`): the binder accepted
      // the class as a base, so it has a constructor without parameters.
      const shape = { isStatic: false, returnType: this.core.void, parameters: [] };
      this.il.emit('ldarg', 0).emit('call', this.tokens.external(base, '.ctor', shape), { pops: 1, pushes: 0 });
      return undefined;
    }
    /** Stores every instance field, auto-property and event initializer of the type, in declaration order. */
    instanceInitializers(type) {
      for (const { field, bound } of this.program.initializersOf(type, false)) {
        this.il.emit('ldarg', 0);
        this.expression(bound.expression);
        this.il.emit('stfld', this.tokens.field(field));
      }
    }
    /** The body of a type initializer starts with the static initializers, in declaration order. */
    staticInitializers(type) {
      for (const { field, bound } of this.program.initializersOf(type, true)) {
        this.expression(bound.expression);
        this.il.emit('stsfld', this.tokens.field(field));
      }
    }
  };
