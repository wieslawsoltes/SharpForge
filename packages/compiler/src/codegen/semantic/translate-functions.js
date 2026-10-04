/**
 * Closure conversion, generation half (SF-A02-T07.3, T07.4) and delegate values (SF-A02-T07.1, T07.2):
 *
 *   lambda            ->  a method of a display class whose fields hold the cells (and `this`) the lambda captures,
 *                         or a static method when it captures nothing; the delegate targets that method
 *   local function    ->  a static method that receives the captured cells (and `this`) as extra parameters
 *   method group      ->  a delegate over the image method; a capturing local function gets a display class thunk
 *   d1 + d2, d1 - d2  ->  D.Combine / D.Remove
 */
import { MethodKind } from '../../symbols/members.js';
import { TypeKind } from '../../symbols/types.js';
import { displayClassName, lambdaMethodName, localFunctionName, thisProxyFieldName } from '../../lowering/generated-names.js';
import { n } from './node-factory.js';
import { Frame } from './frame.js';
import {delegateInfo} from './framework-delegates.js';

/** Class mixin: lambdas, local functions, delegate creation and combination. */
export const FunctionTranslation = Base =>
  class extends Base {
    /** The captures of a lambda node or local function symbol as an ordered list. */
    capturesOf(key) {
      const captures = this.frame.captures.of(key);
      return { variables: captures ? [...captures.variables] : [], usesThis: !!captures?.usesThis && !!this.frame.thisExpr };
    }
    /** A display class holding the cells and the receiver a function captures, plus the expression creating it. */
    displayClass({ variables, usesThis }) {
      const root = this.frame.root,
        record = this.g.program.addClass(displayClassName(root.ordinal, root.closures++)),
        fields = new Map();
      for (const variable of variables) {
        const cell = this.g.cellClass(this.imageType(variable.type, variable.syntax));
        fields.set(variable, { field: this.g.program.addField(record, variable.name, cell.record.name), cell });
      }
      const thisField = usesThis ? this.g.program.addField(record, thisProxyFieldName(), this.frame.thisExpr().legacyType) : null;
      const temp = this.temp(record.name, 'closure'),
        effects = [n.assign(n.local(temp), n.allocate(record))];
      for (const [variable, { field }] of fields) effects.push(n.assign(n.field(n.local(temp), field), this.cellOf(variable)));
      if (thisField) effects.push(n.assign(n.field(n.local(temp), thisField), this.frame.thisExpr()));
      return { record, fields, thisField, temp, effects };
    }
    cellOf(variable) {
      const cell = this.frame.cells.get(variable);
      return cell ? cell() : this.unsupported(`captured variable '${variable.name}' in this position`, variable.syntax);
    }
    /** A frame for code that runs as an instance method of a display class. */
    displayFrame(method, display) {
      const frame = new Frame({ uri: this.frame.uri, method, captures: this.frame.captures, root: this.frame.root });
      const self = () => n.thisReference(display.record.name);
      for (const [variable, { field, cell }] of display.fields) {
        frame.cells.set(variable, () => n.field(self(), field));
        frame.vars.set(variable, () => n.field(n.field(self(), field), cell.value));
      }
      if (display.thisField) frame.thisExpr = () => n.field(self(), display.thisField);
      return frame;
    }
    /** A lambda converted to the delegate type `type`. */
    lambda(node, type, frameworkType = null) {
      if (!node.body) return this.unsupported('a lambda without a bound body', node.syntax);
      const info = delegateInfo(this, type, node.syntax, frameworkType),
        root = this.frame.root,
        name = lambdaMethodName(root.name, root.ordinal, root.lambdas++),
        captures = this.capturesOf(node),
        signature = { returnType: info.returnType, parameters: info.parameters.map((p, i) => ({ ...p, name: node.parameters[i]?.name ?? p.name })) };
      const node0 = n.spanOf(node.syntax, this.frame.uri);
      if (!captures.variables.length && !captures.usesThis) {
        const method = this.g.program.addMethod(this.frame.method.owner, name, { ...signature, isStatic: true, node: node0 }),
          target = this.bodyMethod(method, node.isAsync, node.syntax);
        const frame = new Frame({ uri: this.frame.uri, method: target, captures: this.frame.captures, root });
        this.g.queueBody({ frame, bound: node.body, parameters: node.parameters, returnsValue: target.returnType !== 'void' });
        return this.g.delegates.create(info, method, null);
      }
      const display = this.displayClass(captures),
        method = this.g.program.addMethod(display.record, name, { ...signature, isStatic: false, node: node0 });
      const target = this.bodyMethod(method, node.isAsync, node.syntax);
      this.g.queueBody({
        frame: this.displayFrame(target, display),
        bound: node.body,
        parameters: node.parameters,
        returnsValue: target.returnType !== 'void',
      });
      return n.sequence([display.temp], display.effects, this.g.delegates.create(info, method, n.local(display.temp)));
    }
    /**
     * The image method the body of a function is lowered into: the function's own method, or for an async function
     * the body method of its kickoff (lowering/async/async-methods.js).
     */
    bodyMethod(method, isAsync, syntax) {
      if (!isAsync) return method;
      // Roslyn names the machine of a lambda or local function after its method: `<<Main>b__0_0>d`.
      return this.g.asyncBody(method, { name: `<${method.name}>d`, syntax, uri: this.frame.uri });
    }
    exprLambda(node) {
      return node.boundAs ? this.lambda(node, node.boundAs) : this.unsupported('a lambda without a delegate type', node.syntax);
    }
    // ---- local functions ----
    /** Declares the image method of a local function (visible in its whole block) and queues its body. */
    declareLocalFunction(symbol) {
      const root = this.frame.root;
      if (root.localFunctions.has(symbol)) return;
      const at = symbol.locations?.[0];
      // A generic local function is declared per construction, where it is called (lowering/generics).
      if (this.g.generics.isOpenFunction(symbol)) return;
      if (!symbol.body) this.unsupported('extern methods', at);
      const captures = this.capturesOf(symbol),
        extra = [];
      if (captures.usesThis) extra.push({ name: 'this', type: this.frame.thisExpr().legacyType, isThis: true });
      for (const variable of captures.variables) {
        const cell = this.g.cellClass(this.imageType(variable.type, variable.syntax));
        extra.push({ name: variable.name, type: cell.record.name, variable, cell });
      }
      const declared = this.g.parametersOf(symbol);
      const method = this.g.program.addMethod(this.frame.method.owner, localFunctionName(root.name, symbol.name, root.ordinal, root.locals++), {
        isStatic: true,
        returnType: this.imageType(symbol.returnType, at),
        parameters: [...declared, ...extra.map(e => ({ name: e.name, type: e.type }))],
        node: n.spanOf(symbol.syntax, this.frame.uri),
        hasSource: true,
      });
      root.localFunctions.set(symbol, { method, extra });
      if (symbol.body.binder?.c?.isIterator) {
        // An iterator local function: its kickoff stores the arguments, the receiver and the captured cells.
        const enclosing = this.frame;
        this.g.queueBody({ run: () => this.g.translateIterator(symbol, method, symbol.body, { frame: enclosing, extra }) });
        return;
      }
      const target = this.bodyMethod(method, symbol.isAsync, at);
      const frame = new Frame({ uri: this.frame.uri, method: target, captures: this.frame.captures, root });
      extra.forEach((e, i) => {
        const slot = n.newParameter(e.name, e.type, declared.length + i);
        if (e.isThis) frame.thisExpr = () => n.parameter(slot);
        else {
          frame.cells.set(e.variable, () => n.parameter(slot));
          frame.vars.set(e.variable, () => n.field(n.parameter(slot), e.cell.value));
        }
      });
      this.g.queueBody({ frame, bound: symbol.body, parameters: symbol.parameters, returnsValue: target.returnType !== 'void' });
    }
    localFunction(symbol, syntax) {
      const entry = this.frame.root.localFunctions.get(symbol);
      return entry ?? this.unsupported(`local function '${symbol.name}' in this position`, syntax);
    }
    /** The arguments a local function receives after the declared ones: the receiver and the captured cells. */
    extraArguments(entry) {
      return entry.extra.map(e => (e.isThis ? this.frame.thisExpr() : this.cellOf(e.variable)));
    }
    localFunctionCall(symbol, args, syntax) {
      const entry = this.localFunction(symbol, syntax);
      return n.call(entry.method, null, [...args, ...this.extraArguments(entry)]);
    }
    // ---- method groups ----
    methodGroupDelegate(node, frameworkType = null) {
      const group = node.operand,
        method = node.conversion.method ?? node.method ?? group.selected ?? (group.methods?.length === 1 ? group.methods[0] : null),
        info = delegateInfo(this, node.type, node.syntax, frameworkType);
      if (!method) return this.unsupported('this method group conversion', node.syntax);
      const definition = (method.reducedFrom ?? method).originalDefinition ?? method.reducedFrom ?? method;
      // The receiver of an extension method is its first argument: the delegate binds it (codegen/semantic/delegates.js).
      if (group.isExtensionDelegate) {
        if (!this.g.isSource(definition)) return this.unsupported('delegates over framework methods', node.syntax);
        // The conversion selected the method in its reduced form (without the receiver parameter).
        const record = this.g.methodOf(method.reducedFrom ?? method, node.syntax);
        return this.g.delegates.create(info, record, this.expression(group.receiver), { bindsFirstArgument: true });
      }
      if (definition.methodKind === MethodKind.LocalFunction) return this.localFunctionDelegate(definition, info, node.syntax);
      if (!this.g.isSource(definition)) return this.unsupported('delegates over framework methods', node.syntax);
      const record = this.g.methodOf(method, node.syntax);
      if (record.isStatic) return this.g.delegates.create(info, record, null);
      const receiver = group.receiver ? this.expression(group.receiver) : this.frame.thisExpr?.();
      if (!receiver) return this.unsupported('an instance method group without a receiver', node.syntax);
      return this.g.delegates.create(info, record, receiver);
    }
    /** A local function as a delegate: without captures the method itself, otherwise a display class thunk. */
    localFunctionDelegate(symbol, info, syntax) {
      const entry = this.localFunction(symbol, syntax);
      if (!entry.extra.length) return this.g.delegates.create(info, entry.method, null);
      const display = this.displayClass(this.capturesOf(symbol)),
        root = this.frame.root;
      const thunk = this.g.program.addMethod(display.record, lambdaMethodName(root.name, root.ordinal, root.lambdas++), {
        isStatic: false,
        returnType: entry.method.returnType,
        parameters: entry.method.parameters.slice(0, entry.method.parameters.length - entry.extra.length),
      });
      const self = () => n.thisReference(display.record.name),
        declared = thunk.parameters.map((p, i) => n.parameter(n.newParameter(p.name, p.type, i))),
        captured = entry.extra.map(e => n.field(self(), e.isThis ? display.thisField : display.fields.get(e.variable).field)),
        forward = n.call(entry.method, null, [...declared, ...captured]);
      this.g.addSynthesizedBody(
        thunk,
        n.block([thunk.returnType === 'void' ? n.expressionStatement(forward) : n.returnStatement(forward)]),
      );
      return n.sequence([display.temp], display.effects, this.g.delegates.create(info, thunk, n.local(display.temp)));
    }
    exprDelegateCreation(node) {
      const operand = node.operand;
      if (operand.kind === 'Conversion' || operand.kind === 'Lambda') return this.expression(operand);
      // `new D(existingDelegate)`: the same invocation list.
      return this.expression(operand);
    }
    // ---- combination ----
    /** `a == b` and `a != b` on two delegates of one type compare invocation lists; null when the operands are not that. */
    delegateEquality(node, left, right) {
      // The operands may be converted to the operator's parameter type (System.Delegate or object): the value is the same.
      const written = e => (e.kind === 'Conversion' && e.conversion?.kind === 'ImplicitReference' ? e.operand : e),
        isEquality = node.operator === '==' || node.operator === '!=',
        type = written(node.left).type;
      if (!isEquality || type?.typeKind !== TypeKind.Delegate || !written(node.right).type?.equals?.(type)) return null;
      const equal = this.g.delegates.equal(this.g.delegates.classOf(type, node.syntax), left, right);
      return node.operator === '==' ? equal : n.not(equal);
    }
    /** `a + b` and `a - b` on delegates. */
    delegateArithmetic(node, left, right) {
      const info = this.g.delegates.classOf(node.type, node.syntax);
      if (node.operator === '+') return this.g.delegates.combine(info, left, right);
      if (node.operator === '-') return this.g.delegates.remove(info, left, right);
      return this.unsupported(`operator '${node.operator}' on delegates`, node.syntax);
    }
    /** `d += handler` and `d -= handler` on a delegate variable or field. */
    delegateCompound(node) {
      const info = this.g.delegates.classOf(node.left.type, node.syntax),
        left = node.left,
        combine = (current, value) => (node.operator === '+' ? this.g.delegates.combine(info, current, value) : this.g.delegates.remove(info, current, value));
      if (left.kind === 'FieldAccess' && !left.field.isStatic) {
        // The receiver is evaluated once; the field is read and written through it.
        const record = this.g.fieldOf(left.field, left.syntax),
          receiver = this.once(this.memberReceiver(left), 'target');
        const store = n.assign(n.field(receiver.read(), record), combine(n.field(receiver.read(), record), this.expression(node.right)));
        return n.sequence(receiver.locals, receiver.effects, store);
      }
      if (!['Local', 'Parameter', 'FieldAccess'].includes(left.kind)) return this.unsupported('delegate combination into this target', node.syntax);
      return this.assignStatic(left, n.assign(this.target(left), combine(this.target(left), this.expression(node.right))));
    }
  };
