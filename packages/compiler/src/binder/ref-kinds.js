/**
 * ref, out and in parameters and arguments (SF-A02-T04.2, C# spec 15.6.2, 12.6.2.3).
 *
 * `classifyVariable` answers the question every by-reference use asks about a bound expression: is it a variable
 * (a storage location), and may it be written? `checkWritable` turns the answer into the diagnostic of the context:
 *   assignment           CS0131 not a variable, CS0200 read-only property, CS0191 readonly field, CS1656 foreach/using
 *                        variable, CS8331 readonly reference, CS1604 `this`, CS1612 member of an rvalue struct,
 *                        CS1648 member of a readonly struct field, CS8852 init-only property
 *   ref / out argument   CS1510 not a variable, CS0206 property or indexer, CS0192 readonly field, CS1657 foreach/
 *                        using variable, CS8329 readonly reference
 *   ++ / --              CS1059
 * `argumentRefKind` reads the modifier of an Argument syntax, and `byRefEmission` describes how a back end passes
 * the argument (address of a local, field, element or temporary copy for `in` rvalues).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind, SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

/** The ref kind an argument is written with: 'ref' | 'out' | 'in' | 'none'. */
export function argumentRefKind(argumentSyntax) {
  const k = argumentSyntax.refKindKeyword?.text;
  return k === 'ref' ? RefKind.Ref : k === 'out' ? RefKind.Out : k === 'in' ? RefKind.In : RefKind.None;
}
const inConstructorOf = (context, field) => {
  const m = context.method;
  // A lambda in a constructor runs later: it is not initialization code.
  if (!m || context.isLambda || !context.containingType || !field.containingType) return false;
  if (context.containingType.originalDefinition !== field.containingType.originalDefinition) return false;
  if (context.isFieldInitializer) return context.isStatic === field.isStatic;
  return field.isStatic
    ? m.methodKind === MethodKind.StaticConstructor
    : m.methodKind === MethodKind.Constructor || (m.isInitOnly && m.methodKind === MethodKind.PropertySet);
};
const isRefFieldKind = refKind => refKind === RefKind.Ref || refKind === RefKind.RefReadOnly;
/**
 * @param expression a bound expression  @param {{method,containingType,isFieldInitializer?,isStatic?,inObjectInitializer?}} context
 * @returns {{isVariable:boolean,isWritable:boolean,reason?:string,symbol?:object,detail?:string}}
 *   reasons: 'notVariable','property','readonlyField','readonlyLocal','readonlyRef','this','rvalueStructMember',
 *   'readonlyFieldMember','initOnly','noSetter','methodGroup','constant'
 */
