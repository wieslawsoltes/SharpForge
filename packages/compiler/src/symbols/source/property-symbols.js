/**
 * Property and indexer symbols with their accessors and auto-property backing fields, delegate Invoke
 * methods, primary constructors (with positional record properties) and implicit constructors.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { TypeKind, Accessibility, RefKind, SymbolKind } from '../types.js';
import {
  MethodSymbol,
  FieldSymbol,
  PropertySymbol,
  ParameterSymbol,
  MethodKind,
  DeclarationModifiers,
  accessibilityFromSyntax,
} from '../members.js';
import { bindConstraintClauses } from './type-parameters.js';
import { words } from './source-type.js';
import { spanOf } from './source-type.js';
import { recordContractType } from '../synthesized/record-nullability.js';

/** Class mixin: Property and indexer symbols with their accessors and auto-property backing fields, delegate Invoke */
export const PropertySymbolBuilder = Base =>
  class extends Base {
    property(type, syntax, scope, uri) {
      const m = this.modifiers(type, syntax, uri),
        indexer = syntax.kind === 'IndexerDeclaration',
        name = indexer ? 'this[]' : syntax.identifier.valueText;
      let typeSyntax = syntax.type,
        refKind = RefKind.None;
      if (typeSyntax.kind === 'RefType') {
        refKind = typeSyntax.readOnlyKeyword ? RefKind.RefReadOnly : RefKind.Ref;
        typeSyntax = typeSyntax.type;
      }
      const propertyType = this.bindType(typeSyntax, scope),
        parameters = indexer ? this.parameters(syntax.parameterList, scope, uri, null) : [];
      const accessors = syntax.accessorList?.accessors ?? [],
        bodiless = accessors.every(a => !a.body && !a.expressionBody) && !syntax.expressionBody;
      let flags = m.flags;
      const isAbstractLike = !!(flags & (DeclarationModifiers.Abstract | DeclarationModifiers.Extern));
      if (m.inInterface && !(flags & DeclarationModifiers.Static)) {
        if (bodiless) flags |= DeclarationModifiers.Abstract;
        else if (!(flags & DeclarationModifiers.Sealed)) flags |= DeclarationModifiers.Virtual;
      }
      const isAuto = bodiless && !isAbstractLike && !(flags & DeclarationModifiers.Abstract) && !indexer;
      const accessor = (keyword, a) => {
        const isGet = keyword === 'get',
          own = a ? words(a.modifiers) : [],
          access =
            a && own.some(w => ['public', 'private', 'protected', 'internal'].includes(w))
              ? accessibilityFromSyntax(own, m.access)
              : m.access;
        const method = new MethodSymbol({
          name: (isGet ? 'get_' : 'set_') + (indexer ? 'Item' : name),
          methodKind: isGet ? MethodKind.PropertyGet : MethodKind.PropertySet,
          returnType: isGet ? propertyType : this.core.void,
          parameters: [
            ...parameters.map(
              p =>
                new ParameterSymbol({
                  name: p.name,
                  type: p.typeWithAnnotations,
                  refKind: p.refKind,
                  isParams: p.isParams,
                  syntax: p.syntax,
                }),
            ),
            ...(isGet ? [] : [new ParameterSymbol({ name: 'value', type: propertyType })]),
          ],
          containingSymbol: type,
          declaredAccessibility: access,
          modifiers: flags | (own.includes('readonly') ? DeclarationModifiers.ReadOnly : 0),
          syntax: a ?? syntax,
          locations: a ? [{ uri, ...spanOf(a.keyword) }] : [],
          isInitOnly: keyword === 'init',
        });
        method.scope = scope;
        method.uri = uri;
        method.hasBody = a ? !!(a.body || a.expressionBody) : true;
        method.refKind = isGet ? refKind : RefKind.None;
        method.isAutoAccessor = isAuto;
        if (method.hasBody) this.bodies.push(method);
        return method;
      };
      let getMethod = null,
        setMethod = null;
      if (syntax.expressionBody) getMethod = accessor('get', null);
      for (const a of accessors) {
        const k = a.keyword.text;
        if (k === 'get') {
          // An accessor list next to an expression body is reported once for the member (CS8057, binder/member-bodies.js).
          if (getMethod && !syntax.expressionBody) this.report(uri, a.keyword, DiagnosticId.CS1007);
          else if (getMethod) continue;
          else getMethod = accessor('get', a);
        } else if (k === 'set' || k === 'init') {
          if (setMethod) this.report(uri, a.keyword, DiagnosticId.CS1007);
          else setMethod = accessor(k, a);
        }
      }
      const property = new PropertySymbol({
        name,
        type: propertyType,
        parameters,
        getMethod,
        setMethod,
        refKind,
        containingSymbol: type,
        declaredAccessibility: m.access,
        modifiers: flags,
        locations: [{ uri, ...spanOf(indexer ? syntax.thisKeyword : syntax.identifier) }],
        syntax,
      });
      property.scope = scope;
      property.uri = uri;
      property.isAutoProperty = isAuto;
      property.initializerSyntax = syntax.initializer?.value ?? null;
      property.typeSyntax = typeSyntax;
      if (syntax.explicitInterfaceSpecifier) {
        property.explicitInterfaceSyntax = syntax.explicitInterfaceSpecifier.name;
        property.simpleName = name;
        property.name = syntax.explicitInterfaceSpecifier.name.toString().replace(/\s+/g, '') + '.' + name;
        property.declaredAccessibility = Accessibility.Private;
        for (const a of [getMethod, setMethod])
          if (a) {
            a.declaredAccessibility = Accessibility.Private;
            a.name = property.name.replace(/[^.]+$/, '') + a.name;
          }
      }
      if (isAuto) {
        const backing = new FieldSymbol({
          name: `<${name}>k__BackingField`,
          type: propertyType,
          containingSymbol: type,
          declaredAccessibility: Accessibility.Private,
          modifiers: (flags & DeclarationModifiers.Static) | (setMethod && !setMethod.isInitOnly ? 0 : DeclarationModifiers.ReadOnly),
          associatedSymbol: property,
          isImplicitlyDeclared: true,
        });
        property.backingField = backing;
      }
      if (property.initializerSyntax) this.bodies.push(property);
      return [property];
    }
    delegateMembers(type, syntax, scope, uri, members) {
      if (syntax.constraintClauses?.length)
        bindConstraintClauses(
          [...type.typeParameters],
          syntax.constraintClauses,
          t => this.bindType(t, scope),
          (n, c, a) => this.report(uri, n, c, a),
          { ownerDisplay: type.toDisplayString(), useFeature: (node, feature) => this.host.useFeature?.(uri, node, feature) },
        );
      let returnSyntax = syntax.returnType,
        refKind = RefKind.None;
      if (returnSyntax.kind === 'RefType') {
        refKind = RefKind.Ref;
        returnSyntax = returnSyntax.type;
      }
      const invoke = new MethodSymbol({
        name: 'Invoke',
        methodKind: MethodKind.DelegateInvoke,
        returnType: this.bindType(returnSyntax, scope),
        refKind,
        parameters: this.parameters(syntax.parameterList, scope, uri, null),
        containingSymbol: type,
        declaredAccessibility: Accessibility.Public,
        modifiers: DeclarationModifiers.Virtual,
        syntax,
        isImplicitlyDeclared: true,
      });
      members.push(invoke);
    }
    primaryConstructor(type, syntax, scope, uri, members) {
      const parameters = this.parameters(syntax.parameterList, scope, uri, null);
      const ctor = new MethodSymbol({
        name: '.ctor',
        methodKind: MethodKind.Constructor,
        returnType: this.core.void,
        parameters,
        containingSymbol: type,
        // The primary constructor of an abstract record is protected.
        declaredAccessibility: type.isRecord && type.isAbstract ? Accessibility.Protected : Accessibility.Public,
        modifiers: 0,
        locations: [{ uri, ...spanOf(syntax.identifier) }],
        syntax: syntax.parameterList,
      });
      ctor.isPrimaryConstructor = true;
      ctor.scope = scope;
      ctor.uri = uri;
      ctor.hasBody = false;
      type.primaryConstructor = ctor;
      members.push(ctor);
      const base = syntax.baseList?.types.find(t => t.kind === 'PrimaryConstructorBaseType');
      if (base) ctor.baseArgumentsSyntax = base.argumentList;
      // Bound later for its base arguments and for the default values of its optional parameters.
      if (base || parameters.some(p => p.defaultSyntax)) this.bodies.push(ctor);
      // Positional record parameters become public init-only (record class) or settable (record struct) properties.
      if (type.isRecord)
        for (const p of parameters) {
          if (
            (syntax.members ?? []).some(
              x =>
                (x.kind === 'PropertyDeclaration' || x.kind === 'FieldDeclaration') &&
                (x.identifier?.valueText === p.name || x.declaration?.variables.some(v => v.identifier.valueText === p.name)),
            )
          )
            continue;
          const mk = get => {
            const a = new MethodSymbol({
              name: (get ? 'get_' : 'set_') + p.name,
              methodKind: get ? MethodKind.PropertyGet : MethodKind.PropertySet,
              returnType: get ? p.typeWithAnnotations : this.core.void,
              parameters: get ? [] : [new ParameterSymbol({ name: 'value', type: p.typeWithAnnotations })],
              containingSymbol: type,
              declaredAccessibility: Accessibility.Public,
              modifiers: 0,
              // A record class and a readonly record struct have init-only positional properties.
              isInitOnly: !get && (type.typeKind === TypeKind.Class || type.isReadOnly),
              isImplicitlyDeclared: true,
            });
            a.isAutoAccessor = true;
            return a;
          };
          const property = new PropertySymbol({
            name: p.name,
            type: p.typeWithAnnotations,
            getMethod: mk(true),
            setMethod: mk(false),
            containingSymbol: type,
            declaredAccessibility: Accessibility.Public,
            modifiers: 0,
            locations: p.locations,
            syntax: p.syntax,
            isImplicitlyDeclared: true,
          });
          property.isAutoProperty = true;
          property.isPositional = true;
          // The storage of the property, as for a declared auto-property (it is not a member of its own).
          property.backingField = new FieldSymbol({
            name: `<${p.name}>k__BackingField`,
            type: p.typeWithAnnotations,
            containingSymbol: type,
            declaredAccessibility: Accessibility.Private,
            modifiers: property.setMethod.isInitOnly ? DeclarationModifiers.ReadOnly : 0,
            associatedSymbol: property,
            isImplicitlyDeclared: true,
          });
          for (const accessor of [property.getMethod, property.setMethod]) accessor.associatedSymbol = property;
          members.push(property);
        }
    }
    implicitConstructors(type, members) {
      if (type.typeKind === TypeKind.Interface || type.typeKind === TypeKind.Enum || type.typeKind === TypeKind.Delegate || type.isStatic)
        return;
      const declared = members.filter(m => m.kind === SymbolKind.Method && m.methodKind === MethodKind.Constructor);
      const needed = type.typeKind === TypeKind.Struct ? !declared.some(c => c.parameters.length === 0) : declared.length === 0;
      if (needed) {
        const ctor = new MethodSymbol({
          name: '.ctor',
          methodKind: MethodKind.Constructor,
          returnType: this.core.void,
          parameters: [],
          containingSymbol: type,
          declaredAccessibility: type.isAbstract && type.typeKind === TypeKind.Class ? Accessibility.Protected : Accessibility.Public,
          modifiers: 0,
          isImplicitlyDeclared: true,
          locations: type.locations,
        });
        ctor.isImplicitConstructor = true;
        members.push(ctor);
      }
      // A constructor a record class declares over its own type is its copy constructor (it need not chain to `this`).
      const takesOwnType = c => c.parameters.length === 1 && (c.parameters[0].type.originalDefinition ?? c.parameters[0].type) === type;
      if (type.isRecord && type.typeKind === TypeKind.Class) for (const c of declared) if (takesOwnType(c)) c.isCopyConstructor = true;
      // Records get a copy constructor so `with` and derived records can clone.
      if (
        type.isRecord &&
        type.typeKind === TypeKind.Class &&
        !declared.some(c => c.parameters.length === 1 && (c.parameters[0].type.originalDefinition ?? c.parameters[0].type) === type)
      ) {
        const self = type.typeParameters?.length ? type.construct(type.typeParameters) : type;
        const copy = new MethodSymbol({
          name: '.ctor',
          methodKind: MethodKind.Constructor,
          returnType: this.core.void,
          parameters: [new ParameterSymbol({ name: 'original', type: recordContractType(type, self) })],
          containingSymbol: type,
          declaredAccessibility: type.isSealed ? Accessibility.Private : Accessibility.Protected,
          modifiers: 0,
          isImplicitlyDeclared: true,
        });
        copy.isCopyConstructor = true;
        members.push(copy);
      }
    }
  };
