/** Managed-pointer adaptation of the shared argument lowering used by closures and Deconstruct. */
import {n} from '../codegen/semantic/node-factory.js';
import {lowered} from './tuples/translate-tuples.js';

export const isByReference = entry => !!entry?.refKind && entry.refKind !== 'none';
const readonly = entry => ['in', 'ref readonly', 'ref readonly parameter'].includes(entry?.refKind);
const indirect = pointer => ({kind: 'ManagedIndirect', legacyType: pointer.legacyType.slice(0, -1),
  isExpression: true, pointer});
const address = (target, immutable = false) => ({kind: 'ManagedAddress', legacyType: target.legacyType + '&',
  isExpression: true, target, readonly: immutable});

/** Uses real managed locations for ref/out/in, including fields, array elements and returned references. */
export const ByReferenceTranslation = Base => class extends Base {
  declareParameters(parameters, firstOrdinal = 0) {
    const prologue = super.declareParameters(parameters, firstOrdinal);
    parameters.forEach((symbol, index) => {
      if (!isByReference(symbol)) return;
      const type = this.imageType(symbol.type, symbol.syntax);
      const slot = n.newParameter(symbol.name, type + '&', firstOrdinal + index);
      this.frame.vars.set(symbol, () => indirect(n.parameter(slot)));
    });
    return prologue;
  }

  declareVariable(symbol, initializer, syntax = n.hidden) {
    if (!isByReference(symbol)) return super.declareVariable(symbol, initializer, syntax);
    const type = this.imageType(symbol.type, symbol.syntax);
    const variable = this.addBlockLocal(n.newLocal(symbol.name, type + '&', syntax, {hidden: false}));
    this.frame.vars.set(symbol, () => indirect(n.local(variable)));
    return [n.declare([[variable, initializer]], syntax)];
  }

  stmtLocalDeclaration(node) {
    if (!node.declarations.some(declaration => isByReference(declaration.local))) return super.stmtLocalDeclaration(node);
    const statements = [];
    for (const declaration of node.declarations) {
      const symbol = declaration.local;
      if (!isByReference(symbol)) {
        statements.push(super.stmtLocalDeclaration({...node, declarations: [declaration]}));
        continue;
      }
      const value = this.addressExpression(declaration.value, readonly(symbol));
      statements.push(...this.declareVariable(symbol, value, this.span(node.syntax)));
    }
    return n.block(statements);
  }

  arguments(node, method) {
    const args = node.args ?? [], parameters = method?.parameters ?? [];
    if (!args.some(isByReference) && !parameters.some(isByReference)) return super.arguments(node, method);
    const positions = node.mapping?.parameterOf, covered = new Set();
    const values = args.map((argument, index) => {
      const parameter = parameters[positions ? positions[index] : index];
      covered.add(parameter);
      if (!isByReference(parameter)) return argument;
      const pointer = this.referenceArgument(argument, parameter);
      return {...argument, refKind: 'none', expression: lowered(pointer, parameter.type, argument.expression.syntax)};
    });
    if (parameters.some(parameter => isByReference(parameter) && !covered.has(parameter))) {
      return this.unsupported('an omitted by-reference argument', node.syntax);
    }
    return super.arguments({...node, args: values}, method);
  }

  referenceArgument(argument, parameter) {
    let expression = argument.expression;
    if (expression.kind === 'DeclarationExpression') {
      this.declarePending(expression.local);
      expression = {...expression, kind: 'Local'};
    }
    if (expression.kind === 'Discard' || parameter.refKind === 'in' && !isByReference(argument)) {
      const type = this.imageType(parameter.type, expression.syntax), temp = this.temp(type, 'reference');
      const value = expression.kind === 'Discard' ? this.defaultValue(type) : this.expression(expression);
      return n.sequence([temp], [n.assign(n.local(temp), value)], address(n.local(temp), readonly(parameter)));
    }
    return this.addressExpression(expression, readonly(parameter));
  }

  addressExpression(node, immutable = false) {
    if (node.kind === 'Ref') return this.addressExpression(node.operand, immutable);
    if (node.kind === 'RefConditional') {
      const left = this.addressExpression(node.whenTrue, immutable);
      return n.conditional(this.expression(node.condition), left, this.addressExpression(node.whenFalse, immutable), left.legacyType);
    }
    const target = this.target(node);
    return address(target, immutable);
  }

  exprRef(node) { return this.addressExpression(node.operand); }
  exprRefConditional(node) { return indirect(this.addressExpression(node)); }

  stmtReturn(node) {
    return node.isRef ? n.returnStatement(this.addressExpression(node.expression), this.span(node.syntax)) : super.stmtReturn(node);
  }

  expressionBody(expression, isReturn, syntax) {
    if (isReturn && this.frame.method.returnType.endsWith('&')) {
      return this.withPending(n.returnStatement(this.addressExpression(expression), this.span(syntax)));
    }
    return super.expressionBody(expression, isReturn, syntax);
  }

  exprCall(node) {
    const value = super.exprCall(node);
    return isByReference(node.method) ? indirect(value) : value;
  }

  exprPropertyAccess(node) {
    if (!isByReference(node.property)) return super.exprPropertyAccess(node);
    const method = this.g.methodOf(node.property.getMethod, node.syntax);
    return indirect(n.call(method, node.property.isStatic ? null : this.memberReceiver(node), []));
  }

  exprIndexerAccess(node) {
    return isByReference(node.property) ? indirect(super.exprIndexerAccess(node)) : super.exprIndexerAccess(node);
  }

  target(node) {
    if (node.kind === 'Call' && isByReference(node.method) ||
        ['PropertyAccess', 'IndexerAccess'].includes(node.kind) && isByReference(node.property)) return this.expression(node);
    return super.target(node);
  }

  exprRefAssignment(node) {
    return this.exprAssignment({...node, isRef: true});
  }

  exprAssignment(node) {
    if (node.isRef) {
      const target = this.target(node.left);
      if (target.kind !== 'ManagedIndirect') return this.unsupported('reference reassignment of this location', node.syntax);
      return indirect(n.assign(target.pointer, this.addressExpression(node.right)));
    }
    if (node.left.kind === 'IndexerAccess' && isByReference(node.left.property)) {
      return n.assign(this.target(node.left), this.expression(node.right));
    }
    return super.exprAssignment(node);
  }
};
