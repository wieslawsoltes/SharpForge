/**
 * COM interop in the language (C# 4, SF-A02-T56). Binding policy and diagnostics only: the runtime has no COM.
 *
 * A type is a COM type when it carries `[ComImport]` (with a `[Guid]`). The language then allows two things:
 *
 *   - `ref` may be omitted on an argument of a method of a COM **interface**: the value is copied to a temporary that
 *     is passed by reference (`out` cannot be omitted);
 *   - `new I()` on a COM interface with `[CoClass(typeof(C))]` creates a `C`.
 *
 * Declaration rules:
 *   CS0596  [ComImport] without [Guid]                 CS0591  a [Guid] argument that is not a GUID
 *   CS0424  a ComImport class with a base class         CS0669  a ComImport class with a constructor
 *   CS0423  a method of a ComImport class that is neither extern nor abstract
 *   ([ComImport] on a struct is CS0592 through the attribute's valid targets; an extern member of a COM class is
 *   implemented by the runtime callable wrapper, so it does not get the CS0626 warning.)
 *
 * Not in the language as source: indexed properties and embedded interop types (NoPIA) exist only in metadata
 * (a referenced interop assembly, `EmbedInteropTypes`); neither is modelled.
 *
 * Nothing here runs: creating a coclass and calling with an omitted `ref` are SF2200 (codegen/semantic).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { attributesNamed } from './bound-attributes.js';

const INTEROP = 'System.Runtime.InteropServices.';
const guidFormat = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const definitionOf = type => type?.originalDefinition ?? type;

/** True for a source type declared with `[ComImport]`. */
export const isComImport = type => attributesNamed(definitionOf(type), INTEROP + 'ComImportAttribute').length > 0;

/** The class `new I()` creates for a COM interface with `[CoClass(typeof(C))]`, or null. */
export function coClassOf(type) {
  const definition = definitionOf(type);
  if (definition?.typeKind !== TypeKind.Interface || !isComImport(definition)) return null;
  const [attribute] = attributesNamed(definition, INTEROP + 'CoClassAttribute');
  return attribute?.arguments?.[0]?.operandType ?? null;
}

/** True when an argument for a `ref` parameter of `method` may be written without `ref`. */
export const allowsRefOmission = method => definitionOf(method?.containingType)?.typeKind === TypeKind.Interface && isComImport(method.containingType);

/**
 * The COM declaration rules of one source type.
 * @returns {{ code: string, args: any[], node: object }[]} `node` is a syntax node or a location of the type's file
 */
export function checkComDeclarations(type) {
  const rows = [],
    add = (code, args, node) => rows.push({ code, args, node });
  for (const guid of attributesNamed(type, INTEROP + 'GuidAttribute')) {
    const value = guid.arguments?.[0]?.constantValue?.value;
    if (typeof value === 'string' && !guidFormat.test(value)) add(DiagnosticId.CS0591, ['Guid'], guid.arguments[0].syntax);
  }
  const [comImport] = attributesNamed(type, INTEROP + 'ComImportAttribute');
  if (!comImport || (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Interface)) return rows;
  if (!attributesNamed(type, INTEROP + 'GuidAttribute').length) add(DiagnosticId.CS0596, [], comImport.syntax.name);
  if (type.typeKind !== TypeKind.Class) return rows;
  const display = type.toDisplayString();
  if (type.baseSyntax) add(DiagnosticId.CS0424, [display], type.locations[0]);
  for (const member of type.getMembers()) {
    if (member.kind !== SymbolKind.Method || member.isImplicitlyDeclared || !member.locations?.[0]) continue;
    if (member.methodKind === MethodKind.Constructor && !member.isExtern) add(DiagnosticId.CS0669, [], member.locations[0]);
    else if (member.methodKind !== MethodKind.Constructor && !member.isExtern && !member.isAbstract)
      add(DiagnosticId.CS0423, [display, member.toDisplayString()], member.locations[0]);
  }
  return rows;
}

/** Class mixin of the semantic analysis: COM declaration rules and the `ref` omission policy of overload resolution. */
export const ComInteropChecks = Base =>
  class extends Base {
    checkSpecialMembers() {
      super.checkSpecialMembers();
      this.overloads.allowsRefOmission = allowsRefOmission;
      for (const type of this.assembly.types) {
        const uri = this.at(type).uri;
        for (const row of checkComDeclarations(type)) this.report(uri, row.node, row.code, row.args);
      }
    }
  };

/** Class mixin for the body binder: coclass creation and calls that omit `ref`. */
export const ComInteropBinding = Base =>
  class extends Base {
    create(type, args, syntax, typeNode, initializer) {
      const coClass = coClassOf(type);
      if (!coClass || coClass.isErrorType?.()) return super.create(type, args, syntax, typeNode, initializer);
      const created = super.create(coClass, args, syntax, typeNode, initializer);
      if (created.hasErrors) return created;
      // The expression has the interface type; the object is an instance of the coclass.
      return { ...created, type, coClass, isComCreation: true };
    }
    finishCall(result, receiver, args, syntax, options = {}) {
      const node = super.finishCall(result, receiver, args, syntax, options);
      if (result.candidate?.omitsRef && node.kind === 'Call') node.omitsRef = true;
      return node;
    }
  };
