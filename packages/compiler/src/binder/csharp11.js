/**
 * C# 11 rules that are not a construct family of their own (SF-A02-T76).
 *
 *   Checked user-defined operators - `operator checked +` is declared as `op_CheckedAddition`; in a checked context
 *       it replaces the unchecked operator with the same operands (overload/checked-operators.js). CS9023 (the operator has
 *       no checked form), CS9025 (no matching unchecked operator).
 *   Generic attributes - `[Name<T>]` is bound like `[Name]`: `Name<>` and `NameAttribute<>` are candidates.
 *       CS8968 (a type argument uses a type parameter), CS8970 (it is not representable in metadata), CS0305 /
 *       CS0308 (wrong number of type arguments), CS7003 (`Name<>`), and the gate on a generic attribute class.
 *   Extended nameof scope - the parameters of a method are in scope in its attributes (`attributeScopeParameters`).
 *   File-local types - a `file` type is declared in the scope of its file (symbols/source/assembly-core.js), so two
 *       files may declare the same name. CS9051 (used in the signature of a member of a type that is not
 *       file-local), CS9053 (as its base class), CS9054 (nested), CS9052 (with an accessibility modifier) and
 *       CS9071 (declared twice in one file). The image class of such a type has a name unique to its file.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { Conversion } from '../conversions/classify.js';
import { uncheckedOperatorName, isCheckedOperatorName, sameOperatorSignature } from '../overload/checked-operators.js';

/** The operators that have a checked form: unary `-`, `++`, `--`, binary `+ - * /` and explicit conversions. */
const checkable = new Set(['+', '-', '*', '/', '++', '--']);

const isOperator = member =>
  member.kind === SymbolKind.Method && (member.methodKind === MethodKind.UserDefinedOperator || member.methodKind === MethodKind.Conversion);
/**
 * Declaration rules of checked operators.
 * @returns {{member:object,code:string,args:any[],at?:object}[]}
 */
export function checkCheckedOperators(type) {
  const rows = [],
    operators = type.getMembers().filter(isOperator);
  for (const method of operators) {
    const keyword = method.syntax?.checkedKeyword;
    if (!keyword) continue;
    const isConversion = method.methodKind === MethodKind.Conversion,
      token = isConversion ? null : method.operatorToken;
    if (!isConversion && !checkable.has(token)) {
      rows.push({ member: method, code: DiagnosticId.CS9023, args: [token], at: keyword });
      continue;
    }
    if (!isCheckedOperatorName(method.name)) continue;
    const plain = uncheckedOperatorName(method.name);
    if (!operators.some(other => other.name === plain && sameOperatorSignature(other, method)))
      rows.push({ member: method, code: DiagnosticId.CS9025, args: [method.toDisplayString()] });
  }
  return rows;
}

/** Class mixin of the body binder: C# 11 expression rules. */
export const CSharp11Binding = Base =>
  class extends Base {
    /** In a checked context an explicit user-defined conversion is its `explicit operator checked` form when there is one. */
    checkedConversion(conversion) {
      const method = conversion.method;
      if (!this.checked || method?.name !== 'op_Explicit') return conversion;
      const checkedForm = method.containingType?.getMembers('op_CheckedExplicit').find(candidate => sameOperatorSignature(candidate, method));
      if (!checkedForm) return conversion;
      const { underlying, isLifted, steps } = conversion;
      return new Conversion(conversion.kind, { method: checkedForm, underlying, isLifted, steps });
    }
  };

const isFileLocalType = type => {
  for (let t = type?.originalDefinition ?? type; t; t = t.containingType) if (t.isFileLocal) return true;
  return false;
};
/** The file-local type a type mentions (itself, an element type or a type argument), or null. */
function fileLocalIn(type) {
  if (!type || type.isErrorType?.()) return null;
  if (isFileLocalType(type)) return type.originalDefinition ?? type;
  const parts = [type.elementType, ...(type.typeArguments ?? []).map(argument => argument.type ?? argument)];
  for (const part of parts) {
    const found = fileLocalIn(part);
    if (found) return found;
  }
  return null;
}
const signatureTypes = member =>
  member.kind === SymbolKind.Method ? [member.returnType, ...member.parameters.map(p => p.type)] : [member.type, ...(member.parameters ?? []).map(p => p.type)];

