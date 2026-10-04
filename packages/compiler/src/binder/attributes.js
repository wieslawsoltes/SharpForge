/**
 * Attributes (SF-A02-T41, C# spec 22): every attribute of a declaration is bound to its class, constructor and
 * arguments and recorded on the symbol as `boundAttributes`.
 *
 *   - Class lookup: `[Name]` finds `Name` and `NameAttribute`; the one that derives from System.Attribute wins
 *     (CS1614 when both do, CS0616 when the name is another type, CS0246 when there is none, CS0653 when abstract).
 *   - Positional arguments go through overload resolution over the accessible constructors; `Name = value` assigns a
 *     public, non-static, writable field or property (CS0617, CS0643), and every argument is a constant, a typeof or an
 *     array of those (CS0182).
 *   - The location (`[return: A]`, `[field: A]`; CS0657, CS0658) and the declaration decide the AttributeTargets value
 *     that must be among the targets the attribute class declares with AttributeUsage (CS0592); a class that does not
 *     allow multiple use is applied once per location (CS0579).
 *   - The attributes the compiler itself interprets are decoded by the full name of the bound class, never by the
 *     name written in source: AttributeUsage (also CS0641), Obsolete, Conditional, Flags and DllImport.
 *
 * Attributes are metadata: nothing is executed for them. Reading them back at run time needs reflection, which the
 * runtime profile does not have.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, Accessibility } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { AttributeTargets } from '../symbols/attribute-types.js';
import { attributeLocations, compilationLocations, describeTargets, knownLocations } from './attribute-targets.js';
import { isAccessible } from './accessibility.js';
import { BodyBinder } from './body-binder.js';
import { isSourceSymbol } from '../semantic/analysis-helpers.js';
import { fullNameOf, attributesNamed } from './bound-attributes.js';
import { importedAttributeUsage, isImportedType } from '../metadata-import/imported-attribute-usage.js';
import { bindExtensionMemberAttributes } from './extension-attributes.js';

const defaultUsage = Object.freeze({ validOn: AttributeTargets.All, allowMultiple: false, inherited: true });
const unknownUsage = Object.freeze({ validOn: AttributeTargets.All, allowMultiple: true, inherited: true, isUnknown: true });
/** Bound expression kinds that are never an attribute argument, whatever their operands. */
const neverConstant = new Set(['Call', 'ObjectCreation', 'Local', 'Parameter', 'PropertyAccess', 'This', 'Assignment', 'Lambda']);

export { fullNameOf, attributesNamed };

const constantOf = argument => {
  const value = argument?.constantValue;
  return value && typeof value === 'object' && 'value' in value ? value.value : undefined;
};

function isValidArgument(e) {
  if (!e || e.hasErrors) return true;
  if (e.constantValue || e.literal || e.kind === 'TypeOf' || e.kind === 'Default') return true;
  if (e.kind === 'ArrayCreation') return (e.elements ?? []).every(isValidArgument);
  if (e.kind === 'Conversion' && e.operand) return isValidArgument(e.operand);
  if (e.kind === 'FieldAccess') return !!(e.field?.isConst || e.field?.isEnumMember);
  return !neverConstant.has(e.kind);
}

