/**
 * C# 9 rules that are not a construct family of their own (SF-A02-T72): covariant returns, module initializers and
 * `[SkipLocalsInit]`.
 *
 *   Covariant returns   - an override may return a more derived reference type (binder/overrides.js decides which
 *                         overrides are covariant and gates the feature). A call through a receiver whose type has
 *                         such an override has the override's return type: `covariantReturnType`.
 *   Module initializers - `[ModuleInitializer]` methods run once, in declaration order, before the entry point.
 *                         CS8813 (not an ordinary method), CS8814 (not accessible at module level), CS8815 (not
 *                         static, parameterless and void), CS8816 (generic, or in a generic type).
 *   SkipLocalsInit      - needs /unsafe (CS0227). The runtime always zeroes locals, which the attribute permits.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, Accessibility } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { attributesNamed } from './bound-attributes.js';

const compilerServices = 'System.Runtime.CompilerServices.';
export const moduleInitializerAttribute = compilerServices + 'ModuleInitializerAttribute';
export const skipLocalsInitAttribute = compilerServices + 'SkipLocalsInitAttribute';

const definitionOf = symbol => symbol?.originalDefinition ?? symbol;
const moduleLevel = new Set([Accessibility.Public, Accessibility.Internal, Accessibility.ProtectedOrInternal]);

/** True when a member can be named from anywhere in its assembly: it and every containing type is public or internal. */
function isAccessibleAtModuleLevel(member) {
  for (let symbol = member; symbol && symbol.kind !== SymbolKind.Namespace; symbol = symbol.containingSymbol) {
    const isDeclaration = symbol.kind === SymbolKind.NamedType || symbol === member;
    if (isDeclaration && !moduleLevel.has(symbol.declaredAccessibility)) return false;
  }
  return true;
}

const isGeneric = method => {
  if (method.typeParameters?.length) return true;
  for (let type = method.containingType; type; type = type.containingType) if (type.typeParameters?.length) return true;
  return false;
};

/**
 * The rules a `[ModuleInitializer]` method must satisfy.
 * @returns {{code:string,args:string[]}[]} empty when the method is a valid module initializer
 */
export function checkModuleInitializer(method) {
  if (method.methodKind !== MethodKind.Ordinary) return [{ code: DiagnosticId.CS8813, args: [] }];
  const rows = [];
  if (!isAccessibleAtModuleLevel(method)) rows.push({ code: DiagnosticId.CS8814, args: [method.name] });
  const returnsVoid = method.returnType?.specialType === 'System_Void';
  if (!method.isStatic || method.parameters.length || !returnsVoid || method.isAbstract || method.isVirtual)
    rows.push({ code: DiagnosticId.CS8815, args: [method.name] });
  if (isGeneric(method)) rows.push({ code: DiagnosticId.CS8816, args: [method.name] });
  return rows;
}

/**
 * The return type of a call to the virtual method `method` through a receiver of type `receiverType`: the return type
 * of the most derived override the receiver type has, which C# 9 allows to be more derived than the declared one.
 */
export function covariantReturnType(method, receiverType) {
  const declared = method.returnType ?? null,
    target = definitionOf(method);
  if (!declared || !receiverType || method.isStatic || !(method.isVirtual || method.isAbstract || method.isOverride)) return declared;
  for (let type = receiverType, depth = 0; type && depth < 64; type = type.baseType, depth++) {
    if (definitionOf(type) === definitionOf(method.containingType)) break;
    // Members of a constructed generic type would need substitution; such an override keeps the declared type.
    if (type.typeArguments?.length || !type.getMembers) continue;
    for (const candidate of type.getMembers(method.name)) {
      if (candidate.kind !== SymbolKind.Method || !candidate.isOverride) continue;
      for (let base = candidate.overriddenMethod, steps = 0; base && steps < 64; base = base.overriddenMethod, steps++)
        if (definitionOf(base) === target) return candidate.returnType ?? declared;
    }
  }
  return declared;
}

const memberNotNullAttributes = [
  'System.Diagnostics.CodeAnalysis.MemberNotNullAttribute',
  'System.Diagnostics.CodeAnalysis.MemberNotNullWhenAttribute',
];

/** Class mixin (analysis phase): the attribute-driven rules of C# 9, run once the attributes are bound. */
export const CSharp9Rules = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      this.assembly.moduleInitializers = [];
      const targets = [this.assembly];
      for (const type of this.assembly.types) {
        targets.push(type);
        for (const member of type.getMembers()) {
          targets.push(member);
          if (member.kind === SymbolKind.Method) this.decodeModuleInitializer(member);
          this.gateAttributeFeatures(member);
        }
      }
      if (this.options.allowUnsafe) return;
      for (const symbol of targets)
        for (const attribute of attributesNamed(symbol, skipLocalsInitAttribute))
          this.report(this.uriOfAttribute(symbol), attribute.syntax.name, DiagnosticId.CS0227);
    }
    /**
     * Attributes whose use is a language feature: `[Obsolete]` on a property accessor (C# 8, reported at the
     * attribute name) and `[MemberNotNull]` / `[MemberNotNullWhen]` (C# 9, reported at the attribute).
     */
    gateAttributeFeatures(member) {
      const accessors = member.kind === SymbolKind.Property ? [member.getMethod, member.setMethod].filter(Boolean) : [];
      for (const accessor of accessors)
        for (const attribute of attributesNamed(accessor, 'System.ObsoleteAttribute'))
          this.gate(this.uriOfAttribute(accessor), attribute.syntax.name, 'ObsoleteOnPropertyAccessor');
      for (const symbol of [member, ...accessors])
        for (const name of memberNotNullAttributes)
          for (const attribute of attributesNamed(symbol, name)) this.gate(this.uriOfAttribute(symbol), attribute.syntax, 'MemberNotNull');
    }
    uriOfAttribute(symbol) {
      return symbol.uri ?? symbol.locations?.[0]?.uri ?? this.files[0]?.source.uri;
    }
    decodeModuleInitializer(method) {
      const attribute = attributesNamed(method, moduleInitializerAttribute)[0];
      // On a constructor or destructor the attribute is not valid at all (CS0592): nothing more is said.
      const isMethodTarget = ![MethodKind.Constructor, MethodKind.StaticConstructor, MethodKind.Destructor].includes(method.methodKind);
      if (!attribute || !isMethodTarget) return;
      const uri = this.uriOfAttribute(method),
        at = attribute.syntax.name;
      if (!this.gate(uri, at, 'ModuleInitializers', { name: 'module initializers', version: 9 })) return;
      const rows = checkModuleInitializer(method);
      for (const row of rows) this.report(uri, at, row.code, row.args);
      if (!rows.length) this.assembly.moduleInitializers.push(method);
    }
  };