/**
 * Rules of file-local types for one source type.
 * @returns {{member:object,code:string,args:string[]}[]} `member` is the type itself or one of its members
 */
export function checkFileLocalTypes(type) {
  const rows = [],
    display = type.toDisplayString(),
    words = type.modifierWords ?? [];
  if (words.includes('file')) {
    if (type.containingType) rows.push({ member: type, code: DiagnosticId.CS9054, args: [display] });
    else if (words.some(word => ['public', 'internal', 'private', 'protected'].includes(word))) rows.push({ member: type, code: DiagnosticId.CS9052, args: [display] });
  }
  if (isFileLocalType(type)) return rows;
  if (isFileLocalType(type.baseType)) rows.push({ member: type, code: DiagnosticId.CS9053, args: [type.baseType.toDisplayString(), display] });
  const report = (member, types) => {
    const used = types.map(fileLocalIn).find(Boolean);
    if (used) rows.push({ member, code: DiagnosticId.CS9051, args: [used.toDisplayString(), display] });
  };
  if (type.typeKind === TypeKind.Delegate) {
    const invoke = type.delegateInvokeMethod;
    if (invoke) report(type, signatureTypes(invoke));
    return rows;
  }
  for (const member of type.getMembers()) {
    const isDeclared = [SymbolKind.Field, SymbolKind.Property, SymbolKind.Event, SymbolKind.Method].includes(member.kind);
    if (!isDeclared || member.isImplicitlyDeclared || member.isAccessor || member.associatedSymbol) continue;
    report(member, signatureTypes(member));
  }
  return rows;
}

/** The name of the image class of a file-local type: unique per file, as Roslyn's `<File>F<hash>__Name` is. */
export function fileLocalClassName(type, fileOrdinal) {
  const display = type.toDisplayString(),
    cut = display.lastIndexOf('.') + 1,
    stem = String(type.declarations?.[0]?.uri ?? '').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  return `${display.slice(0, cut)}<${stem}>F${fileOrdinal}__${display.slice(cut)}`;
}

const namedType = found => (found?.kind === SymbolKind.NamedType ? found : null);
const hasTypeParameter = type =>
  !!type &&
  (type.typeKind === TypeKind.TypeParameter ||
    hasTypeParameter(type.elementType) ||
    (type.typeArguments ?? []).some(argument => hasTypeParameter(argument.type ?? argument)));

/** The part of a type argument that metadata cannot represent in an attribute: `dynamic`, tuple names, `T?` on a reference. */
function unrepresentable(syntax, type) {
  if (syntax.kind === 'IdentifierName' && syntax.identifier.valueText === 'dynamic' && type?.typeKind === 'dynamic') return true;
  if (syntax.kind === 'TupleType' && [...syntax.elements].some(element => element.identifier)) return true;
  if (syntax.kind === 'NullableType' && type?.isReferenceType === true) return true;
  return [...syntax.childNodes()].some(child => /Type$|Name$|TypeArgumentList$|TupleElement$/.test(child.kind) && unrepresentable(child, null));
}