export function classifyVariable(expression, context = {}) {
  const no = (reason, extra = {}) => ({ isVariable: false, isWritable: false, reason, ...extra }),
    yes = { isVariable: true, isWritable: true };
  switch (expression.kind) {
    case 'Local': {
      const l = expression.local;
      if (l.isConst) return no('constant', { symbol: l });
      // `foreach (ref var x in ...)`: the variable cannot be made to denote another element, but the element it
      // denotes is written through it.
      const isRefIteration = l.isForEach && l.refKind === RefKind.Ref;
      if (l.readOnlyReason && !isRefIteration) {
        return { isVariable: true, isWritable: false, reason: 'readonlyLocal', symbol: l, detail: l.readOnlyReason };
      }
      if (l.refKind === RefKind.RefReadOnly)
        return { isVariable: true, isWritable: false, reason: 'readonlyRef', symbol: l, detail: 'variable' };
      return yes;
    }
    case 'Parameter': {
      const p = expression.parameter;
      if (p.refKind === RefKind.In || p.refKind === RefKind.RefReadOnlyParameter)
        return { isVariable: true, isWritable: false, reason: 'readonlyRef', symbol: p, detail: 'variable' };
      return yes;
    }
    // The object an initializer fills in is a fresh variable, also when its type is a struct.
    case 'ImplicitReceiver':
    case 'Discard':
    case 'DeclarationExpression':
    case 'PointerIndirection':
    case 'PointerElementAccess':
      return yes;
    case 'ArrayAccess':
    case 'PointerIndirection':
      return yes;
    case 'This': {
      const t = context.containingType;
      if (!t || t.typeKind !== TypeKind.Struct) return { isVariable: false, isWritable: false, reason: 'this' };
      // `readonly` on a constructor is an error of its own (CS0106); the constructor still assigns the fields, and
      // so does the constructor (and an `init` accessor) of a `readonly struct`: there `this` is being built.
      const method = context.method,
        builds = !!method && (method.isConstructor || method.isInitOnly),
        inReadOnlyMember = !!method?.isReadOnly && !method.isConstructor;
      if ((t.isReadOnly && !builds) || inReadOnlyMember) return { isVariable: true, isWritable: false, reason: 'this' };
      return yes;
    }
    case 'FieldAccess': {
      const f = expression.field;
      if (f.isConst) return no('constant', { symbol: f });
      // A `ref` field (C# 11) denotes the variable it refers to: `readonly ref int` fixes the reference, not that
      // variable, and `ref readonly int` the variable, not the reference. `f = ref x` re-targets the reference, which
      // is what `readonly` on the field forbids, so a ref assignment follows the rules of an ordinary field below.
      if (isRefFieldKind(f.refKind) && !context.isRefAssignment) {
        if (f.refKind === RefKind.Ref) return yes;
        return { isVariable: true, isWritable: false, reason: 'readonlyRef', symbol: { name: f.toDisplayString?.() ?? f.name }, detail: 'field' };
      }
      if (f.isReadOnly && !inConstructorOf(context, f)) return { isVariable: true, isWritable: false, reason: 'readonlyField', symbol: f };
      if (f.isStatic || !expression.receiver || expression.receiver.type?.isValueType !== true) return yes;
      // An instance field of a struct is a variable exactly when the struct expression is.
      // ... and the object an initializer fills in (`new S { X = 1 }`) is a fresh variable whatever created it.
      const isInitializedObject = expression.isInitializerTarget && !expression.receiver.isInitializerTarget,
        outer = isInitializedObject ? yes : classifyVariable(expression.receiver, context);
      if (!outer.isVariable) return no('rvalueStructMember', { symbol: expression.receiver.symbol ?? f, receiver: expression.receiver });
      if (!outer.isWritable)
        return {
          isVariable: true,
          isWritable: false,
          reason: outer.reason === 'readonlyField' ? 'readonlyFieldMember' : outer.reason,
          symbol: outer.symbol,
          detail: outer.detail,
        };
      return yes;
    }
    case 'PropertyAccess':
    case 'IndexerAccess': {
      const p = expression.property;
      if (p.refKind && p.refKind !== RefKind.None) return { isVariable: true, isWritable: p.refKind === RefKind.Ref };
      if (expression.receiver && expression.receiver.type?.isValueType === true && p.setMethod && !context.inObjectInitializer) {
        const outer = classifyVariable(expression.receiver, context);
        if (!outer.isVariable && expression.receiver.kind !== 'This')
          return {
            isVariable: false,
            isWritable: false,
            reason: 'rvalueStructMember',
            isProperty: true,
            symbol: p,
            receiver: expression.receiver,
          };
      }
      // The members of an anonymous type have no setter; a `with` expression gives them their values in a new instance.
      if (!p.setMethod && context.inObjectInitializer && expression.receiver?.kind === 'WithCopy' && p.containingType?.isAnonymousType)
        return { isVariable: false, isWritable: true, isProperty: true, symbol: p };
      if (!p.setMethod) {
        // A get-only auto-property can be assigned in a constructor of its type.
        if (p.isAutoProperty && inConstructorOf(context, p) && (!expression.receiver || expression.receiver.kind === 'This'))
          return { isVariable: false, isWritable: true, isProperty: true };
        return { isVariable: false, isWritable: false, reason: 'noSetter', isProperty: true, symbol: p };
      }
      if (
        p.setMethod.isInitOnly &&
        !context.inObjectInitializer &&
        !(inConstructorOf(context, p) && (!expression.receiver || expression.receiver.kind === 'This'))
      )
        return { isVariable: false, isWritable: false, reason: 'initOnly', isProperty: true, symbol: p };
      return { isVariable: false, isWritable: true, isProperty: true, symbol: p };
    }
    case 'InlineArrayAccess': {
      // An element of an inline array is a variable exactly when the array is, and read-only when the array is.
      const outer = classifyVariable(expression.receiver, context);
      if (!outer.isVariable) return no('notVariable');
      const symbol = outer.symbol ?? { name: expression.receiver.syntax?.toString() ?? 'this' };
      return outer.isWritable ? yes : { isVariable: true, isWritable: false, reason: 'readonlyRef', symbol, detail: 'variable' };
    }
    case 'ImplicitIndexerAccess':
      // `a[^1]` is as assignable as the element or indexer it stands for; a slice (`a[1..2]`) is a value.
      return expression.accessKind === 'index' ? classifyVariable(expression.access, context) : no('notVariable');
    case 'EventAccess':
      return { isVariable: true, isWritable: true };
    case 'DynamicMemberAccess':
    case 'DynamicElementAccess':
      // Whether the member can be written is known only at run time.
      return { isVariable: false, isWritable: true, isProperty: true };
    case 'Call':
      if (expression.method?.refKind && expression.method.refKind !== RefKind.None)
        return { isVariable: true, isWritable: expression.method.refKind === RefKind.Ref };
      return no('notVariable');
    case 'RefConditional':
      return yes;
    case 'MethodGroup':
      return no('methodGroup');
    case 'Tuple':
      return expression.elements.every(e => classifyVariable(e, context).isWritable)
        ? { isVariable: false, isWritable: true, isTuple: true }
        : no('notVariable');
    case 'Conversion':
      if (expression.isImplicitIdentity) return classifyVariable(expression.operand, context);
      return no('notVariable');
    default:
      return no('notVariable');
  }
}
/**
 * The diagnostic for using `expression` where a writable location is needed, or null when it is fine.
 * @param {'assignment'|'ref'|'out'|'increment'|'compound'|'refReadonlyOk'} use
 */
