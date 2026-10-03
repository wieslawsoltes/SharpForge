import {nativeProperty} from './native-properties.js';
import {Builtins, numericIntrinsicDefinitions, numericTypeName, integerType, float as scalarFloat, decimalParse} from '@sharpforge/bytecode';
import {numeric, implicitNumeric, constantFits} from './numeric.js';

const owners = Object.freeze({
  decimal: 'System.Decimal', Decimal: 'System.Decimal', Math: 'System.Math', Convert: 'System.Convert',
  BitConverter: 'System.BitConverter', Console: 'System.Console', object: 'System.Object', Object: 'System.Object',
});
const ownerNames = new Set(Object.values(owners));
const decimalFields = Object.freeze({Zero: '0', One: '1', MinusOne: '-1',
  MinValue: '-79228162514264337593543950335', MaxValue: '79228162514264337593543950335'});
const pathOf = node => node?.kind === 'Name' ? node.name : node?.kind === 'Member' && pathOf(node.target)
  ? pathOf(node.target) + '.' + node.name : null;

export function scalarType(type) {
  if (type?.endsWith('&')) return scalarType(type.slice(0, -1)) + '&';
  return type === 'System.Object' ? 'object' : type === 'System.String' ? 'string' : numericTypeName(type);
}
export const scalarBuiltinFor = descriptor => Builtins.find(builtin => builtin.numeric === descriptor);

export function scalarStringBuiltin(type) {
  const native = ['nint', 'nuint'].includes(type);
  const descriptor = numericIntrinsicDefinitions.find(item => item.owner === 'System.Convert' && item.name === 'ToString' &&
    scalarType(item.parameters[0]) === (native ? 'object' : type) && (item.formatType ?? null) === (native ? type : null));
  return scalarBuiltinFor(descriptor);
}

function floatingField(type, name) {
  const single = type === 'float';
  const values = {NaN, PositiveInfinity: Infinity, NegativeInfinity: -Infinity,
    MaxValue: single ? 3.4028234663852886e38 : Number.MAX_VALUE,
    MinValue: single ? -3.4028234663852886e38 : -Number.MAX_VALUE, Epsilon: single ? 2 ** -149 : Number.MIN_VALUE};
  return Object.hasOwn(values, name) ? {type, value: scalarFloat(values[name], single ? 'r4' : 'r8')} : null;
}

function consoleParameter(actual, owner) {
  if (owner === 'System.Console' && ['sbyte', 'byte', 'short', 'ushort'].includes(actual)) return 'int';
  if (['nint', 'nuint'].includes(actual)) return 'object';
  if (actual === 'null') return 'string';
  return numeric(actual) || ['bool', 'string'].includes(actual) ? actual : 'object';
}

function better(left, right) {
  return left.parameters.every((type, index) => {
    const from = scalarType(type), to = scalarType(right.parameters[index]);
    return from === to || numeric(from) && numeric(to) && implicitNumeric(from, to);
  });
}

/** Shared semantic queries; explicit class composition adds no methods at module load time. */
export const ScalarQueries = Base => class extends Base {
  scalarStaticOwner(node) {
    const path = pathOf(node);
    if (!path || this.lookup(path.split('.')[0]) || this.c.typeMap.has(path)) return null;
    return owners[path] ?? (ownerNames.has(path) ? path : null);
  }

  scalarConstant(node) {
    if (node?.kind !== 'Member') return null;
    const path = pathOf(node.target);
    if (!path || this.lookup(path.split('.')[0]) || this.c.typeMap.has(path)) return null;
    const type = scalarType(path === 'Decimal' ? 'decimal' : path === 'Single' ? 'float' : path === 'Double' ? 'double' : path);
    if (type === 'decimal' && decimalFields[node.name] !== undefined) return {type, value: decimalParse(decimalFields[node.name])};
    if (['float', 'double'].includes(type)) return floatingField(type, node.name);
    const integer = integerType(type);
    if (!integer || integer.native || !numeric(type) || !['MinValue', 'MaxValue'].includes(node.name)) return null;
    const bits = BigInt(integer.bits);
    const value = node.name === 'MinValue' ? (integer.unsigned ? 0n : -(1n << (bits - 1n))) :
      (1n << (integer.unsigned ? bits : bits - 1n)) - 1n;
    return {type, value: {scalar: type, value: String(value)}};
  }

  scalarAccepts(node, target, actual = this.infer(node)) {
    target = scalarType(target); actual = scalarType(actual);
    if (target === actual) return true;
    if (numeric(target) && numeric(actual)) {
      if (implicitNumeric(actual, target)) return true;
      const constant = this.constant(node);
      return !!constant && constantFits(constant.value, constant.type, target);
    }
    return this.frameworkConversion?.(target, actual) ?? false;
  }

  scalarBinding(node, report = false) {
    const property = nativeProperty(this, node);
    if (property) return property;
    const constructor = node?.kind === 'New';
    if (!constructor && node?.kind !== 'Call') return null;
    let owner = constructor ? (this.c.typeMap.has(node.type) ? null : owners[node.type] ??
      (ownerNames.has(node.type) ? node.type : null)) : this.scalarStaticOwner(node.target?.target);
    let receiver = null;
    if (!owner && !constructor && node.target?.kind === 'Member' && scalarType(this.infer(node.target.target)) === 'decimal') {
      owner = 'System.Decimal'; receiver = node.target.target;
    }
    if (!owner) return null;
    const name = constructor ? '.ctor' : node.target.name;
    let templates = numericIntrinsicDefinitions.filter(item => item.owner === owner && item.name === name &&
      (constructor ? !item.isStatic : item.isStatic === !receiver) && item.parameters.length === node.args.length);
    if ((owner === 'System.Console' || owner === 'System.Convert' && name === 'ToString') && node.args.length === 1) {
      const actual = scalarType(this.infer(node.args[0])), parameter = consoleParameter(actual, owner);
      const format = ['nint', 'nuint'].includes(actual) ? actual : null;
      templates = templates.filter(item => scalarType(item.parameters[0]) === parameter && (item.formatType ?? null) === format);
    }
    if (!templates.length) return null;
    const candidates = templates.filter(item => item.parameters.every((parameter, index) => {
      const argument = node.args[index], target = scalarType(parameter);
      if (target.endsWith('&')) return argument?.kind === 'RefArgument' && argument.modifier === 'out' &&
        scalarType(this.infer(argument.expression)) === target.slice(0, -1);
      return argument?.kind !== 'RefArgument' && this.scalarAccepts(argument, target);
    }));
    const score = item => item.parameters.reduce((sum, type, index) =>
      sum + (scalarType(type) === scalarType(this.infer(node.args[index])) ? 0 : 1), 0);
    candidates.sort((left, right) => score(left) - score(right) || (better(left, right) ? -1 : better(right, left) ? 1 : 0));
    if (!candidates.length) {
      if (report) this.c.report(node, 'CS1501', [owner + '.' + name, node.args.length]);
      return {error: true};
    }
    if (candidates.length > 1 && score(candidates[0]) === score(candidates[1]) && !better(candidates[0], candidates[1])) {
      if (report) this.c.report(node, 'CS0121', [owner + '.' + name, owner + '.' + name]);
      return {error: true};
    }
    return {descriptor: candidates[0], receiver, result: constructor ? scalarType(owner) : scalarType(candidates[0].returnType)};
  }
};
