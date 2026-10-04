import {frameworkType} from '@sharpforge/framework';
import {numericTypeId, Op} from '@sharpforge/bytecode';
import {CilError} from '../binary.js';
import {emitProjectInstruction} from './project-references.js';
import {emitScalarInstruction, emitScalarConversion} from '../scalar-emission.js';

export {prepareProjectReferenceTypes, prepareProjectReferenceMembers} from './project-references.js';
export {scalarMetadataType} from '../scalar-emission.js';

export const isValue = type => numericTypeId(type) !== undefined || type === 'bool'
  || ['enum', 'value'].includes(frameworkType(type)?.kind);

/** Translate source exception regions before assigning method-body branch offsets. */
export function handlerLayout(method) {
  return method.handlers.map(handler => {
    if (handler.kind === 'finally') return {...handler, handlerEndPc: handler.handlerEnd};
    const after = method.code[handler.end * 3] === Op.JUMP ? method.code[handler.end * 3 + 1] : null;
    if (after === null) throw new CilError('Unsupported exception region layout');
    const siblings = method.handlers.filter(other => other.start === handler.start && other.end === handler.end
      && other.target > handler.target).sort((first, second) => first.target - second.target);
    return {...handler, handlerEndPc: siblings[0]?.target ?? after};
  });
}

/** Compose project and scalar instruction emission with the existing method conversion/branch state. */
export function createInstructionProfile(context, writer, {getScratch, handlers, patches}) {
  const needs = (from, to) => from !== to && ((numericTypeId(to) !== undefined && numericTypeId(from) !== undefined)
    || (to === 'object' && isValue(from)));
  function convert(from, to) {
    if (from === to || from === 'null') return;
    if (numericTypeId(to) !== undefined && numericTypeId(from) !== undefined) {
      emitScalarConversion(writer, context, from, to);
    } else if (to === 'object' && isValue(from)) writer.op('box', context.resolveType(from));
  }
  function adapt(from, to) {
    if (from.length !== to.length) throw new CilError('Invalid conversion stack shape');
    if (!from.some((type, index) => needs(type, to[index]))) return;
    const lowest = from.findIndex((type, index) => needs(type, to[index]));
    const slots = new Map();
    for (let index = from.length - 1; index > lowest; index--) {
      const slot = getScratch(from[index], index);
      slots.set(index, slot);
      writer.local('stloc', slot);
    }
    convert(from[lowest], to[lowest]);
    for (let index = lowest + 1; index < from.length; index++) {
      writer.local('ldloc', slots.get(index));
      convert(from[index], to[index]);
    }
  }
  function relative(name, target) {
    const offset = writer.length;
    writer.op(name, 0);
    patches.push({at: offset + 1, end: offset + 5, target});
  }
  function zones(offset) {
    const result = [];
    handlers.forEach((handler, index) => {
      if (offset >= handler.start && offset <= handler.end) result.push('t' + index);
      if (offset >= handler.target && offset < handler.handlerEndPc) result.push('h' + index);
    });
    return result;
  }
  const leaves = (offset, target) => {
    const targetZones = zones(target);
    return zones(offset).some(zone => !targetZones.includes(zone));
  };
  const emit = (operation, argument, count, input) => emitProjectInstruction(context, operation,
    {writer, input, argument, count, adapt, convert, scratch: getScratch})
    || emitScalarInstruction(writer, context, {op: operation, a: argument, b: count});
  return {needs, convert, adapt, relative, zones, leaves, emit};
}
