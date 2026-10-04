import {Op} from '@sharpforge/bytecode';

/** Bind argv into a compiler-owned source bootstrap before VM creation or CIL emission, preserving static initialization and async Main. */
export function withSourceLaunchArguments(image, args = []) {
  if (!Array.isArray(args) || args.length > 4096 || args.some(value => typeof value !== 'string' || value.includes('\0')) ||
    args.reduce((sum, value) => sum + value.length, 0) > 131_072) throw new Error('Invalid managed launch arguments');
  if (!args.length) return image;
  const startup = image?.methods?.[image.entryPoint];
  if (!startup || startup.name !== '<startup>' || !(startup.code instanceof Int32Array)) {
    throw new Error('Managed launch requires a compiler-generated startup method');
  }
  let call = -1;
  for (let offset = 0; offset < startup.code.length; offset += 3) {
    if (startup.code[offset] !== Op.CALL) continue;
    const method = image.methods[startup.code[offset + 1]];
    if (method?.isStatic && ['Main', '<Main>'].includes(method.name)) call = offset;
  }
  if (call < 0) throw new Error('Managed startup does not contain a Main entry invocation');
  const main = image.methods[startup.code[call + 1]];
  if (!main.parameters.length) return image;
  const forwarded = startup.parameters.length === 1 && startup.parameters[0].type === 'string[]' && call >= 3 &&
    startup.code[call - 3] === Op.LDLOC && startup.code[call - 2] === 0;
  const emptyArray = call >= 6 && startup.code[call - 6] === Op.CONST && image.constants[startup.code[call - 5]] === 0 &&
    startup.code[call - 3] === Op.NEWARR && image.constants[startup.code[call - 2]] === 'string';
  if (main.parameters.length !== 1 || main.parameters[0].type !== 'string[]' || !forwarded && !emptyArray) {
    throw new Error('Managed startup argument construction is unsupported');
  }
  const constants = [...image.constants];
  const constant = value => { constants.push(value); return constants.length - 1; };
  const code = [...startup.code.slice(0, call)];
  if (forwarded) {
    code.splice(call - 3, 3, Op.CONST, constant(args.length), 0);
    code.push(Op.NEWARR, constant('string'), 0);
  } else code[call - 5] = constant(args.length);
  for (let index = 0; index < args.length; index++) {
    code.push(Op.DUP, 0, 0, Op.CONST, constant(index), 0, Op.CONST, constant(args[index]), 0, Op.STELEM, 0, 0, Op.POP, 0, 0);
  }
  for (let offset = call; offset < startup.code.length; offset++) code.push(startup.code[offset]);
  const insertion = call / 3;
  const delta = args.length * 5 + (forwarded ? 1 : 0);
  const remap = offset => Number.isInteger(offset) && offset >= insertion ? offset + delta : offset;
  for (let offset = 0; offset < code.length; offset += 3) {
    if ([Op.JUMP, Op.JFALSE, Op.JTRUE].includes(code[offset])) code[offset + 1] = remap(code[offset + 1]);
  }
  const handlers = startup.handlers.map(handler => ({...handler, start: remap(handler.start), end: remap(handler.end),
    target: remap(handler.target), ...(handler.handlerEnd === undefined ? {} : {handlerEnd: remap(handler.handlerEnd)})}));
  const methods = [...image.methods];
  methods[startup.id] = {...startup, code: Int32Array.from(code), handlers};
  const sequencePoints = image.sequencePoints.map(point => point.methodId === startup.id ? {...point, offset: remap(point.offset)} : point);
  let il = image.il;
  if (il?.offsets) {
    const offsets = [...il.offsets];
    const original = offsets[startup.id];
    offsets[startup.id] = [...original.slice(0, insertion), ...Array(delta).fill(null), ...original.slice(insertion)];
    il = {...il, offsets, launchArgumentOverlay: true};
  }
  return {...image, constants, methods, sequencePoints, ...(il ? {il} : {})};
}
