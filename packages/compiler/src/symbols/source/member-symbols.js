/**
 * Member symbols of source types: fields, events, methods, constructors, destructors, operators and
 * conversions, with their parameters, type parameters and constraint clauses.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { TypeKind, Accessibility, RefKind, TypeWithAnnotations } from '../types.js';
import {
  MethodSymbol,
  FieldSymbol,
  EventSymbol,
  ParameterSymbol,
  MethodKind,
  DeclarationModifiers,
  modifiersFromSyntax,
  accessibilityFromSyntax,
} from '../members.js';
import { declareTypeParameters, bindConstraintClauses } from './type-parameters.js';
import { binaryOperatorNames, unaryOperatorNames } from '../../overload/operators.js';
import { isTypeDeclaration, words, twa } from './source-type.js';
import { spanOf } from './source-type.js';

/** Class mixin: Member symbols of source types: fields, events, methods, constructors, destructors, operators and */
export const MemberSymbolBuilder = Base =>
  class extends Base {
    modifiers(type, syntax, uri) {
      const list = words(syntax.modifiers ?? []);
      let flags = modifiersFromSyntax(list);
      const inInterface = type.typeKind === TypeKind.Interface;
      return {
        list,
        flags,
        access: accessibilityFromSyntax(list, inInterface ? Accessibility.Public : Accessibility.Private),
        inInterface,
      };
    }
    parameters(list, scope, uri, owner) {
      const seen = new Set();
      return (list?.parameters ?? []).map((p, ordinal) => {
        const mods = words(p.modifiers),
          name = p.identifier.valueText;
        if (seen.has(name) && name) this.report(uri, p.identifier, DiagnosticId.CS0100, [name]);
        seen.add(name);
        const refKind = mods.includes('out')
          ? RefKind.Out
          : mods.includes('ref')
            ? mods.includes('readonly')
              ? RefKind.RefReadOnlyParameter
              : RefKind.Ref
            : mods.includes('in')
              ? RefKind.In
              : RefKind.None;
        const type = p.type ? this.bindType(p.type, scope) : twa(this.core.object);
        const parameter = new ParameterSymbol({
          name,
          type,
          ordinal,
          refKind,
          isParams: mods.includes('params'),
          isThis: mods.includes('this'),
          scoped: mods.includes('scoped') ? 'scoped' : null,
          ...(p.default ? { explicitDefaultValue: { value: undefined } } : {}),
          locations: [{ uri, ...spanOf(p.identifier) }],
          syntax: p,
        });
        parameter.defaultSyntax = p.default?.value ?? null;
        parameter.scope = scope;
        return parameter;
      });
    }
    method(
      type,
      syntax,
      scope,
      uri,
      { name, kind = MethodKind.Ordinary, returnTypeSyntax = null, extraFlags = 0, parameterList = syntax.parameterList, access = null },
    ) {
      const m = this.modifiers(type, syntax, uri);
      let flags = m.flags | extraFlags;
      const hasBody = !!(syntax.body || syntax.expressionBody);
      // Interface members without a body are abstract; with one (C# 8) they are virtual unless sealed, static or private.
      if (
        m.inInterface &&
        kind !== MethodKind.Constructor &&
        kind !== MethodKind.StaticConstructor &&
        !(flags & DeclarationModifiers.Static)
      ) {
        if (!hasBody && !(flags & DeclarationModifiers.Extern)) flags |= DeclarationModifiers.Abstract;
        else if (!(flags & DeclarationModifiers.Sealed) && m.access !== Accessibility.Private) flags |= DeclarationModifiers.Virtual;
      }
      const method = new MethodSymbol({
        name,
        methodKind: kind,
        containingSymbol: type,
        declaredAccessibility: access ?? m.access,
        modifiers: flags,
        locations: [{ uri, ...spanOf(syntax.identifier ?? syntax.operatorToken ?? syntax.type ?? syntax.keyword ?? syntax) }],
        syntax,
        typeParameters: [],
      });
      const typeParameters = declareTypeParameters(syntax.typeParameterList, method, uri, (n, c, a) => this.report(uri, n, c, a));
      method.typeParameters = Object.freeze(typeParameters);
      const mscope = typeParameters.length ? scope.child('typeParameters', { parameters: typeParameters }) : scope;
      method.scope = mscope;
      method.uri = uri;
      method.hasBody = hasBody;
      method.modifierWords = m.list;
      // Constraints first: `T?` in the signature is Nullable<T> only when T is known to be a value type.
      if (syntax.constraintClauses?.length) {
        if (flags & DeclarationModifiers.Override || syntax.explicitInterfaceSpecifier) method.inheritsConstraints = true;
        bindConstraintClauses(
          typeParameters,
          syntax.constraintClauses,
          t => this.bindType(t, mscope).type,
          (n, c, a) => this.report(uri, n, c, a),
          { ownerDisplay: name, useFeature: (node, feature) => this.host.useFeature?.(uri, node, feature) },
        );
      } else if (typeParameters.length && (flags & DeclarationModifiers.Override || syntax.explicitInterfaceSpecifier))
        method.inheritsConstraints = true;
      let returnSyntax = returnTypeSyntax;
      if (returnSyntax?.kind === 'RefType') {
        method.refKind = returnSyntax.readOnlyKeyword ? RefKind.RefReadOnly : RefKind.Ref;
        returnSyntax = returnSyntax.type;
      }
      method.returnTypeWithAnnotations = returnSyntax ? this.bindType(returnSyntax, mscope) : twa(this.core.void);
      method.returnTypeSyntax = returnSyntax;
      const parameters = this.parameters(parameterList, mscope, uri, method);
      method.parameters = Object.freeze(
        parameters.map((p, i) => {
          p.ordinal = i;
          p.containingSymbol = method;
          return p;
        }),
      );
      method.isExtensionMethod = parameters[0]?.isThis === true;
      if (syntax.explicitInterfaceSpecifier) {
        method.explicitInterfaceSyntax = syntax.explicitInterfaceSpecifier.name;
        method.simpleName = name;
        method.name = syntax.explicitInterfaceSpecifier.name.toString().replace(/\s+/g, '') + '.' + name;
        method.declaredAccessibility = Accessibility.Private;
      }
      if (hasBody) this.bodies.push(method);
      return method;
    }
    member(type, syntax, scope, uri, members) {
      switch (syntax.kind) {
        case 'FieldDeclaration':
        case 'EventFieldDeclaration': {
          const m = this.modifiers(type, syntax, uri),
            fieldType = this.bindType(syntax.declaration.type, scope);
          for (const v of syntax.declaration.variables) {
            const name = v.identifier.valueText,
              locations = [{ uri, ...spanOf(v.identifier) }];
            if (syntax.kind === 'EventFieldDeclaration') {
              const event = new EventSymbol({
                name,
                type: fieldType,
                containingSymbol: type,
                declaredAccessibility: m.access,
                modifiers: m.flags | (m.inInterface && !(m.flags & DeclarationModifiers.Static) ? DeclarationModifiers.Abstract : 0),
                locations,
                syntax: v,
                isFieldLike: true,
              });
              event.scope = scope;
              event.uri = uri;
              event.initializerSyntax = v.initializer?.value ?? null;
              members.push(event);
              continue;
            }
            const field = new FieldSymbol({
              name,
              type: fieldType,
              containingSymbol: type,
              declaredAccessibility: m.access,
              modifiers: m.flags,
              locations,
              syntax: v,
              ...(m.flags & DeclarationModifiers.Const ? { constantValue: { value: undefined } } : {}),
            });
            field.initializerSyntax = v.initializer?.value ?? null;
            field.scope = scope;
            field.uri = uri;
            field.declarationSyntax = syntax;
            field.typeSyntax = syntax.declaration.type;
            members.push(field);
            if (field.initializerSyntax && !(m.flags & DeclarationModifiers.Const)) this.bodies.push(field);
          }
          return;
        }
        case 'MethodDeclaration':
          members.push(this.method(type, syntax, scope, uri, { name: syntax.identifier.valueText, returnTypeSyntax: syntax.returnType }));
          return;
        case 'ConstructorDeclaration': {
          const isStatic = words(syntax.modifiers).includes('static'),
            ctor = this.method(type, syntax, scope, uri, {
              name: isStatic ? '.cctor' : '.ctor',
              kind: isStatic ? MethodKind.StaticConstructor : MethodKind.Constructor,
            });
          if (syntax.identifier.valueText !== type.name) this.report(uri, syntax.identifier, DiagnosticId.CS1520);
          ctor.initializerSyntax = syntax.initializer ?? null;
          members.push(ctor);
          return;
        }
        case 'DestructorDeclaration':
          members.push(
            this.method(type, syntax, scope, uri, { name: 'Finalize', kind: MethodKind.Destructor, access: Accessibility.Protected }),
          );
          return;
        case 'OperatorDeclaration': {
          const token = syntax.operatorToken.text,
            unary = syntax.parameterList.parameters.length === 1,
            name = ((unary ? unaryOperatorNames[token] : null) ?? binaryOperatorNames[token] ?? 'op_' + token).replace(
              /^op_/,
              syntax.checkedKeyword ? 'op_Checked' : 'op_',
            );
          const op = this.method(type, syntax, scope, uri, {
            name,
            kind: MethodKind.UserDefinedOperator,
            returnTypeSyntax: syntax.returnType,
          });
          op.operatorToken = token;
          members.push(op);
          return;
        }
        case 'ConversionOperatorDeclaration': {
          const implicit = syntax.implicitOrExplicitKeyword.text === 'implicit',
            op = this.method(type, syntax, scope, uri, {
              name: implicit ? 'op_Implicit' : syntax.checkedKeyword ? 'op_CheckedExplicit' : 'op_Explicit',
              kind: MethodKind.Conversion,
              returnTypeSyntax: syntax.type,
            });
          members.push(op);
          return;
        }
        case 'PropertyDeclaration':
        case 'IndexerDeclaration':
          members.push(...this.property(type, syntax, scope, uri));
          return;
        case 'EventDeclaration': {
          const m = this.modifiers(type, syntax, uri),
            event = new EventSymbol({
              name: syntax.identifier.valueText,
              type: this.bindType(syntax.type, scope),
              containingSymbol: type,
              declaredAccessibility: m.access,
              modifiers: m.flags,
              locations: [{ uri, ...spanOf(syntax.identifier) }],
              syntax,
              isFieldLike: false,
            });
          event.scope = scope;
          event.uri = uri;
          members.push(event);
          for (const a of syntax.accessorList?.accessors ?? []) {
            const accessor = new MethodSymbol({
              name: a.keyword.text + '_' + event.name,
              methodKind: a.keyword.text === 'add' ? MethodKind.EventAdd : MethodKind.EventRemove,
              returnType: this.core.void,
              parameters: [new ParameterSymbol({ name: 'value', type: event.typeWithAnnotations })],
              containingSymbol: type,
              declaredAccessibility: m.access,
              modifiers: m.flags,
              syntax: a,
              associatedSymbol: event,
            });
            accessor.scope = scope;
            accessor.uri = uri;
            accessor.hasBody = !!(a.body || a.expressionBody);
            if (accessor.hasBody) this.bodies.push(accessor);
            if (a.keyword.text === 'add') event.addMethod = accessor;
            else event.removeMethod = accessor;
          }
          return;
        }
        case 'IncompleteMember':
          return;
        default:
          if (isTypeDeclaration(syntax)) return;
      }
    }
  };
