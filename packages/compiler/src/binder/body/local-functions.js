/**
 * Local functions: declared up front in their block (callable before the declaration), generic, with
 * their own body binder chained to the enclosing one.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, RefKind, ErrorTypeSymbol } from '../../symbols/types.js';
import { MethodSymbol, MethodKind, ParameterSymbol, modifiersFromSyntax } from '../../symbols/members.js';
import { declareTypeParameters, bindConstraintClauses } from '../../symbols/source/type-parameters.js';
import { fullNameOf } from '../bound-attributes.js';
import { moduleInitializerAttribute } from '../csharp9.js';

const unknown = ErrorTypeSymbol.unknown;
const stmt = (kind, syntax, completes, props) => ({ kind, syntax, completes, ...props });

/** Class mixin: Local functions: declared up front in their block (callable before the declaration), generic, with */
export const LocalFunctionBinding = Base =>
  class extends Base {
    // ---- local functions ----
    declareLocalFunction(syntax) {
      const name = syntax.identifier.valueText,
        modifiers = syntax.modifiers.map(m => m.text);
      if (syntax.body && syntax.expressionBody) this.report(syntax, DiagnosticId.CS8057);
      const method = new MethodSymbol({
        name,
        methodKind: MethodKind.LocalFunction,
        containingSymbol: this.c.method ?? this.c.containingType,
        modifiers: modifiersFromSyntax(modifiers),
        syntax,
        locations: [{ uri: this.c.uri, start: syntax.identifier.span.start, end: syntax.identifier.span.end }],
        typeParameters: [],
      });
      const typeParameters = declareTypeParameters(syntax.typeParameterList, method, this.c.uri, (n, c, a) => this.report(n, c, a));
      method.typeParameters = Object.freeze(typeParameters);
      const scope = typeParameters.length ? this.typeScope.child('typeParameters', { parameters: typeParameters }) : this.typeScope;
      method.scope = scope;
      method.uses = 0;
      let returnSyntax = syntax.returnType;
      if (returnSyntax.kind === 'RefType') {
        method.refKind = returnSyntax.readOnlyKeyword ? RefKind.RefReadOnly : RefKind.Ref;
        returnSyntax = returnSyntax.type;
      }
      method.returnTypeWithAnnotations = this.d.typeBinder.bindType(returnSyntax, scope);
      const seen = new Set(),
        parameters = syntax.parameterList.parameters.map((p, ordinal) => {
          const mods = p.modifiers.map(m => m.text),
            pname = p.identifier.valueText;
          if (seen.has(pname)) this.report(p.identifier, DiagnosticId.CS0100, [pname]);
          seen.add(pname);
          const parameter = new ParameterSymbol({
            name: pname,
            type: p.type ? this.d.typeBinder.bindType(p.type, scope) : unknown,
            ordinal,
            refKind: mods.includes('out')
              ? RefKind.Out
              : mods.includes('ref')
                ? RefKind.Ref
                : mods.includes('in')
                  ? RefKind.In
                  : RefKind.None,
            isParams: mods.includes('params'),
            isThis: mods.includes('this'),
            ...(p.default ? { explicitDefaultValue: { value: undefined } } : {}),
            syntax: p,
            locations: [{ uri: this.c.uri, start: p.identifier.span.start, end: p.identifier.span.end }],
          });
          parameter.defaultSyntax = p.default?.value ?? null;
          return parameter;
        });
      method.parameters = Object.freeze(
        parameters.map((p, i) => {
          p.ordinal = i;
          p.containingSymbol = method;
          return p;
        }),
      );
      if (syntax.constraintClauses?.length)
        bindConstraintClauses(
          typeParameters,
          syntax.constraintClauses,
          t => this.d.typeBinder.bindType(t, scope).type,
          (n, c, a) => this.report(n, c, a),
          { ownerDisplay: name, useFeature: (node, feature) => this.d.gate(this.c.uri, node, feature) },
        );
      this.checkLocalFunctionAttributes(syntax, scope);
      this.declare(name, method, syntax.identifier);
      this.localFunctions.push(method);
      (this.rootBinder.allLocalFunctions ??= []).push({ method, uri: this.c.uri });
      return method;
    }
    /** `[ModuleInitializer]` marks an ordinary method only: on a local function it is CS8813, at the attribute name. */
    checkLocalFunctionAttributes(syntax, scope) {
      for (const list of syntax.attributeLists ?? [])
        for (const attribute of list.attributes ?? []) {
          const written = attribute.name.toString().trim().split('.').pop();
          if (written !== 'ModuleInitializer' && written !== 'ModuleInitializerAttribute') continue;
          const attributeClass = this.d.attributeClassOf(attribute.name, scope, this.c.uri);
          if (attributeClass && fullNameOf(attributeClass) === moduleInitializerAttribute) this.report(attribute.name, DiagnosticId.CS8813);
        }
    }
    localFunction(syntax) {
      const method = this.scopes.flatMap(s => [...s.values()]).find(s => s.kind === SymbolKind.Method && s.syntax === syntax);
      if (!method) return stmt('LocalFunction', syntax, true, {});
      const isStatic = method.isStatic,
        isAsync = method.isAsync;
      for (const p of method.parameters) if (p.defaultSyntax) this.d.bindParameterDefault(p, this);
      method.body = this.d.bindMethodBody(method, {
        uri: this.c.uri,
        scope: method.scope,
        containingType: this.c.containingType,
        isStatic: this.c.isStatic,
        parent: this,
        staticFunction: isStatic ? 'localFunction' : null,
        isLocalFunction: true,
        isFieldInitializer: false,
        isStaticInitializer: this.c.isStaticInitializer,
        quiet: this.quiet,
        isTopLevel: false,
      });
      return stmt('LocalFunction', syntax, true, { method });
    }
  };