export function checkWritable(expression, use, context = {}) {
  if (expression.type?.isErrorType?.() || expression.hasErrors) return null;
  const c = classifyVariable(expression, context),
    byRef = use === 'ref' || use === 'out';
  if (byRef && c.isProperty) return { code: DiagnosticId.CS0206, args: [] };
  if (c.isWritable && (c.isVariable || !byRef)) return null;
  const name = c.symbol?.toDisplayString?.() ?? c.symbol?.name ?? '';
  switch (c.reason) {
    case 'readonlyLocal':
      return { code: byRef ? DiagnosticId.CS1657 : DiagnosticId.CS1656, args: [c.symbol.name, c.detail] };
    case 'readonlyRef':
      return { code: byRef ? DiagnosticId.CS8329 : DiagnosticId.CS8331, args: [c.detail, c.symbol.name] };
    case 'readonlyField':
      return c.symbol.isStatic ? { code: byRef ? DiagnosticId.CS0199 : DiagnosticId.CS0198, args: [] } : { code: byRef ? DiagnosticId.CS0192 : DiagnosticId.CS0191, args: [] };
    case 'readonlyFieldMember':
      return { code: byRef ? DiagnosticId.CS1649 : DiagnosticId.CS1648, args: [name] };
    case 'this':
      return { code: byRef ? DiagnosticId.CS1605 : DiagnosticId.CS1604, args: ['this'] };
    case 'rvalueStructMember':
      return { code: DiagnosticId.CS1612, args: [describe(c.receiver)] };
    case 'noSetter':
      return { code: DiagnosticId.CS0200, args: [name] };
    case 'initOnly':
      return { code: DiagnosticId.CS8852, args: [name] };
    case 'methodGroup':
      return { code: byRef ? DiagnosticId.CS1657 : DiagnosticId.CS1656, args: [expression.name ?? '', 'method group'] };
    case 'constant':
      if (!byRef) return { code: use === 'increment' ? DiagnosticId.CS1059 : DiagnosticId.CS0131, args: [] };
    // falls through
    default:
      return { code: byRef ? DiagnosticId.CS1510 : use === 'increment' ? DiagnosticId.CS1059 : DiagnosticId.CS0131, args: [] };
  }
}
const describe = e =>
  e?.kind === 'Call'
    ? e.method.toDisplayString()
    : e?.kind === 'PropertyAccess' || e?.kind === 'IndexerAccess'
      ? e.property.toDisplayString()
      : (e?.syntax?.toString?.() ?? 'expression');
/**
 * How a back end passes a by-reference argument: the address of a local slot, argument slot, field, array element or
 * a ref-returning call; an `in` argument that is not a variable (or needs a conversion) is copied to a temporary.
 */
export function byRefEmission(expression, parameterRefKind, context = {}) {
  const c = classifyVariable(expression, context);
  if (parameterRefKind === RefKind.In && (!c.isVariable || expression.kind === 'Conversion')) return { mode: 'temporary' };
  switch (expression.kind) {
    case 'Local':
      return { mode: 'address', of: 'local', symbol: expression.local };
    case 'Parameter':
      return { mode: expression.parameter.refKind === RefKind.None ? 'address' : 'forward', of: 'parameter', symbol: expression.parameter };
    case 'FieldAccess':
      return { mode: 'address', of: expression.field.isStatic ? 'staticField' : 'field', symbol: expression.field };
    case 'ArrayAccess':
      return { mode: 'address', of: 'element' };
    case 'DeclarationExpression':
    case 'Discard':
      return { mode: 'address', of: 'local', symbol: expression.local ?? null };
    case 'This':
      return { mode: 'forward', of: 'this' };
    case 'Call':
    case 'PropertyAccess':
    case 'IndexerAccess':
      return { mode: 'forward', of: 'refReturn' };
    default:
      return { mode: 'temporary' };
  }
}
/** `out` arguments are definitely assigned by the call; `ref` and `in` arguments must be definitely assigned before it. */
export const assignsArgument = refKind => refKind === RefKind.Out;
export const readsArgument = refKind => refKind !== RefKind.Out;
export { SymbolKind };
