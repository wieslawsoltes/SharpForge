import { Binary, FORMAT_VERSION, Op, serializeImage } from '@sharpforge/bytecode';

function method(id, code, parameters = 0, locals = parameters) {
  return {
    id, name: id ? 'Helper' + id : 'Main', qualifiedName: id ? 'Helper' + id : 'Main', owner: null, isStatic: true,
    returnType: 'int', parameters: Array.from({ length: parameters }, () => ({ type: 'int' })), handlers: [],
    locals: Array.from({ length: locals }, () => ({ type: 'int' })), code: Int32Array.from(code),
  };
}

function image(code) {
  return {
    formatVersion: FORMAT_VERSION, name: 'FuzzScalar', entryPoint: 0, constants: [40, 2],
    types: [], statics: [], sequencePoints: [], sources: [], methods: [method(0, code)],
  };
}

function seed(name, value) {
  return { name, input: new TextEncoder().encode(serializeImage(value)) };
}

function callImage() {
  const value = image([Op.CONST, 0, 0, Op.CONST, 1, 0, Op.CALL, 1, 2, Op.RET, 0, 0]);
  value.methods.push(method(1, [Op.LDLOC, 0, 0, Op.LDLOC, 1, 0, Op.BINARY, Binary['+'], 1, Op.RET, 0, 0], 2));
  return value;
}

function staticImage() {
  const value = image([
    Op.LDSTATIC, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 1,
    Op.STSTATIC, 0, 0, Op.POP, 0, 0, Op.LDSTATIC, 0, 0, Op.RET, 0, 0,
  ]);
  value.statics = [{ name: 'Counter', type: 'int', value: 40 }];
  return value;
}

function objectImage() {
  const value = image([
    Op.NEWOBJ, 0, 0, Op.STLOC, 0, 0, Op.CONST, 0, 0, Op.STFLD, 0, 0, Op.POP, 0, 0,
    Op.LDLOC, 0, 0, Op.LDFLD, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 1, Op.RET, 0, 0,
  ]);
  value.methods[0].locals = [{ type: 'FuzzBox' }];
  value.types = [{ id: 0, name: 'FuzzBox', fields: [{ name: 'Value', type: 'int' }] }];
  return value;
}

function arrayImage(lengthOnly = false) {
  const code = lengthOnly ? [Op.CONST, 1, 0, Op.NEWARR, 2, 0, Op.LENGTH, 0, 0, Op.RET, 0, 0] : [
    Op.CONST, 1, 0, Op.NEWARR, 2, 0, Op.STLOC, 0, 0, Op.CONST, 3, 0, Op.CONST, 0, 0,
    Op.STELEM, 0, 0, Op.POP, 0, 0, Op.LDLOC, 0, 0, Op.CONST, 3, 0, Op.LDELEM, 0, 0,
    Op.LDLOC, 0, 0, Op.LENGTH, 0, 0, Op.BINARY, Binary['+'], 1, Op.RET, 0, 0,
  ];
  const value = image(code);
  value.constants.push('int', 0);
  if (!lengthOnly) value.methods[0].locals = [{ type: 'int[]' }];
  return value;
}

function callDepthImage() {
  const value = image([Op.CALL, 1, 0, Op.RET, 0, 0]);
  value.methods.push(method(1, [Op.CALL, 2, 0, Op.RET, 0, 0]));
  value.methods.push(method(2, [Op.CALL, 3, 0, Op.RET, 0, 0]));
  value.methods.push(method(3, [Op.CONST, 0, 0, Op.RET, 0, 0]));
  return value;
}

/** Small authored programs; preserve the original first two wire seeds and add actual bounded managed execution. */
export function bytecodeSeeds() {
  const maximumArray = arrayImage(true);
  maximumArray.constants[1] = 1020; // 32-byte header + 1,020 eight-byte elements exactly fills 8 KiB.
  const emptyArray = arrayImage(true);
  emptyArray.constants[1] = 0;
  return [
    seed('return-constant', image([Op.CONST, 0, 0, Op.RET, 0, 0])),
    seed('add-two-integers', image([Op.CONST, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 0, Op.RET, 0, 0])),
    seed('call-two-integers', callImage()),
    seed('four-static-call-frames', callDepthImage()),
    seed('static-read-write', staticImage()),
    seed('fixed-object-field', objectImage()),
    seed('int-array-store-load-length', arrayImage()),
    seed('empty-int-array', emptyArray),
    seed('int-array-at-heap-budget', maximumArray),
  ];
}