/** Class mixin (analysis phase): the declaration rules of C# 11. */
export const CSharp11Rules = Base =>
  class extends Base {
    checkType(type) {
      super.checkType(type);
      for (const row of checkCheckedOperators(type)) this.report(this.at(row.member).uri, row.at ?? this.at(row.member), row.code, row.args);
      this.gateGenericAttributeClass(type);
      for (const row of checkFileLocalTypes(type)) this.reportAt(row.member, row.code, row.args);
    }
    /** The parameters an attribute sees (extended nameof scope): those of the method it is on, or of its parameter's method. */
    attributeScopeParameters(site) {
      if (this.versionOf(site.uri).number < 11) return [];
      const symbol = site.symbol,
        owner = symbol.kind === SymbolKind.Parameter ? symbol.containingSymbol : symbol;
      return owner?.kind === SymbolKind.Method ? owner.parameters : [];
    }
    /** Below C# 11 a generic class (or a class nested in one) cannot derive from an attribute class: gated at its base type. */
    gateGenericAttributeClass(type) {
      if (type.typeKind !== TypeKind.Class || !type.baseType || type.baseType.specialType === 'System_Object') return;
      let isGeneric = false;
      for (let t = type; t; t = t.containingType) isGeneric ||= !!t.typeParameters?.length;
      if (!isGeneric || !this.isAttributeClass?.(type)) return;
      for (const declaration of type.declarations ?? []) {
        const base = declaration.syntax.baseList?.types[0]?.type;
        if (base) this.gate(declaration.uri, base, 'genericAttributes', { name: 'generic attributes', version: 11 });
      }
    }
    /**
     * `[Name<T>]` (C# 11): the constructed attribute class, or null after reporting why there is none. As for a plain
     * name, `Name<>` and `NameAttribute<>` are both candidates and the attribute class wins.
     */
    genericAttributeClass(name, simple, container, scope, uri) {
      const text = simple.identifier.valueText,
        written = [...simple.typeArgumentList.arguments],
        find = candidate => this.findTypeForAttribute(candidate, written.length, container, scope),
        [plain, suffixed] = [find(text), find(text + 'Attribute')],
        candidates = [namedType(plain), namedType(suffixed)].filter(type => this.isAttributeClass(type));
      if (written.some(argument => argument.kind === 'OmittedTypeArgument')) {
        this.report(uri, simple, DiagnosticId.CS7003);
        return null;
      }
      if (candidates.length > 1) {
        this.report(uri, simple, DiagnosticId.CS1614, [text, ...candidates.map(type => type.toDisplayString())]);
        return null;
      }
      if (!candidates.length) {
        if (this.reportAttributeArity(simple, text, scope, container, uri)) return null;
        // Not an attribute class at all: binding the name as a type reports what it is, or that it does not exist.
        const type = this.typeBinder.bindType(name, scope).type;
        return type.isErrorType() ? null : this.checkAttributeClass(type, name, uri);
      }
      const typeArguments = written.map(argument => this.typeBinder.bindType(argument, scope).type);
      if (typeArguments.some(type => type.isErrorType())) return null;
      const open = typeArguments.find(hasTypeParameter),
        hidden = written.findIndex((argument, index) => unrepresentable(argument, typeArguments[index]));
      if (open) this.report(uri, simple, DiagnosticId.CS8968, [open.toDisplayString()]);
      if (hidden >= 0) this.report(uri, simple, DiagnosticId.CS8970, [written[hidden].toString().trim()]);
      return this.checkAttributeClass(candidates[0].construct(...typeArguments), name, uri);
    }
    findTypeForAttribute(name, arity, container, scope) {
      if (!container) return this.typeBinder.lookup(name, arity, scope, { all: true });
      const members = (container.originalDefinition ?? container).getTypeMembers?.bind(container.originalDefinition ?? container);
      if (!members) return null;
      const exact = members(name, arity)[0],
        other = exact ? null : members(name)[0];
      return exact ?? (other ? { wrongArity: other } : null);
    }
    /** CS0305 / CS0308 when the name of an attribute is a type with another number of type parameters. Returns true when reported. */
    reportAttributeArity(simple, text, scope, container, uri) {
      const arity = simple.kind === 'GenericName' ? simple.typeArgumentList.arguments.length : 0,
        wrong = [text + 'Attribute', text]
          .map(candidate => this.findTypeForAttribute(candidate, arity, container, scope)?.wrongArity)
          .find(type => type && (type.arity === 0 || this.isAttributeClass(type)));
      if (!wrong) return false;
      if (wrong.arity) this.report(uri, simple, DiagnosticId.CS0305, [wrong.toDisplayString(), wrong.arity]);
      else this.report(uri, simple, DiagnosticId.CS0308, [wrong.toDisplayString(), 'type']);
      return true;
    }
  };
