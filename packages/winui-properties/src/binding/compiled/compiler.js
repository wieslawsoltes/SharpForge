import {BindingBase} from '../binding.js';
import {validateCompiledBindingDescriptor} from './descriptor.js';
import {parseCompiledBindingExpression, qualifiedName, CompiledBindingCompileError} from './syntax.js';

const rootExpression = () => ({kind: 'path', steps: []});

/** An object-writer compiler capability creates the typed controller once its target/root are known. */
export class CompiledBindingDefinition extends BindingBase {
  constructor(attach, markup) {
    super();
    if (typeof attach !== 'function') throw new TypeError('Compiled binding attachment capability is required');
    this.attach = attach;
    this.markup = markup;
    Object.freeze(this);
  }
  get reconstructible() { return true; }
}

/** The compiler may inspect the resolved result type when constructing converter calls. */
export function compileBindingExpression(text, options) {
  return new TokenExpressionCompiler(options).compile(parseCompiledBindingExpression(text));
}

/** Resolve names exactly once at compilation. The returned descriptor contains only data and metadata tokens. */
export function compileBindingDescriptor(options) {
  const eventTypes = options.eventTypes ?? ['object', 'object'];
  const contextTypes = {...options.contextTypes, ...(options.kind === 'event' ? {sender: eventTypes[0], eventArgs: eventTypes[1]} : {})};
  const compiler = new TokenExpressionCompiler({...options, contextTypes});
  let expression = parseCompiledBindingExpression(options.expression ?? '');
  if (options.kind === 'event' && expression.kind !== 'call') {
    expression = compiler.eventCall(expression, eventTypes);
  }
  const compiled = compiler.compile(expression);
  const descriptor = {version: 1, kind: options.kind ?? 'property', mode: options.mode ?? 'OneTime', target: options.target,
    expression: compiled.expression};
  if (options.sourceTypeToken !== undefined) descriptor.sourceType = options.sourceTypeToken;
  if (options.targetTypeToken !== undefined) descriptor.targetType = options.targetTypeToken;
  if (options.phase !== undefined) descriptor.phase = options.phase;
  if (options.converter) {
    const converter = new TokenExpressionCompiler({...options, contextTypes: {...contextTypes, value: compiled.type}});
    descriptor.converter = converter.compile(parseCompiledBindingExpression(options.converter)).expression;
  }
  if (options.convertBack) {
    const backward = new TokenExpressionCompiler({...options, contextTypes: {...contextTypes, value: options.targetValueType ?? 'object'}});
    descriptor.convertBack = backward.compile(parseCompiledBindingExpression(options.convertBack)).expression;
  }
  if (options.bindBack) {
    let syntax = parseCompiledBindingExpression(options.bindBack);
    if (syntax.kind !== 'call') syntax = {kind: 'call', method: syntax, arguments: [{kind: 'identifier', name: 'value'}]};
    const backward = new TokenExpressionCompiler({...options, contextTypes: {...contextTypes, value: options.targetValueType ?? 'object'}});
    descriptor.bindBack = backward.compile(syntax).expression;
  }
  if (descriptor.mode === 'TwoWay' && !descriptor.bindBack && compiled.member?.writable === false) {
    throw new CompiledBindingCompileError('SFXB006', 'TwoWay source member is read-only');
  }
  if (descriptor.kind === 'event' && compiled.type !== 'void' || descriptor.kind === 'property' && compiled.type === 'void') {
    throw new CompiledBindingCompileError('SFXB004', 'Expression return type does not match its binding kind');
  }
  if (descriptor.kind === 'load' && !descriptor.converter && compiled.type !== 'bool') {
    throw new CompiledBindingCompileError('SFXB004', 'x:Load requires a Boolean expression');
  }
  return validateCompiledBindingDescriptor(descriptor);
}

