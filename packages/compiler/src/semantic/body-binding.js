/**
 * Binding of bodies: methods, accessors, constructors with their initializers and field and property
 * initializers, followed by the flow passes over each bound body. Top-level statements are bound in
 * ../binder/top-level.js.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind, ErrorTypeSymbol } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { checkImplicitBaseCall, checkConstructorCycles, constructorInitializerKind } from '../binder/constructors.js';
import { BodyBinder } from '../binder/body-binder.js';
import { isAccessible } from '../binder/accessibility.js';
import { analyzeDefiniteAssignment } from '../flow/semantic-assignment.js';
import { analyzeRefSafety } from '../flow/ref-safety.js';
import { NullableWalker } from '../nullable/walker.js';
import { checkIteratorBody } from '../binder/iterators.js';
import { checkAsyncBody } from '../binder/async.js';
import { asyncResultType } from '../binder/csharp70.js';
import { isSourceSymbol, isClosedType } from './analysis-helpers.js';

/** Class mixin: Binding of bodies: methods, accessors, constructors with their initializers, field and property */
export const BodyBinding = Base =>
  class extends Base {
    context(member, type, extra = {}) {
      return {
        uri: member.uri ?? this.at(member)?.uri,
        scope: member.scope ?? type.primaryScope,
        containingType: type,
        method: member.kind === SymbolKind.Method ? member : null,
        isStatic: member.isStatic,
        isFieldInitializer: false,
        ...extra,
      };
    }
    /**
     * Binds the default values of a method's optional parameters where they are declared, once. Bodies bind their
     * own; this is for a method whose defaults are needed earlier (the natural type of a method group, a lambda
     * compared with its target delegate) and for one without a body (the `Invoke` method of a delegate).
     */
    ensureParameterDefaults(method) {
      const unbound = (method?.parameters ?? []).filter(parameter => parameter.defaultSyntax && !parameter.defaultBound);
      if (!unbound.length) return;
      const type = method.containingType,
        uri = method.uri ?? method.locations?.[0]?.uri ?? this.at(type).uri,
        binder = new BodyBinder(this, this.context(method, type, { uri, parameters: method.parameters }));
      for (const parameter of unbound) this.bindParameterDefault(parameter, binder);
    }
    /** Binds the body of a method-like symbol and runs the flow passes over it. */
    bindMethodBody(method, context) {
      const syntax = method.syntax,
        isAsync = method.isAsync,
        declared = method.returnType;
      let returnType = declared;
      if (isAsync && declared) {
        const taskResult = asyncResultType(declared, this.core);
        if (taskResult) returnType = taskResult;
        else if (
          declared.specialType !== 'System_Void' &&
          !declared.isErrorType() &&
          !['IAsyncEnumerable', 'IAsyncEnumerator'].includes(declared.name) &&
          isClosedType(declared)
        ) {
          this.report(context.uri, method.locations[0], DiagnosticId.CS1983);
          // What the body returns is not checked against a type that cannot be the result of an async method.
          returnType = ErrorTypeSymbol.unknown;
        }
      }
      const binder = new BodyBinder(this, {
        ...context,
        method,
        returnType,
        declaredReturnType: declared,
        returnRefKind: method.refKind ?? RefKind.None,
        isAsync,
        isIterator: false,
        parameters: method.parameters,
      });
      for (const p of method.parameters) if (p.defaultSyntax) this.bindParameterDefault(p, binder);
      // The optional parameters of an indexer belong to the property; its accessors bind them.
      for (const p of method.associatedSymbol?.parameters ?? []) if (p.defaultSyntax) this.bindParameterDefault(p, binder);
      let body = null;
      if (syntax.body ?? syntax.block) body = binder.block(syntax.body ?? syntax.block);
      else if (syntax.expressionBody) {
        const expression = syntax.expressionBody.expression,
          e = binder.expression(expression);
        if (
          !returnType ||
          returnType.specialType === 'System_Void' ||
          method.isConstructor ||
          method.methodKind === MethodKind.PropertySet ||
          method.methodKind === MethodKind.Destructor
        ) {
          const v = e.kind === 'TypeExpression' || e.kind === 'NamespaceExpression' ? binder.asValue(e) : e;
          if (!v.hasErrors && !binder.isStatementExpression(expression)) binder.report(expression, DiagnosticId.CS0201);
          body = { kind: 'ExpressionBody', syntax: expression, completes: true, expression: v };
        } else {
          const v = binder.asValue(e),
            converted = binder.convert(v, returnType, expression);
          if (v.form === 'lambda' && !converted.hasErrors) binder.finishLambda(v, returnType);
          body = { kind: 'ExpressionBody', syntax: expression, completes: false, expression: converted, isReturn: true };
        }
      }
      if (body) {
        const needsValue = returnType && returnType.specialType !== 'System_Void' && !returnType.isErrorType?.() && !method.isConstructor;
        if (
          body.completes &&
          needsValue &&
          !binder.isIterator &&
          !binder.c.isIterator &&
          !binder.usesGoto &&
          !binder.hasLabelsAnywhere &&
          body.kind === 'Block'
        )
          this.report(
            context.uri,
            method.methodKind === MethodKind.PropertyGet && method.syntax.keyword ? method.syntax.keyword : (method.locations[0] ?? syntax),
            DiagnosticId.CS0161,
            [
              method.methodKind === MethodKind.PropertyGet && method.associatedSymbol
                ? method.associatedSymbol.toDisplayString() + '.get'
                : method.toDisplayString(),
            ],
          );
        body.locals = binder.locals;
        body.binder = binder;
        this.bound.set(method, body);
        checkIteratorBody(method, body, (node, code, args) => this.report(context.uri, node, code, args));
        checkAsyncBody(method, body, (node, code, args) => this.report(context.uri, node, code, args));
        if (!context.parent) {
          for (const d of analyzeDefiniteAssignment(method, body, {
            core: this.core,
            languageVersion: this.versionOf(context.uri).number,
            containingType: context.containingType,
          }))
            this.report(context.uri, d.node, d.code, d.args);
          for (const d of analyzeRefSafety(method, body)) this.report(context.uri, d.node, d.code, d.args);
          if (this.nullableMaps.get(context.uri)?.anyWarnings ?? this.nullableAt(context.uri, 0).warnings)
            for (const d of new NullableWalker(this, context.uri).analyze(method, body))
              this.report(context.uri, d.node, d.code, d.args, 'warning');
        }
      }
      return body;
    }
    bindBodies() {
      for (const member of this.assembly.bodies) {
        const type = member.containingType;
        if (!type) continue;
        if (member.kind === SymbolKind.Method) {
          if (member.isPrimaryConstructor) {
            const binder = new BodyBinder(this, this.context(member, type, { parameters: member.parameters }));
            // A primary constructor has no body, so its optional parameters are bound here (`record R(int X = 1)`).
            for (const p of member.parameters) if (p.defaultSyntax) this.bindParameterDefault(p, binder);
            if (member.baseArgumentsSyntax) this.bindConstructorInitializer(member, type, binder);
            continue;
          }
          const context = this.context(member, type);
          if (member.methodKind === MethodKind.Constructor && member.initializerSyntax) {
            const binder = new BodyBinder(this, { ...context, parameters: member.parameters, isConstructorInitializer: true });
            this.bindConstructorInitializer(member, type, binder);
            context.outerLocals = binder.scopes[0];
          }
          this.bindMethodBody(member, context);
        } else {
          // Field, auto-property and field-like event initializers.
          const binder = new BodyBinder(this, {
            uri: member.uri,
            scope: member.scope,
            containingType: type,
            method: null,
            initializerOf: member,
            isStatic: member.isStatic,
            isFieldInitializer: true,
            isStaticInitializer: member.isStatic,
            parameters: type.primaryConstructor && !member.isStatic ? type.primaryConstructor.parameters : [],
          });
          const init = member.initializerSyntax;
          let value;
          if (init.kind === 'ArrayInitializerExpression') {
            value = member.type?.elementType
              ? {
                  kind: 'ArrayCreation',
                  syntax: init,
                  type: member.type,
                  elements: binder.arrayInitializer(init, member.type.elementType, member.type.rank),
                }
              : binder.bad(init);
            if (member.type && !member.type.isErrorType() && !member.type.elementType) binder.report(init, DiagnosticId.CS0622);
          } else {
            const raw = binder.value(init);
            value = member.type ? binder.convert(raw, member.type, init) : raw;
            if (raw.form === 'lambda' && !value.hasErrors) binder.finishLambda(raw, member.type);
          }
          if (member.kind === SymbolKind.Field) {
            member.writes = (member.writes ?? 0) + 1;
            if (!(value.constantValue || value.literal || value.kind === 'Default')) member.nonConstantWrite = true;
          }
          // An interface property with an initializer has a diagnostic of its own (CS8053, binder/member-bodies.js).
          if (member.kind === SymbolKind.Property && !member.isAutoProperty && type.typeKind !== TypeKind.Interface) this.reportAt(member, DiagnosticId.CS8050);
          this.bound.set(member, { kind: 'Initializer', syntax: init, expression: value, binder });
        }
      }
      // Constructors without an initializer call base() implicitly: the base needs an accessible parameterless constructor.
      for (const type of this.assembly.types) {
        if (type.typeKind !== TypeKind.Class || type.isStatic || type.hasCircularBase) continue;
        const ctors = type.getMembers('.ctor').filter(c => c.methodKind === MethodKind.Constructor);
        for (const ctor of ctors) {
          if (
            ctor.isCopyConstructor ||
            constructorInitializerKind(ctor, type) !== 'implicitBase' ||
            (ctor.isPrimaryConstructor && ctor.baseArgumentsSyntax)
          )
            continue;
          const problem = checkImplicitBaseCall(type, this.overloads);
          if (problem) {
            this.reportAt(ctor.isImplicitlyDeclared ? type : ctor, problem.code, problem.args);
            break;
          }
        }
        for (const d of checkConstructorCycles(type, c => c.thisTarget ?? null))
        {
          // A constructor that calls itself is reported at `this`, a longer cycle at the whole initializer.
          const initializer = d.ctor.initializerSyntax,
            at = (d.code === DiagnosticId.CS0768 ? initializer : initializer?.thisOrBaseKeyword) ?? this.at(d.ctor);
          this.report(this.at(d.ctor).uri, at, d.code, d.args);
        }
      }
      for (const type of this.assembly.types) if (type.typeKind === TypeKind.Delegate) this.ensureParameterDefaults(type.delegateInvokeMethod);
      this.bindTopLevel();
    }
    bindConstructorInitializer(ctor, type, binder) {
      const init = ctor.initializerSyntax,
        isThis = init?.kind === 'ThisConstructorInitializer',
        argList = init?.argumentList ?? ctor.baseArgumentsSyntax;
      const savedStatic = binder.c.isStatic;
      binder.c.isStatic = true;
      binder.c.isConstructorArguments = true; // arguments cannot use `this`
      const args = binder.arguments(argList);
      binder.c.isStatic = savedStatic;
      const target = isThis ? type : type.baseType;
      if (!target || target.isErrorType?.()) return;
      if (type.typeKind === TypeKind.Struct && !isThis && init) {
        binder.report(init.thisOrBaseKeyword, DiagnosticId.CS0522, [ctor.toDisplayString()]);
        return;
      }
      const all = target.getMembers('.ctor').filter(c => c.methodKind === MethodKind.Constructor && !c.isCopyConstructor),
        accessible = all.filter(c =>
          isAccessible(c.originalDefinition ?? c, type.originalDefinition, { throughType: type.originalDefinition }),
        );
      if (!all.length) {
        this.incomplete = true;
        return;
      }
      const r = this.overloads.resolve(accessible, args, { isConstructor: true });
      const at = init?.thisOrBaseKeyword ?? argList;
      if (!r.succeeded) {
        if (args.some(a => a.hasErrors)) return;
        if (!isSourceSymbol(target)) {
          this.incomplete = true;
          return;
        }
        const e = r.error;
        // Several constructors fit a dynamic argument: the choice would be made at run time, which an initializer cannot do.
        if (e.code === DiagnosticId.CS0121 && args.some(a => a.type?.typeKind === TypeKind.Dynamic)) binder.report(at, DiagnosticId.CS1975);
        else binder.report(binder.errorNode(e, args, at), e.code, e.code === DiagnosticId.CS1729 ? [target.toDisplayString(), args.length] : e.args);
        return;
      }
      const call = binder.finishCall(r, null, args, init ?? argList, {});
      if (isThis) ctor.thisTarget = r.method.originalDefinition ?? r.method;
      else ctor.baseTarget = r.method;
      this.bound.set({ kind: 'ConstructorInitializer', ctor }, call);
      ctor.initializerCall = call;
    }
  };
