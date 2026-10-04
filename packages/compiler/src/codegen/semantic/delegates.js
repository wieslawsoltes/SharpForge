/**
 * Delegates without an indirect call instruction (SF-A02-T07.1). The IR calls methods by id only, so a delegate
 * type becomes an image class whose instances name their target by number:
 *
 *   class D { int method; D next; C1 target_C1; C2 target_C2; ... }      // one node per target, `next` chains multicast
 *
 * A delegate over an extension method in instance form (`text.Length2`, C# 3) binds its receiver as the first argument
 * of a static method: the receiver is stored in a target field of its own type and passed first by `Invoke`.
 *   static R D.Invoke(D d, args)   switches on `method` for every node of the chain, in order
 *   static D D.Combine(D a, D b)   a's nodes followed by b's (nodes are immutable, so b's are shared)
 *   static D D.Remove(D a, D b)    a without the last occurrence of b's invocation list
 *
 * The set of targets of a delegate type is known only when the whole program has been lowered, so the bodies of these
 * methods are built at the end (`finish`). Targets are compared by method number and receiver, which gives .NET's
 * delegate identity for `-=`.
 */
import { n } from './node-factory.js';
import { loweredDelegateName } from './ui-class-profile.js';
import { typeNameText } from '../../lowering/generics/instantiation-names.js';
import { isScalarType, scalarDefault } from '../scalar-values.js';

