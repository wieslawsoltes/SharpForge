/**
 * Binding of bodies: methods, accessors, constructors with their initializers, field and property
 * initializers and top-level statements, followed by the flow passes over each bound body.
 */
import { SymbolKind, TypeKind, RefKind, Accessibility, NamedTypeSymbol } from '../symbols/types.js';
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
import { isSourceSymbol, isClosedType, containsAwait } from './analysis-helpers.js';

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
        )
          this.report(context.uri, method.locations[0], 'CS1983');
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
          if (!v.hasErrors && !binder.isStatementExpression(expression)) binder.report(expression, 'CS0201');
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
            'CS0161',
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
            this.bindConstructorInitializer(
              member,
              type,
              new BodyBinder(this, this.context(member, type, { parameters: member.parameters })),
            );
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
            if (member.type && !member.type.isErrorType() && !member.type.elementType) binder.report(init, 'CS0622');
          } else {
            const raw = binder.value(init);
            value = member.type ? binder.convert(raw, member.type, init) : raw;
            if (raw.form === 'lambda' && !value.hasErrors) binder.finishLambda(raw, member.type);
          }
          if (member.kind === SymbolKind.Field) {
            member.writes = (member.writes ?? 0) + 1;
            if (!(value.constantValue || value.literal || value.kind === 'Default')) member.nonConstantWrite = true;
          }
          if (member.kind === SymbolKind.Property && !member.isAutoProperty) this.reportAt(member, 'CS8050');
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
          this.report(this.at(d.ctor).uri, d.ctor.initializerSyntax?.thisOrBaseKeyword ?? this.at(d.ctor), d.code, d.args);
      }
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
        binder.report(init.thisOrBaseKeyword, 'CS0522', [ctor.toDisplayString()]);
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
        binder.report(binder.errorNode(e, args, at), e.code, e.code === 'CS1729' ? [target.toDisplayString(), args.length] : e.args);
        return;
      }
      const call = binder.finishCall(r, null, args, init ?? argList, {});
      if (isThis) ctor.thisTarget = r.method.originalDefinition ?? r.method;
      else ctor.baseTarget = r.method;
      this.bound.set({ kind: 'ConstructorInitializer', ctor }, call);
      ctor.initializerCall = call;
    }
    /** Top-level statements are the body of the synthesized `<Main>$`; top-level methods become its local functions. */
    bindTopLevel() {
      const byFile = new Map();
      for (const item of this.assembly.topLevel) {
        if (!byFile.has(item.file)) byFile.set(item.file, []);
        byFile.get(item.file).push(item);
      }
      for (const [file, items] of byFile) {
        const statements = items.filter(i => i.statement).map(i => i.statement);
        if (!statements.length) continue;
        const scope = items[0].scope,
          uri = file.source.uri,
          usesAwait = statements.some(s => containsAwait(s));
        const program = (this.programType ??= Object.assign(
          new NamedTypeSymbol({
            name: 'Program',
            typeKind: TypeKind.Class,
            containingSymbol: this.assembly.globalNamespace,
            declaredAccessibility: Accessibility.Internal,
            baseType: () => this.core.object,
            isImplicitlyDeclared: true,
          }),
          { isSource: true },
        ));
        const binder = new BodyBinder(this, {
          uri,
          scope,
          containingType: program,
          method: null,
          isStatic: true,
          isFieldInitializer: false,
          isTopLevel: true,
          isAsync: usesAwait,
          returnType: null,
          parameters: [
            {
              name: 'args',
              kind: SymbolKind.Parameter,
              type: this.core.arrayOf(this.core.string),
              refKind: RefKind.None,
              isImplicitlyDeclared: true,
            },
          ],
        });
        const body = binder.block({ statements, span: file.syntax.span, kind: 'Block' }, { statements });
        body.locals = binder.locals;
        body.binder = binder;
        this.bound.set(file, body);
        for (const d of analyzeDefiniteAssignment(null, body, {
          core: this.core,
          languageVersion: this.versionOf(uri).number,
          containingType: null,
        }))
          this.report(uri, d.node, d.code, d.args);
        for (const d of analyzeRefSafety(null, body)) this.report(uri, d.node, d.code, d.args);
        if (this.nullableMaps.get(uri)?.anyWarnings ?? this.nullableAt(uri, 0).warnings)
          for (const d of new NullableWalker(this, uri).analyze(null, body)) this.report(uri, d.node, d.code, d.args, 'warning');
      }
    }
  };