/** Class mixin of the semantic analysis: binding of attributes and decoding of the well-known ones. */
export const AttributeBinding = Base =>
  class extends Base {
    /** Binds the attributes of every source declaration. Runs before bodies are bound, so calls see the decoded data. */
    bindAttributes() {
      for (const file of this.files) {
        const uri = file.source.uri,
          site = { symbol: this.assembly, scope: this.assembly.unitScopes.get(uri), uri, containingType: null };
        this.bindAttributeLists(site, file.syntax.attributeLists, compilationLocations);
      }
      for (const type of this.assembly.types) this.attributesOfType(type);
      for (const type of this.assembly.types) {
        for (const parameter of type.typeParameters ?? []) this.bindDeclared(parameter, parameter.syntax, type.declarations[0].scope, type);
        for (const member of type.getMembers()) this.bindMemberAttributes(member, type);
      }
    }
    /** The attributes of a source type, bound on first use (an attribute class is asked for its AttributeUsage). */
    attributesOfType(type) {
      if (!type.isSource || type.boundAttributes) return type.boundAttributes ?? [];
      type.boundAttributes = [];
      for (const declaration of type.declarations) {
        const parameters = [...(type.typeParameters ?? [])],
          scope = parameters.length ? declaration.scope.child('typeParameters', { parameters }) : declaration.scope,
          site = { symbol: type, scope, uri: declaration.uri, containingType: type.containingType ?? type };
        this.bindAttributeLists(site, declaration.syntax.attributeLists, attributeLocations(type));
      }
      this.decodeTypeAttributes(type);
      return type.boundAttributes;
    }
    bindMemberAttributes(member, type) {
      if (member.isImplicitlyDeclared || member.recordMember || member.kind === SymbolKind.NamedType) return;
      if (bindExtensionMemberAttributes(this, member, type)) return;
      const scope = member.scope ?? type.primaryScope;
      let syntax = member.syntax;
      if (member.kind === SymbolKind.Field && !member.isEnumMember) syntax = member.declarationSyntax;
      else if (member.kind === SymbolKind.Event && member.isFieldLike) syntax = member.syntax?.parent?.parent;
      else if (member.kind === SymbolKind.Method && member.isAccessor && member.associatedSymbol?.syntax === syntax) syntax = null;
      this.bindDeclared(member, syntax, scope, type);
      const accessors = [member.getMethod, member.setMethod, member.addMethod, member.removeMethod].filter(Boolean);
      for (const accessor of accessors) this.bindMemberAttributes(accessor, type);
      if (member.kind !== SymbolKind.Method) return;
      for (const parameter of member.typeParameters ?? []) this.bindDeclared(parameter, parameter.syntax, scope, type);
      if (!member.isAccessor) for (const parameter of member.parameters) this.bindDeclared(parameter, parameter.syntax, scope, type);
      this.decodeMethodAttributes(member);
    }
    bindDeclared(symbol, syntax, scope, type, locations = null) {
      if (!syntax?.attributeLists?.length || symbol.boundAttributes) return;
      symbol.boundAttributes = [];
      const site = { symbol, scope, uri: symbol.uri ?? scope.uri ?? this.at(type).uri, containingType: type };
      this.bindAttributeLists(site, syntax.attributeLists, locations ?? attributeLocations(symbol));
      const obsolete = attributesNamed(symbol, 'System.ObsoleteAttribute')[0];
      if (obsolete) symbol.obsolete = this.obsoleteDataOf(obsolete);
    }
    bindAttributeLists(site, lists, locations) {
      for (const list of lists ?? []) {
        let location = locations.default;
        const specifier = list.target?.identifier;
        if (specifier) {
          const word = specifier.text;
          if (!Object.hasOwn(locations.targets, word)) {
            const valid = Object.keys(locations.targets).join(', ');
            this.report(site.uri, specifier, knownLocations.has(word) ? DiagnosticId.CS0657 : DiagnosticId.CS0658, [word, valid]);
            continue;
          }
          location = word;
        }
        if (location === null) continue;
        for (const attribute of list.attributes ?? []) this.bindAttribute(site, attribute, location, locations.targets[location]);
      }
    }
    bindAttribute(site, syntax, location, target) {
      const attributeClass = this.attributeClassOf(syntax.name, site.scope, site.uri),
        written = syntax.name.toString().trim(),
        applied = (site.symbol.boundAttributes ??= []);
      if (!attributeClass) return;
      const usage = this.attributeUsageOf(attributeClass);
      if (!(usage.validOn & target)) this.report(site.uri, syntax.name, DiagnosticId.CS0592, [written, describeTargets(usage.validOn)]);
      else if (!usage.allowMultiple && applied.some(other => other.location === location && other.attributeClass === attributeClass))
        this.report(site.uri, syntax.name, DiagnosticId.CS0579, [written]);
      const bound = { attributeClass, location, syntax, attributeConstructor: null, arguments: [], named: [] };
      applied.push(bound);
      this.bindAttributeArguments(site, bound);
    }
    /** The attribute class a name denotes, or null after reporting why there is none. */
    attributeClassOf(name, scope, uri) {
      const binder = this.typeBinder;
      let simple = name,
        container = null;
      if (name.kind === 'QualifiedName') {
        container = binder.bindNamespaceOrType(name.left, scope);
        simple = name.right;
        if (!container || container.kind === SymbolKind.ErrorType) return null;
      } else if (name.kind === 'AliasQualifiedName' && name.alias.identifier.valueText === 'global') {
        container = this.globalNamespace;
        simple = name.name;
      }
      // C# 11 generic attributes (./csharp11.js).
      if (simple.kind === 'GenericName' && this.genericAttributeClass) return this.genericAttributeClass(name, simple, container, scope, uri);
      if (simple.kind !== 'IdentifierName' || (name.kind === 'AliasQualifiedName' && !container)) {
        const type = binder.bindType(name, scope).type;
        return type.isErrorType() ? null : this.checkAttributeClass(type, name, uri);
      }
      const text = simple.identifier.valueText,
        find = candidate => {
          if (!container) return binder.lookup(candidate, 0, scope);
          if (container.kind === SymbolKind.Namespace) return container.getTypeMembers(candidate, 0)[0] ?? null;
          return (container.originalDefinition ?? container).getTypeMembers?.(candidate, 0)[0] ?? null;
        };
      const plain = find(text),
        suffixed = simple.identifier.text.startsWith('@') ? null : find(text + 'Attribute');
      if (plain?.ambiguous || suffixed?.ambiguous) {
        const [first, second] = (plain?.ambiguous ?? suffixed.ambiguous).map(type => type.toDisplayString());
        this.report(uri, simple, DiagnosticId.CS0104, [plain?.ambiguous ? text : text + 'Attribute', first, second]);
        return null;
      }
      const named = found => (found?.kind === SymbolKind.NamedType ? found : null),
        plainType = named(plain),
        suffixedType = named(suffixed),
        plainFits = this.isAttributeClass(plainType),
        suffixedFits = this.isAttributeClass(suffixedType);
      if (plainFits && suffixedFits) {
        this.report(uri, simple, DiagnosticId.CS1614, [text, plainType.toDisplayString(), suffixedType.toDisplayString()]);
        return null;
      }
      if (plainFits || suffixedFits) return this.checkAttributeClass(plainFits ? plainType : suffixedType, simple, uri);
      const other = plainType ?? suffixedType;
      if (other) {
        if (isSourceSymbol(other) || this.closedHierarchy(other)) this.report(uri, simple, DiagnosticId.CS0616, [other.toDisplayString()]);
        else this.incomplete = true;
        return null;
      }
      // The registry lists few attribute classes: a name the base class library may have is not reported as missing.
      const mayExist = this.hasUnknownUsings || this.isKnownFrameworkName(text) || this.isKnownFrameworkName(text + 'Attribute');
      if (mayExist || (container && !isSourceSymbol(container))) {
        this.incomplete = true;
        return null;
      }
      if (this.reportAttributeArity?.(simple, text, scope, container, uri)) return null;
      const missing = container ? [DiagnosticId.CS0234, container.toDisplayString()] : [DiagnosticId.CS0246];
      for (const candidate of [text + 'Attribute', text]) this.report(uri, simple, missing[0], [candidate, ...missing.slice(1)]);
      return null;
    }
    isAttributeClass(type) {
      if (!type || type.typeKind !== TypeKind.Class) return false;
      const root = this.core.attribute;
      for (let t = type, depth = 0; t && depth < 64; t = t.baseType, depth++) if ((t.originalDefinition ?? t) === root) return true;
      return false;
    }
    checkAttributeClass(type, node, uri) {
      if (!this.isAttributeClass(type)) {
        this.report(uri, node, DiagnosticId.CS0616, [type.toDisplayString()]);
        return null;
      }
      if (type.isAbstract) {
        this.report(uri, node, DiagnosticId.CS0653, [type.toDisplayString()]);
        return null;
      }
      return type;
    }
    /** `{validOn, allowMultiple, inherited}` of an attribute class: its AttributeUsage, else the one it inherits. */
    attributeUsageOf(type) {
      for (let t = type.originalDefinition ?? type, depth = 0; t && depth < 64; t = t.baseType?.originalDefinition ?? t.baseType, depth++) {
        if (t.attributeUsage) return t.attributeUsage;
        if (t === this.core.attribute) return defaultUsage;
        if (isImportedType(t)) {
          // A class read from metadata declares its usage there; without one its base class decides.
          const imported = importedAttributeUsage(t);
          if (imported) return imported;
          continue;
        }
        if (!t.isSource) return unknownUsage;
        this.attributesOfType(t);
        if (t.attributeUsage) return t.attributeUsage;
      }
      return defaultUsage;
    }
    bindAttributeArguments(site, bound) {
      const { attributeClass, syntax } = bound,
        within = site.containingType?.originalDefinition ?? null;
      const binder = new BodyBinder(this, {
        uri: site.uri,
        scope: site.scope,
        containingType: site.containingType,
        method: null,
        isStatic: true,
        isFieldInitializer: true,
        isStaticInitializer: true,
        // C# 11: the parameters of a method are in scope in its attributes and in those of its parameters (for nameof).
        parameters: this.attributeScopeParameters?.(site) ?? [],
      });
      const all = syntax.argumentList?.arguments ?? [],
        positional = all.filter(argument => !argument.nameEquals).map(argument => binder.argument(argument));
      for (const argument of positional) if (!isValidArgument(argument)) binder.report(argument.syntax, DiagnosticId.CS0182);
      const constructors = attributeClass.getMembers('.ctor').filter(member => member.methodKind === MethodKind.Constructor),
        accessible = constructors.filter(c => isAccessible(c.originalDefinition ?? c, within, { throughType: attributeClass.originalDefinition }));
      if (!constructors.length) this.incomplete = true;
      else if (!positional.some(argument => argument.hasErrors)) {
        const result = this.overloads.resolve(accessible, positional, { isConstructor: true });
        if (result.succeeded) {
          bound.attributeConstructor = result.method;
          bound.arguments = binder.finishCall(result, null, positional, syntax, {}).args?.map(argument => argument.expression) ?? [];
        } else if (!isSourceSymbol(attributeClass) && !attributeClass.attributeUsage && !isImportedType(attributeClass)) this.incomplete = true;
        else {
          const error = result.error,
            args = error.code === DiagnosticId.CS1729 ? [attributeClass.toDisplayString(), positional.length] : error.args;
          binder.report(binder.errorNode(error, positional, syntax.name), error.code, args);
        }
      }
      const seen = new Set();
      for (const argument of all.filter(candidate => candidate.nameEquals)) this.bindNamedArgument(binder, bound, argument, seen);
    }
    bindNamedArgument(binder, bound, argument, seen) {
      const nameNode = argument.nameEquals.name,
        name = nameNode.identifier.valueText,
        value = binder.value(argument.expression);
      if (seen.has(name)) binder.report(argument, DiagnosticId.CS0643, [name]);
      seen.add(name);
      let member = null,
        closed = true;
      for (let t = bound.attributeClass, depth = 0; t && !member && depth < 64; t = t.baseType, depth++) {
        member = t.getMembers(name).find(m => m.kind === SymbolKind.Field || m.kind === SymbolKind.Property) ?? null;
        const isKnown = isSourceSymbol(t) || !!t.attributeUsage || isImportedType(t) || t === this.core.attribute;
        if (!isKnown && t.specialType !== 'System_Object') closed = false;
      }
      if (!member) {
        if (closed) binder.report(nameNode, DiagnosticId.CS0246, [name]);
        else this.incomplete = true;
        return;
      }
      if (member.kind === SymbolKind.Field) {
        // Naming a field in an attribute is a use of it, and an assignment, for the unused-field warnings.
        const field = member.originalDefinition ?? member;
        field.reads = (field.reads ?? 0) + 1;
        field.writes = (field.writes ?? 0) + 1;
        field.nonConstantWrite = true;
      }
      if (!isAccessible(member.originalDefinition ?? member, binder.c.containingType?.originalDefinition ?? null)) {
        binder.report(nameNode, DiagnosticId.CS0122, [member.toDisplayString()]);
        return;
      }
      const isPublic = member.declaredAccessibility === Accessibility.Public,
        writable =
          member.kind === SymbolKind.Field
            ? !member.isReadOnly && !member.isConst
            : !!member.setMethod && member.setMethod.declaredAccessibility === Accessibility.Public && !member.setMethod.isInitOnly && !member.isIndexer;
      if (!isPublic || member.isStatic || !writable) {
        binder.report(nameNode, DiagnosticId.CS0617, [name]);
        return;
      }
      const converted = member.type ? binder.convert(value, member.type, argument.expression) : value;
      if (!isValidArgument(converted)) binder.report(argument.expression, DiagnosticId.CS0182);
      bound.named.push({ name, member, value: converted });
    }
    /** `{message, isError}` of a bound `[Obsolete]`, the shape imported symbols carry. */
    obsoleteDataOf(attribute) {
      const [message, isError] = attribute.arguments.map(constantOf);
      return Object.freeze({ message: typeof message === 'string' ? message : null, isError: isError === true });
    }
    decodeTypeAttributes(type) {
      const usage = attributesNamed(type, 'System.AttributeUsageAttribute')[0];
      if (usage) {
        if (!this.isAttributeClass(type)) this.report(this.at(type).uri, usage.syntax.name, DiagnosticId.CS0641, [usage.syntax.name.toString().trim()]);
        else {
          const validOn = constantOf(usage.arguments[0]),
            named = key => constantOf(usage.named.find(entry => entry.name === key)?.value);
          type.attributeUsage = Object.freeze({
            validOn: validOn === undefined ? AttributeTargets.All : Number(validOn),
            allowMultiple: named('AllowMultiple') === true,
            inherited: named('Inherited') !== false,
          });
        }
      }
      const obsolete = attributesNamed(type, 'System.ObsoleteAttribute')[0];
      if (obsolete) type.obsolete = this.obsoleteDataOf(obsolete);
      if (attributesNamed(type, 'System.FlagsAttribute').length) type.isFlagsEnum = true;
    }
    decodeMethodAttributes(method) {
      const dllImport = attributesNamed(method, 'System.Runtime.InteropServices.DllImportAttribute')[0];
      if (dllImport) method.dllImport = Object.freeze({ syntax: dllImport.syntax, library: constantOf(dllImport.arguments[0]) ?? null });
    }
  };