export class DelegateClasses {
  /** @param generator `{program, types}`: the program model and the type mapper */
  constructor(generator) {
    this.generator = generator;
    this.program = generator.program;
    this.byType = new Map();
    this.all = [];
  }
  /** The image class of a delegate type, declared on first use. */
  classOf(type, syntax = null) {
    // In a generic body the delegate type is the one of the construction being lowered (`Func<T, int>` of `T = string`).
    type = this.generator.generics.closed(type, syntax);
    // Constructed types (`Func<int, int>`) are distinct symbols that compare equal: one class per distinct type.
    let info = this.byType.get(type) ?? this.all.find(known => known.type.equals?.(type));
    if (info) {
      this.byType.set(type, info);
      return info;
    }
    const invoke = type.delegateInvokeMethod;
    if (!invoke) return this.generator.unsupported(`delegate type '${type.toDisplayString()}'`, syntax);
    // The image reads `Name<...>` as a framework generic and `,` as an argument separator (also inside the element
    // type of an array), so the class is named like a construction: `System.Func{int;string}`.
    const contractName = this.generator.bridge.registryName(type) ?? typeNameText(type);
    const record = this.program.addClass(loweredDelegateName(contractName));
    info = { type, record, targets: new Map(), thunks: [], helpers: new Map() };
    // Registered before the signature is mapped: a delegate type may mention itself.
    this.byType.set(type, info);
    this.all.push(info);
    info.methodField = this.program.addField(record, 'method', 'int');
    info.nextField = this.program.addField(record, 'next', record.name);
    info.parameters = invoke.parameters.map(p => {
      if (p.refKind && p.refKind !== 'none') this.generator.unsupported('ref, out and in parameters', syntax);
      return { name: p.name, type: this.generator.types.imageType(p.type, syntax) };
    });
    info.returnType = this.generator.types.imageType(invoke.returnType, syntax);
    info.invoke = this.program.addMethod(record, 'Invoke', {
      isStatic: true,
      returnType: info.returnType,
      parameters: [{ name: 'delegate', type: record.name }, ...info.parameters],
    });
    record.delegateContract = contractName;
    record.delegateInvoke = info.invoke.id;
    if (this.generator.bridge.registryName(type)) {
      info.frameworkInvoke = this.program.addMethod(record, '<framework-invoke>', {
        isStatic: false, returnType: info.returnType, parameters: info.parameters
      });
      record.frameworkInvoke = info.frameworkInvoke.id;
    }
    return info;
  }
  /**
   * A new delegate over an image method; `receiver` is the target expression for instance methods, and with
   * `bindsFirstArgument` the value bound as the first argument of a static method (an extension method's receiver).
   */
  create(info, method, receiver, { bindsFirstArgument = false, virtualSymbol = null } = {}) {
    let thunk = info.thunks.find(t => t.method === method && t.bindsFirstArgument === bindsFirstArgument && !!t.virtualSymbol === !!virtualSymbol);
    if (!thunk) {
      thunk = { id: info.thunks.length + 1, method, targetField: null, bindsFirstArgument, virtualSymbol };
      if (bindsFirstArgument) thunk.targetField = this.targetField(info, { name: method.parameters[0].type });
      else if (!method.isStatic) thunk.targetField = this.targetField(info, method.owner);
      info.thunks.push(thunk);
    }
    const temp = n.newLocal('$delegate', info.record.name);
    const effects = [
      n.assign(n.local(temp), n.allocate(info.record)),
      n.assign(n.field(n.local(temp), info.methodField), n.literal(thunk.id, 'int')),
    ];
    if (thunk.targetField) effects.push(n.assign(n.field(n.local(temp), thunk.targetField), receiver));
    return n.sequence([temp], effects, n.local(temp));
  }
  /** The field holding targets of the image type `owner.name` (one field per type, shared by its methods). */
  targetField(info, owner) {
    let field = info.targets.get(owner.name);
    if (!field) {
      field = this.program.addField(info.record, 'target' + info.targets.size, owner.name);
      info.targets.set(owner.name, field);
    }
    return field;
  }
  invoke(info, delegate, args) {
    return n.call(info.invoke, null, [delegate, ...args]);
  }
  combine(info, left, right) {
    return n.call(this.helper(info, 'Combine', 2), null, [left, right]);
  }
  /** Delegate equality: the same invocation list (methods and targets), not the same object. */
  equal(info, left, right) {
    return n.call(this.helper(info, 'Equal', 2, 'bool'), null, [left, right]);
  }
  remove(info, left, right) {
    return n.call(this.helper(info, 'Remove', 2), null, [left, right]);
  }
  /** A static helper `D name(D, D)` (or a helper it needs), declared on first use. */
  helper(info, name, arity, returnType = info.record.name, extra = []) {
    let method = info.helpers.get(name);
    if (!method) {
      const parameters = Array.from({ length: arity }, (_, i) => ({ name: 'ab'[i], type: info.record.name }));
      method = this.program.addMethod(info.record, name, { isStatic: true, returnType, parameters: [...parameters, ...extra] });
      info.helpers.set(name, method);
    }
    return method;
  }
  /** Builds the bodies of every synthesized delegate method: `[{method, body}]`. */
  finish() {
    const bodies = [];
    // Helpers declare the helpers they call, so the list grows while it is walked.
    for (const info of this.all) {
      bodies.push({ method: info.invoke, body: this.invokeBody(info) });
      if (info.frameworkInvoke) {
        const args = info.parameters.map((p, i) => n.parameter(n.newParameter(p.name, p.type, i)));
        const call = this.invoke(info, n.thisReference(info.record.name), args);
        const statement = info.returnType === 'void' ? n.expressionStatement(call) : n.returnStatement(call);
        bodies.push({method: info.frameworkInvoke, body: n.block([statement])});
      }
      const built = new Set();
      for (let more = true; more; ) {
        more = false;
        for (const [name, method] of [...info.helpers]) {
          if (built.has(name)) continue;
          built.add(name);
          bodies.push({ method, body: this.helperBody(info, name) });
          more = true;
        }
      }
    }
    return bodies;
  }
  invokeBody(info) {
    const type = info.record.name,
      delegate = n.newParameter('delegate', type, 0),
      current = n.newLocal('current', type),
      isVoid = info.returnType === 'void',
      result = isVoid ? null : n.newLocal('result', info.returnType);
    const args = info.parameters.map((p, i) => n.parameter(n.newParameter(p.name, p.type, i + 1)));
    let dispatch = null;
    for (const thunk of [...info.thunks].reverse()) {
      const receiver = thunk.targetField ? n.field(n.local(current), thunk.targetField) : null;
      const invocation = thunk.virtualSymbol ? this.generator.ui.invoke(thunk.virtualSymbol, receiver, args) :
        thunk.bindsFirstArgument ? n.call(thunk.method, null, [receiver, ...args]) : n.call(thunk.method, receiver, args);
      dispatch = n.ifStatement(
        n.equals(n.field(n.local(current), info.methodField), n.literal(thunk.id, 'int')),
        n.expressionStatement(isVoid ? invocation : n.assign(n.local(result), invocation)),
        dispatch,
      );
    }
    const loop = n.whileStatement(
      n.notEquals(n.local(current), n.nullLiteral(type)),
      n.block([dispatch ?? n.noOp(), n.expressionStatement(n.assign(n.local(current), n.field(n.local(current), info.nextField)))]),
    );
    const statements = [
      // Invoking a null delegate faults here, on the field read.
      n.expressionStatement(n.field(n.parameter(delegate), info.methodField)),
      n.declare([[current, n.parameter(delegate)]]),
    ];
    if (result) statements.push(n.declare([[result, n.literal(defaultOf(info.returnType), info.returnType)]]));
    statements.push(loop);
    if (result) statements.push(n.returnStatement(n.local(result)));
    return n.block(statements, [current, ...(result ? [result] : [])]);
  }
  helperBody(info, name) {
    const type = info.record.name,
      a = n.parameter(n.newParameter('a', type, 0)),
      b = n.parameter(n.newParameter('b', type, 1)),
      isNull = e => n.equals(e, n.nullLiteral(type)),
      next = e => n.field(e, info.nextField);
    switch (name) {
      case 'Combine': {
        const copy = n.newLocal('copy', type);
        return n.block(
          [
            n.ifStatement(isNull(a), n.returnStatement(b)),
            n.ifStatement(isNull(b), n.returnStatement(a)),
            n.declare([[copy, n.call(this.helper(info, 'Clone', 1), null, [a])]]),
            n.expressionStatement(n.assign(next(n.local(copy)), n.call(this.helper(info, 'Combine', 2), null, [next(a), b]))),
            n.returnStatement(n.local(copy)),
          ],
          [copy],
        );
      }
      case 'Clone': {
        const copy = n.newLocal('copy', type);
        const copyField = f => n.expressionStatement(n.assign(n.field(n.local(copy), f), n.field(a, f)));
        return n.block(
          [
            n.declare([[copy, n.allocate(info.record)]]),
            copyField(info.methodField),
            ...[...info.targets.values()].map(copyField),
            n.returnStatement(n.local(copy)),
          ],
          [copy],
        );
      }
      case 'Same': {
        let same = n.equals(n.field(a, info.methodField), n.field(b, info.methodField));
        for (const f of info.targets.values()) same = n.logicalAnd(same, n.equals(n.field(a, f), n.field(b, f)));
        return n.block([n.returnStatement(same)]);
      }
      case 'StartsWith':
        // True when the chain `a` starts with every node of the chain `b`.
        return n.block([
          n.ifStatement(isNull(b), n.returnStatement(n.literal(true, 'bool'))),
          n.ifStatement(isNull(a), n.returnStatement(n.literal(false, 'bool'))),
          n.ifStatement(
            n.not(n.call(this.helper(info, 'Same', 2, 'bool'), null, [a, b])),
            n.returnStatement(n.literal(false, 'bool')),
          ),
          n.returnStatement(n.call(this.helper(info, 'StartsWith', 2, 'bool'), null, [next(a), next(b)])),
        ]);
      case 'Equal':
        // Both chains end together and agree node by node.
        return n.block([
          n.ifStatement(isNull(a), n.returnStatement(isNull(b))),
          n.ifStatement(isNull(b), n.returnStatement(n.literal(false, 'bool'))),
          n.ifStatement(
            n.not(n.call(this.helper(info, 'Same', 2, 'bool'), null, [a, b])),
            n.returnStatement(n.literal(false, 'bool')),
          ),
          n.returnStatement(n.call(this.helper(info, 'Equal', 2, 'bool'), null, [next(a), next(b)])),
        ]);
      case 'Remove':
        return this.removeBody(info, a, b);
      case 'Skip':
        return this.skipBody(info, a);
      default:
        throw new Error(`Unknown delegate helper '${name}'`);
    }
  }
  /** `a` without the last occurrence of the invocation list `b`. */
  removeBody(info, a, b) {
    const type = info.record.name,
      isNull = e => n.equals(e, n.nullLiteral(type)),
      next = e => n.field(e, info.nextField),
      int = v => n.literal(v, 'int');
    const current = n.newLocal('current', type),
      index = n.newLocal('index', 'int'),
      last = n.newLocal('last', 'int'),
      count = n.newLocal('count', 'int');
    const startsWith = this.helper(info, 'StartsWith', 2, 'bool'),
      skip = this.helper(info, 'Skip', 1, type, [
        { name: 'at', type: 'int' },
        { name: 'count', type: 'int' },
      ]);
    const advance = variable => n.expressionStatement(n.assign(n.local(variable), next(n.local(variable))));
    const bump = variable => n.expressionStatement(n.increment('++', n.local(variable), true));
    return n.block(
      [
        n.ifStatement(isNull(a), n.returnStatement(a)),
        n.ifStatement(isNull(b), n.returnStatement(a)),
        n.declare([
          [current, a],
          [index, int(0)],
          [last, int(-1)],
          [count, int(0)],
        ]),
        n.whileStatement(
          n.notEquals(n.local(current), n.nullLiteral(type)),
          n.block([
            n.ifStatement(
              n.call(startsWith, null, [n.local(current), b]),
              n.expressionStatement(n.assign(n.local(last), n.local(index))),
            ),
            advance(current),
            bump(index),
          ]),
        ),
        n.ifStatement(n.binary('<', n.local(last), int(0), 'bool'), n.returnStatement(a)),
        n.expressionStatement(n.assign(n.local(current), b)),
        n.whileStatement(n.notEquals(n.local(current), n.nullLiteral(type)), n.block([advance(current), bump(count)])),
        n.returnStatement(n.call(skip, null, [a, n.local(last), n.local(count)])),
      ],
      [current, index, last, count],
    );
  }
  /** `a` with `count` nodes dropped starting at position `at` (the nodes before `at` are copied). */
  skipBody(info, a) {
    const type = info.record.name,
      at = n.parameter(n.newParameter('at', 'int', 1)),
      count = n.parameter(n.newParameter('count', 'int', 2)),
      next = e => n.field(e, info.nextField),
      int = v => n.literal(v, 'int');
    const skip = this.helper(info, 'Skip', 1),
      copy = n.newLocal('copy', type);
    return n.block(
      [
        n.ifStatement(
          n.equals(at, int(0)),
          n.block([
            n.ifStatement(n.equals(count, int(0)), n.returnStatement(a)),
            n.returnStatement(n.call(skip, null, [next(a), int(0), n.binary('-', count, int(1), 'int')])),
          ]),
        ),
        n.declare([[copy, n.call(this.helper(info, 'Clone', 1), null, [a])]]),
        n.expressionStatement(n.assign(next(n.local(copy)), n.call(skip, null, [next(a), n.binary('-', at, int(1), 'int'), count]))),
        n.returnStatement(n.local(copy)),
      ],
      [copy],
    );
  }
}

function defaultOf(type) {
  return isScalarType(type) ? scalarDefault(type) : type === 'bool' ? false : null;
}