class TokenExpressionCompiler {
  constructor({symbols, rootType, contextTypes = {}}) {
    if (!symbols || typeof symbols.member !== 'function' || typeof symbols.method !== 'function' || !rootType) {
      throw new CompiledBindingCompileError('SFXB003', 'Typed metadata symbols are required');
    }
    this.symbols = symbols;
    this.rootType = rootType;
    this.contextTypes = contextTypes;
  }
  fault(code, message, node) { throw new CompiledBindingCompileError(code, message, node?.position ?? 0); }
  type(node) {
    const name = qualifiedName(node);
    if (!name || name === 'this') return null;
    const first = name.split('.')[0];
    if (Object.hasOwn(this.contextTypes, first) || this.symbols.member(this.rootType, first)) return null;
    return this.symbols.type?.(name) ?? null;
  }
  compile(node) {
    const type = this.type(node);
    if (type) return {type: type.name ?? type, staticType: true, expression: rootExpression()};
    if (node.kind === 'constant') {
      const type = node.value === null ? 'null' : typeof node.value === 'number' ? Number.isInteger(node.value) ? 'int' : 'double'
        : typeof node.value === 'boolean' ? 'bool' : 'string';
      return {type, expression: {kind: 'constant', value: node.value}};
    }
    if (node.kind === 'identifier') {
      if (node.name === 'this') return {type: this.rootType, expression: rootExpression()};
      if (Object.hasOwn(this.contextTypes, node.name)) return {type: this.contextTypes[node.name], expression: {kind: 'context', name: node.name}};
      return this.property({type: this.rootType, expression: rootExpression()}, node.name, node);
    }
    if (node.kind === 'member') return this.property(this.compile(node.receiver), node.name, node);
    if (node.kind === 'index') return this.property(this.compile(node.receiver), 'Item', node, node.arguments.map(argument => this.compile(argument)));
    if (node.kind === 'call') return this.call(node);
    if (node.kind === 'cast') {
      const target = this.symbols.type?.(node.type);
      if (!target?.token) this.fault('SFXB004', 'Cast type has no metadata token', node);
      const value = this.compile(node.value);
      return {type: target.name, expression: {kind: 'cast', token: target.token, value: value.expression}};
    }
    this.fault('SFXB002', 'Unsupported compiled expression', node);
  }
  property(receiver, name, node, argumentsList = []) {
    const member = this.symbols.member(receiver.type, name, {staticOnly: !!receiver.staticType, arguments: argumentsList.map(argument => argument.type)});
    if (!member?.token || member.readable === false) this.fault('SFXB003', 'Readable member metadata token is unavailable', node);
    const step = {token: member.token};
    if (node.conditional) step.nullConditional = true;
    if (argumentsList.length) step.arguments = argumentsList.map(argument => argument.expression);
    const prior = receiver.expression;
    const expression = prior.kind === 'path' ? {...prior, steps: [...prior.steps, step]} : {kind: 'path', root: prior, steps: [step]};
    return {type: member.type, member, expression};
  }
  methodParts(node) {
    if (node.kind === 'identifier') return {receiver: {type: this.rootType, expression: rootExpression()}, name: node.name};
    if (node.kind === 'member') return {receiver: this.compile(node.receiver), name: node.name, conditional: node.conditional};
    this.fault('SFXB005', 'A compiled call requires a declared method', node);
  }
  call(node) {
    const {receiver, name, conditional} = this.methodParts(node.method);
    const args = node.arguments.map(argument => this.compile(argument));
    const method = this.symbols.method(receiver.type, name, args.map(argument => argument.type), {staticOnly: !!receiver.staticType});
    if (!method?.token) this.fault('SFXB005', 'Method token or compatible overload is unavailable', node);
    const expression = {kind: 'call', token: method.token, arguments: args.map(argument => argument.expression)};
    if (!method.isStatic) expression.receiver = receiver.expression;
    if (conditional) expression.nullConditional = true;
    return {type: method.returnType, expression};
  }
  eventCall(node, eventTypes) {
    const {receiver, name} = this.methodParts(node);
    const empty = this.symbols.method(receiver.type, name, [], {staticOnly: !!receiver.staticType});
    const event = this.symbols.method(receiver.type, name, eventTypes, {staticOnly: !!receiver.staticType});
    if (empty && event) this.fault('SFXB005', 'Event method overload is ambiguous; specify its arguments', node);
    if (!empty && !event) this.fault('SFXB005', 'Event method signature is unavailable', node);
    return {kind: 'call', method: node, arguments: empty ? [] : [
      {kind: 'identifier', name: 'sender'}, {kind: 'identifier', name: 'eventArgs'}
    ]};
  }
}
