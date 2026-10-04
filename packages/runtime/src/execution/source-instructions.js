import {Op, BinaryName, UnaryName} from '@sharpforge/bytecode';
import {ManagedFault} from '../gc/fault.js';
import {SUSPENDED} from '../platform.js';
import {binary, convert, unary, defaultValue, sourceEnum, checkSourceArrayStore} from './source-ops.js';
import {rethrow} from './source-eh.js';

const handlers = new Map();
const push = (vm, value) => vm.heap.writeRoot(vm.stack, vm.stack.length, value);

for (const opcode of [Op.NOP, Op.SEQ]) handlers.set(opcode, () => {});
handlers.set(Op.ENUM, (vm, frame, first, second) => push(vm, sourceEnum(vm, first, second)));
handlers.set(Op.DELEGATE, (vm, frame, first, second) => {
  const receiver = vm.stack.pop();
  const value = vm.heap.withRoots([receiver], () => vm.platform.delegate(vm.image.constants[second], first, receiver));
  push(vm, value);
});
handlers.set(Op.ENDFINALLY, (vm, frame) => vm.resumeUnwind(frame));
handlers.set(Op.CONST, (vm, frame, first) => push(vm, vm.constant(first)));
handlers.set(Op.LDLOC, (vm, frame, first) => {
  if (frame.locals[first] === undefined) throw new ManagedFault('InvalidProgramException', 'Read of uninitialized local');
  push(vm, frame.locals[first]);
});
handlers.set(Op.STLOC, (vm, frame, first) => {
  const oldValue = frame.locals[first];
  const value = vm.stack.at(-1);
  vm.heap.writeRoot(frame.locals, first, value);
  vm.notifyWrite({kind: 'local', frameId: frame.id, index: first, value, oldValue});
});
handlers.set(Op.LDSTATIC, (vm, frame, first) => push(vm, vm.statics[first]));
handlers.set(Op.STSTATIC, (vm, frame, first) => {
  const oldValue = vm.statics[first];
  const value = vm.stack.at(-1);
  vm.heap.writeStatic(vm.statics, first, value);
  vm.notifyWrite({kind: 'static', index: first, value, oldValue});
});
handlers.set(Op.LDFLD, (vm, frame, first) => {
  const reference = vm.stack.pop();
  const record = vm.heap.get(reference);
  if (first >= record.data.length || record.kind !== 'object') throw new ManagedFault('InvalidProgramException', 'Invalid field index');
  push(vm, record.data[first]);
});
handlers.set(Op.STFLD, (vm, frame, first) => {
  const value = vm.stack.pop();
  const reference = vm.stack.pop();
  const record = vm.heap.get(reference);
  if (first >= record.data.length || record.kind !== 'object') throw new ManagedFault('InvalidProgramException', 'Invalid field index');
  const oldValue = record.data[first];
  vm.heap.writeField(reference, first, value);
  push(vm, value);
  vm.notifyWrite({kind: 'field', handle: reference.h, generation: reference.g, index: first, value, oldValue});
});
handlers.set(Op.DUP, vm => push(vm, vm.stack.at(-1)));
handlers.set(Op.POP, vm => vm.stack.pop());
handlers.set(Op.BINARY, (vm, frame, first, second) => {
  const right = vm.stack.pop();
  const left = vm.stack.pop();
  push(vm, binary(vm, BinaryName[first], left, right, second));
});
handlers.set(Op.CONVERT, (vm, frame, first, second) => push(vm, convert(vm.stack.pop(), first, second, vm)));
handlers.set(Op.UNARY, (vm, frame, first, second) => push(vm, unary(UnaryName[first], vm.stack.pop(), second)));
handlers.set(Op.JUMP, (vm, frame, first) => vm.transfer(frame, 'jump', first));
handlers.set(Op.JFALSE, (vm, frame, first) => { if (!vm.stack.pop()) vm.transfer(frame, 'jump', first); });
handlers.set(Op.JTRUE, (vm, frame, first) => { if (vm.stack.pop()) vm.transfer(frame, 'jump', first); });
handlers.set(Op.CALL, (vm, frame, first, second) => vm.call(first, vm.stack.splice(vm.stack.length - second, second)));
handlers.set(Op.BUILTIN, (vm, frame, first, second) => {
  const args = vm.stack.splice(vm.stack.length - second, second);
  const value = vm.heap.withRoots(args, () => vm.builtin(first, args));
  if (value !== SUSPENDED) push(vm, value);
});
handlers.set(Op.RET, (vm, frame) => vm.transfer(frame, 'return', Infinity, vm.stack.pop()));
handlers.set(Op.NEWOBJ, (vm, frame, first) => {
  const type = vm.image.types[first];
  push(vm, vm.heap.object(type.name, type.fields.map(field => defaultValue(field.type, vm))));
});
handlers.set(Op.NEWARR, (vm, frame, first) => {
  const length = vm.stack.pop();
  const type = vm.image.constants[first];
  const reference = vm.heap.array(type, length);
  vm.heap.withRoots([reference], () => vm.heap.fillArray(reference, 0, length, defaultValue(type, vm)));
  push(vm, reference);
});
handlers.set(Op.LDELEM, vm => {
  const index = vm.stack.pop();
  const reference = vm.stack.pop();
  push(vm, vm.indexed(reference, index).data[index]);
});
handlers.set(Op.STELEM, vm => {
  const value = vm.stack.pop();
  const index = vm.stack.pop();
  const reference = vm.stack.pop();
  const record = vm.indexed(reference, index);
  const oldValue = record.data[index];
  checkSourceArrayStore(vm, record, value);
  vm.heap.writeElement(reference, index, value);
  push(vm, value);
  vm.notifyWrite({kind: 'array', handle: reference.h, generation: reference.g, index, value, oldValue});
});
handlers.set(Op.LENGTH, vm => {
  const record = vm.heap.get(vm.stack.pop());
  if (record.kind !== 'array' && record.kind !== 'string') throw new ManagedFault('InvalidProgramException', 'Length requires an array or string');
  push(vm, record.data.length);
});
handlers.set(Op.THROW, vm => {
  const reference = vm.stack.pop();
  if (reference === null) throw new ManagedFault('NullReferenceException', 'A null exception was thrown');
  const record = vm.heap.get(reference);
  throw new ManagedFault(record.type, vm.format(record.data[0]), reference);
});
handlers.set(Op.RETHROW, (vm, frame) => rethrow(frame));

export const sourceInstructionHandlers = handlers;
