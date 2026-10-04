/** Managed references preserve the original local, field, or array storage identity. */
import {
  n
} from '../codegen/semantic/node-factory.js';
import {
  managedAddress,
  managedDereference
} from '../codegen/memory-nodes.js';
import {
  lowered
} from './tuples/translate-tuples.js';

export const isByReference = entry => !!entry?.refKind && entry.refKind !== 'none';
const isReadonly = entry => ['in', 'ref readonly', 'ref readonly parameter'].includes(entry?.refKind);

/** Ordinary ref use no longer turns a local into a closure cell. Actual captures are analyzed separately. */
export function markVariablesPassedByReference() {}

export const ByReferenceTranslation = Base => class extends Base {
  declareParameters(parameters, firstOrdinal = 0) {
    const prologue = super.declareParameters(parameters, firstOrdinal);
    parameters.forEach((symbol, index) => {
      if (!isByReference(symbol)) return;
      const type = this.imageType(symbol.type, symbol.syntax);
      const slot = n.newParameter(symbol.name, type + '&', firstOrdinal + index);
      this.frame.vars.set(symbol, () => managedDereference(n.parameter(slot), type));
    });
    return prologue;
  }

  declareVariable(symbol, initializer, syntax = n.hidden) {
    if (!isByReference(symbol)) return super.declareVariable(symbol, initializer, syntax);
    const type = this.imageType(symbol.type, symbol.syntax);
    const local = this.addBlockLocal(n.newLocal(symbol.name, type + '&', syntax, {
      hidden: false
    }));
    this.frame.vars.set(symbol, () => managedDereference(n.local(local), type));
    return [n.declare([
      [local, initializer]
    ], syntax)];
  }

  stmtLocalDeclaration(node) {
    if (!node.declarations.some(declaration => isByReference(declaration.local))) return super.stmtLocalDeclaration(node);
    const statements = node.declarations.flatMap(declaration => isByReference(declaration.local) ?
      this.declareVariable(declaration.local, this.addressOf(declaration.value, isReadonly(declaration.local)), this.span(node.syntax)) :
      [super.stmtLocalDeclaration({
        ...node,
        declarations: [declaration]
      })]);
    return statements.length === 1 ? statements[0] : n.block(statements);
  }

  arguments(node, method) {
    const parameters = method?.parameters ?? [],
      positions = node.mapping?.parameterOf;
    if (!(node.args ?? []).some(isByReference) && !parameters.some(isByReference)) return super.arguments(node, method);
    const args = (node.args ?? []).map((argument, index) => {
      const parameter = parameters[positions ? positions[index] : index];
      if (!isByReference(parameter)) return argument;
      const address = this.referenceArgument(argument, parameter);
      return {
        ...argument,
        refKind: 'none',
        expression: lowered(address, parameter.type, argument.expression.syntax)
      };
    });
    return super.arguments({
      ...node,
      args
    }, method);
  }

  referenceArgument(argument, parameter) {
    const expression = argument.expression;
    if (expression.kind === 'DeclarationExpression') this.declarePending(expression.local);
    if (expression.kind !== 'Discard' && (isByReference(argument) || !isReadonly(parameter)))
      return this.addressOf(expression, isReadonly(parameter));
    // An omitted `in` modifier accepts an rvalue and receives a defensive temporary.
    if (expression.kind !== 'Discard' && !expression.constantValue && ['Local', 'Parameter', 'FieldAccess', 'ArrayAccess', 'IndexerAccess']
      .includes(expression.kind))
      return this.addressOf(expression, true);
    const type = this.imageType(parameter.type, expression.syntax),
      local = this.temp(type, 'reference');
    const value = expression.kind === 'Discard' ? this.defaultValue(type) : this.expression(expression);
    return n.sequence([local], [n.assign(n.local(local), value)], managedAddress(n.local(local), {
      readonly: isReadonly(parameter)
    }));
  }

  addressOf(node, readonly = false) {
    if (node.kind === 'Ref') return this.addressOf(node.operand, readonly);
    if (node.kind === 'RefConditional') return n.conditional(this.expression(node.condition),
      this.addressOf(node.whenTrue, readonly), this.addressOf(node.whenFalse, readonly));
    if (node.kind === 'DeclarationExpression') {
      this.declarePending(node.local);
      return managedAddress(this.variable(node.local, node.syntax), {
        readonly
      });
    }
    return managedAddress(this.expression(node), {
      readonly
    });
  }

  exprRef(node) {
    return this.addressOf(node.operand);
  }
  exprRefConditional(node) {
    return managedDereference(this.addressOf(node));
  }
  exprRefAssignment(node) {
    const target = this.expression(node.left);
    if (target.kind !== 'ManagedDereference') return this.unsupported('ref reassignment to this target', node.syntax);
    return managedDereference(n.assign(target.address, this.addressOf(node.right, isReadonly(node.left.local))));
  }
  stmtReturn(node) {
    return node.isRef ? n.returnStatement(this.addressOf(node.expression), this.span(node.syntax)) : super.stmtReturn(node);
  }
  exprCall(node) {
    const call = super.exprCall(node);
    return isByReference(node.method) ? managedDereference({
      ...call,
      legacyType: this.imageType(node.type, node.syntax) + '&'
    }) : call;
  }
  exprPropertyAccess(node) {
    const value = super.exprPropertyAccess(node);
    return isByReference(node.property) ? managedDereference({
      ...value,
      legacyType: value.legacyType + '&'
    }) : value;
  }
  exprIndexerAccess(node) {
    const value = super.exprIndexerAccess(node);
    return isByReference(node.property) ? managedDereference({
      ...value,
      legacyType: this.imageType(node.type, node.syntax) + '&'
    }) : value;
  }

  /** A ref-returning getter is the location itself and must run once, before the right-hand side. */
  spillReferenceTarget(target, sink) {
    if (!isByReference(target.property)) return null;
    const address = this.addressOf(target), local = this.temp(address.legacyType, 'referenceTarget');
    sink.locals.push(local);
    sink.effects.push(n.assign(n.local(local), address));
    return lowered(managedDereference(n.local(local)), target.type, target.syntax);
  }

  target(node) {
    if (node.kind === 'Lowered' && node.lowered.kind === 'ManagedDereference') return node.lowered;
    if (isByReference(node.property)) return this.expression(node);
    return super.target(node);
  }
};
