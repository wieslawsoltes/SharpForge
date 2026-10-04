import {sourceThis} from './source-type-shape.js';
/**
 * Initialization order (SF-A02-T10): field and auto-property initializers, constructor chaining and type
 * initialization, in the order .NET runs them.
 *
 *   instance initializers   run inside the constructor that does not chain to `this(...)`, after its arguments
 *                           were evaluated and before its body; a class without constructors gets one
 *   static initializers     run on the first access to a static field of the class (a class with a static
 *                           constructor is initialized on the first access to any static member or construction)
 */
import { SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { analyzeCaptures } from '../../lowering/closures.js';
import { BodyTranslator } from './body-translator.js';
import { Frame } from './frame.js';
import { n } from './node-factory.js';

/** Class mixin: initializer methods and the points that run them. */
export const Initialization = Base =>
  class extends Base {
    /** The initialized members of a class with their bound initializers, in declaration order. */
    initializersOf(type, isStatic) {
      const list = [];
      for (const member of type.getMembers()) {
        if (member.kind !== SymbolKind.Field && member.kind !== SymbolKind.Property && member.kind !== SymbolKind.Event) continue;
        if (!!member.isStatic !== isStatic || member.isConst) continue;
        const bound = this.analysis.bound.get(member);
        if (!bound) continue;
        const record = member.kind === SymbolKind.Field ? this.fields.get(member) : (this.autoProperties.get(member) ?? this.eventFields.get(member));
        if (record) list.push({ member, record, bound });
      }
      return list;
    }
    /** Statements that store each initializer into its field; each initializer is its own scope. */
    initializerBlock(initializers, frame, parameters = []) {
      const statements = [];
      for (const { member, record, bound } of initializers) {
        const captures = analyzeCaptures(bound.expression);
        const own = new Frame({ uri: this.uriOf(member), method: frame.method, thisExpr: frame.thisExpr, captures, root: frame.root });
        const translator = new BodyTranslator(this, own);
        // The parameters of a primary constructor are in scope in every instance initializer.
        const entry = translator.declareParameters(parameters);
        const target = record.isStatic ? n.staticField(record) : n.field(frame.thisExpr(), record);
        const store = n.expressionStatement(n.assign(target, translator.expression(bound.expression)), n.spanOf(bound.syntax, own.uri));
        statements.push(n.block([...entry, translator.withPending(store)], translator.scopes[0]));
      }
      return n.block(statements);
    }
    /**
     * Declares every initializer method, then builds their bodies: an initializer may create an object of, or read a
     * static of, any other class, so all of them must be known before the first body is lowered.
     */
    declareInitializers() {
      const instanceWork = this.declareInstanceInitializers(),
        typeWork = this.declareTypeInitializers();
      this.buildTypeInitializers(typeWork);
      this.buildInstanceInitializers(instanceWork);
    }
    /** Declares `<init>` for every class with instance initializers, and a constructor for those that have none. */
    declareInstanceInitializers() {
      const work = [];
      for (const [type, owner] of this.classes) {
        const item = this.declareInstanceInitializer(type, owner);
        if (item) work.push(item);
      }
      return work;
    }
    /** The `<init>` of one class (and its constructor when it declares none), or null when it has no initializers. */
    declareInstanceInitializer(type, owner) {
      const initializers = this.initializersOf(type, false);
      if (!initializers.length) return null;
      // The initializers of a type with a primary constructor run with its parameters in scope.
      const parameters = type.primaryConstructor ? this.parametersOf(type.primaryConstructor) : [];
      const method = this.program.addMethod(owner, '<init>', { isStatic: false, returnType: 'void', parameters, node: owner.node });
      this.instanceInits.set(type, method);
      const constructors = type.getMembers('.ctor').filter(c => c.methodKind === MethodKind.Constructor && !c.isImplicitlyDeclared);
      if (!constructors.length) {
        const implicit = this.program.addMethod(owner, '.ctor', { isStatic: false, returnType: 'void', parameters: [], node: owner.node });
        this.implicitConstructors.set(type, implicit);
        this.bodies.push({ method: implicit, body: n.block([n.expressionStatement(n.call(method, sourceThis(owner), []))]) });
      }
      return { type, method, initializers };
    }
    buildInstanceInitializers(work) {
      for (const { type, method, initializers } of work) {
        const frame = this.memberFrame(method, { name: '.ctor' }, this.uriOf(type), null);
        this.bodies.push({ method, body: this.initializerBlock(initializers, frame, type.primaryConstructor?.parameters ?? []) });
        this.drain();
      }
    }
    /** Declares the lazy type initializer of every class with static initializers or a static constructor. */
    declareTypeInitializers() {
      const work = [];
      for (const [type, owner] of this.classes) {
        const item = this.declareTypeInitializer(type, owner);
        if (item) work.push(item);
      }
      return work;
    }
    /** The lazy type initializer of one class, or null when it has neither static initializers nor a static constructor. */
    declareTypeInitializer(type, owner) {
      const initializers = this.initializersOf(type, true),
        constructor = type.getMembers().find(m => m.kind === SymbolKind.Method && m.methodKind === MethodKind.StaticConstructor);
      if (!initializers.length && !constructor) return null;
      const done = this.program.addStatic(owner, '<>initialized', 'bool'),
        ensure = this.program.addMethod(owner, '<EnsureInitialized>', { isStatic: true, returnType: 'void', parameters: [] });
      this.typeInits.set(type, { ensure, precise: !!constructor });
      return { type, done, ensure, initializers, constructor };
    }
    buildTypeInitializers(work) {
      for (const { type, done, ensure, initializers, constructor } of work) {
        const frame = this.memberFrame(ensure, { name: '.cctor' }, this.uriOf(type), null);
        // The flag is set first, so initializers that read the class's own statics see the values assigned so far.
        const statements = [
          n.ifStatement(n.staticField(done), n.returnStatement()),
          n.expressionStatement(n.assign(n.staticField(done), n.literal(true, 'bool'))),
        ];
        // Compared by key: two constructions of one generic class are initialized separately.
        const outer = this.typeInitializing;
        this.typeInitializing = this.generics.keyOf(type);
        if (initializers.length) statements.push(this.initializerBlock(initializers, frame));
        this.typeInitializing = outer;
        if (constructor) statements.push(n.expressionStatement(n.call(this.methodOf(constructor), null, [])));
        this.bodies.push({ method: ensure, body: n.block(statements) });
        this.drain();
      }
    }
    /** The call that initializes the class of a static member before it is used, or null when there is nothing to run. */
    typeInitializerCall(member, { anyMember = false } = {}) {
      const type = member.containingType ?? member.containingSymbol,
        init = type ? this.typeInits.get(type) : null;
      if (!init || this.typeInitializing === this.generics.keyOf(type)) return null;
      if (anyMember && !init.precise) return null;
      return n.call(init.ensure, null, []);
    }
    /** What runs before the body of a constructor or of a static member: `prologue(translator) -> statements`. */
    prologueOf(symbol, frame) {
      const type = symbol.containingType ?? symbol.containingSymbol,
        isConstructor = symbol.methodKind === MethodKind.Constructor,
        steps = [];
      if ((symbol.isStatic || isConstructor) && symbol.methodKind !== MethodKind.StaticConstructor) {
        const ensure = this.typeInitializerCall(symbol, { anyMember: true });
        if (ensure) steps.push(() => n.expressionStatement(ensure));
      }
      if (isConstructor) {
        const call = symbol.initializerCall;
        if (call && symbol.thisTarget) {
          const target = this.methodOf(call.method, call.syntax);
          steps.push(translator => n.expressionStatement(n.call(target, frame.thisExpr(), translator.arguments(call, call.method))));
        } else {
          if (call) this.unsupported('base constructor calls', symbol.locations?.[0], frame.uri);
          const init = this.instanceInits.get(type);
          if (init) steps.push(() => n.expressionStatement(n.call(init, frame.thisExpr(), [])));
        }
      }
      return steps.length ? translator => steps.map(step => step(translator)) : null;
    }
  };
