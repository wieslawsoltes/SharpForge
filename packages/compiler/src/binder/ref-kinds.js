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
      if (l.readOnlyReason) return { isVariable: true, isWritable: false, reason: 'readonlyLocal', symbol: l, detail: l.readOnlyReason };
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
    case 'Discard':
    case 'DeclarationExpression':
      return yes;
    case 'ArrayAccess':
    case 'PointerIndirection':
      return yes;
    case 'This': {
      const t = context.containingType;
      if (!t || t.typeKind !== TypeKind.Struct) return { isVariable: false, isWritable: false, reason: 'this' };
      if (t.isReadOnly || context.method?.isReadOnly) return { isVariable: true, isWritable: false, reason: 'this' };
      return yes;
    }
    case 'FieldAccess': {
      const f = expression.field;
      if (f.isConst) return no('constant', { symbol: f });
      if (f.isReadOnly && !inConstructorOf(context, f)) return { isVariable: true, isWritable: false, reason: 'readonlyField', symbol: f };
      if (f.isStatic || !expression.receiver || expression.receiver.type?.isValueType !== true) return yes;
      // An instance field of a struct is a variable exactly when the struct expression is.
      const outer = classifyVariable(expression.receiver, context);
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
    case 'EventAccess':
      return { isVariable: true, isWritable: true };
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
  if (byRef && c.isProperty) return { code: 'CS0206', args: [] };
  if (c.isWritable && (c.isVariable || !byRef)) return null;
  const name = c.symbol?.toDisplayString?.() ?? c.symbol?.name ?? '';
  switch (c.reason) {
    case 'readonlyLocal':
      return { code: byRef ? 'CS1657' : 'CS1656', args: [c.symbol.name, c.detail] };
    case 'readonlyRef':
      return { code: byRef ? 'CS8329' : 'CS8331', args: [c.detail, c.symbol.name] };
    case 'readonlyField':
      return c.symbol.isStatic ? { code: byRef ? 'CS0199' : 'CS0198', args: [] } : { code: byRef ? 'CS0192' : 'CS0191', args: [] };
    case 'readonlyFieldMember':
      return { code: byRef ? 'CS1649' : 'CS1648', args: [name] };
    case 'this':
      return { code: byRef ? 'CS1605' : 'CS1604', args: ['this'] };
    case 'rvalueStructMember':
      return { code: 'CS1612', args: [describe(c.receiver)] };
    case 'noSetter':
      return { code: 'CS0200', args: [name] };
    case 'initOnly':
      return { code: 'CS8852', args: [name] };
    case 'methodGroup':
      return { code: byRef ? 'CS1657' : 'CS1656', args: [expression.name ?? '', 'method group'] };
    case 'constant':
      if (!byRef) return { code: use === 'increment' ? 'CS1059' : 'CS0131', args: [] };
    // falls through
    default:
      return { code: byRef ? 'CS1510' : use === 'increment' ? 'CS1059' : 'CS0131', args: [] };
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
