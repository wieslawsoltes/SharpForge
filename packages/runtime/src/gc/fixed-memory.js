import {ManagedFault} from './fault.js';
import {primitiveStorage} from './primitive-storage.js';
import {synchronizePayload, publishStoredRange} from './spatial-payload.js';

const owner = 'SharpForge.Runtime.FixedMemory';
const pointerType = 'SharpForge.Runtime.FixedPointer';
const elementNames = Object.freeze({
  byte: 'System.Byte', char: 'System.Char', int: 'System.Int32', double: 'System.Double', bool: 'System.Boolean'
});
const resultTypes = Object.freeze({Int32: 'int', Double: 'double', Boolean: 'bool'});
const unhandled = Object.freeze({handled: false, value: undefined});

function addressFault(message) {
  return new ManagedFault('InvalidAddressException', message);
}

function integer(platform, value) {
  const number = platform.native(value);
  if (!Number.isSafeInteger(number)) throw new ManagedFault('ArgumentOutOfRangeException', 'A precise integer offset is required');
  return number;
}

function elementCodec(element) {
  if (element === 'void') return null;
  const codec = primitiveStorage(elementNames[element]);
  if (!codec) throw new ManagedFault('NotSupportedException', 'The fixed pointer element type is outside this runtime profile');
  return codec;
}

function pointer(platform, reference) {
  if (reference === null || reference === undefined) throw new ManagedFault('NullReferenceException', 'The pointer is null');
  if (platform.heap.get(reference).type !== pointerType) throw addressFault('A scoped fixed pointer is required');
  const state = platform.get(reference, '$fixedPointer');
  const active = platform.heap.lifetime.pinning.leases.get(state?.lease?.id);
  if (!active || active.lease !== state.lease) throw addressFault('The fixed pointer scope has ended');
  return state;
}

function wrap(platform, state) {
  return platform.make(pointerType, {$fixedPointer: Object.freeze(state)});
}

function pin(platform, args) {
  const [reference, indexValue, elementValue, requireElementValue] = args;
  const index = integer(platform, indexValue);
  const element = platform.native(elementValue);
  const codec = elementCodec(element);
  const requireElement = !!platform.native(requireElementValue);
  if (reference === null) {
    if (requireElement) throw new ManagedFault('NullReferenceException', 'The fixed array is null');
    return null;
  }
  const record = platform.heap.get(reference);
  const string = record.kind === 'string';
  const binding = platform.heap.spaces.getBinding(record);
  if (string ? element !== 'char' : record.kind !== 'array' || !binding?.codec || binding.elementType !== elementNames[element]) {
    throw new ManagedFault('NotSupportedException', 'Fixed requires a compatible primitive array or UTF-16 string');
  }
  if (index < 0 || index >= record.data.length && (requireElement || index !== 0)) {
    throw new ManagedFault('IndexOutOfRangeException', 'The fixed initializer index is outside its array');
  }
  if (!string && record.data.length === 0) return null;
  const lease = platform.heap.lifetime.pin(reference, {reason: 'fixed'});
  try {
    const byteOffset = index * codec.size;
    return wrap(platform, {lease, element, byteOffset, address: lease.address.add(byteOffset)});
  } catch (error) {
    lease.dispose();
    throw error;
  }
}

function release(platform, reference) {
  if (reference === null) return null;
  const state = pointer(platform, reference);
  state.lease.dispose();
  return null;
}

function position(platform, state, offset, allowEnd = false) {
  const codec = elementCodec(state.element);
  if (!codec) throw addressFault('A void pointer cannot be dereferenced or advanced');
  const byteOffset = state.byteOffset + offset * codec.size;
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) throw addressFault('The pointer offset is outside its object');
  const record = platform.heap.get(state.lease.reference);
  platform.heap.spaces.getBinding(record);
  const limit = record.storage.byteLength + (record.kind === 'string' ? 2 : 0);
  if (byteOffset > limit || !allowEnd && byteOffset + codec.size > limit) {
    throw addressFault('The pointer access is outside the pinned payload');
  }
  return {codec, record, byteOffset};
}

function add(platform, args) {
  const offset = integer(platform, args[1]);
  if (args[0] === null && offset === 0) return null;
  const state = pointer(platform, args[0]);
  const at = position(platform, state, offset, true);
  return wrap(platform, {...state, byteOffset: at.byteOffset, address: state.lease.address.add(at.byteOffset)});
}

function cast(platform, args) {
  const element = platform.native(args[1]);
  elementCodec(element);
  if (args[0] === null) return null;
  const state = pointer(platform, args[0]);
  if (platform.heap.get(state.lease.reference).kind === 'string' && element !== 'char' && element !== 'void') {
    throw new ManagedFault('NotSupportedException', 'Pinned strings support UTF-16 character pointers only');
  }
  return state.element === element ? args[0] : wrap(platform, {...state, element});
}

function compare(platform, args) {
  const left = args[0] === null ? null : pointer(platform, args[0]);
  const right = args[1] === null ? null : pointer(platform, args[1]);
  const a = left?.address.value ?? 0n;
  const b = right?.address.value ?? 0n;
  const operation = platform.native(args[2]);
  let value;
  switch (operation) {
    case '==': value = a === b; break;
    case '!=': value = a !== b; break;
    case '<': value = a < b; break;
    case '<=': value = a <= b; break;
    case '>': value = a > b; break;
    case '>=': value = a >= b; break;
    default: throw new ManagedFault('ArgumentException', 'Unknown pointer comparison');
  }
  return platform.managed(value, 'bool');
}

function access(platform, descriptor, args) {
  const writing = descriptor.name.startsWith('Write');
  const suffix = descriptor.name.slice(writing ? 5 : 4);
  const state = pointer(platform, args[0]);
  const expected = state.element === 'bool' ? 'Boolean' : state.element === 'double' ? 'Double' : 'Int32';
  if (suffix !== expected) throw addressFault('The pointer access has an incompatible scalar type');
  const at = position(platform, state, integer(platform, args[1]));
  const address = state.lease.address.add(at.byteOffset);
  platform.heap.lifetime.addresses.resolve(address, {byteLength: at.codec.size});
  if (at.record.kind === 'string') {
    if (writing) throw new ManagedFault('NotSupportedException', 'Pinned strings are read-only in this runtime profile');
    return at.byteOffset === at.record.data.length * 2 ? 0 : at.record.data.charCodeAt(at.byteOffset / 2);
  }
  const binding = platform.heap.spaces.getBinding(at.record);
  if (writing && binding.readOnly) throw new ManagedFault('InvalidOperationException', 'Frozen managed storage is read-only');
  const first = Math.floor(at.byteOffset / binding.codec.size);
  const count = Math.ceil((at.byteOffset + at.codec.size) / binding.codec.size) - first;
  synchronizePayload(binding, first, count);
  const offset = binding.block.offset + at.byteOffset;
  if (writing) {
    at.codec.write(binding.arena.view, offset, platform.native(args[2]));
    publishStoredRange(binding, first, count);
    platform.heap.noteMutation();
  }
  return platform.managed(at.codec.read(binding.arena.view, offset), resultTypes[suffix]);
}

function smallInteger(platform, args) {
  const value = integer(platform, args[0]);
  const type = platform.native(args[1]);
  const maximum = type === 'byte' ? 255 : type === 'char' ? 65535 : null;
  if (maximum === null) throw new ManagedFault('ArgumentException', 'Unknown small integer type');
  if (platform.native(args[2]) && (value < 0 || value > maximum)) {
    throw new ManagedFault('OverflowException', 'Checked pointer element conversion overflow');
  }
  return value & maximum;
}

/** Shared source/CIL private operations. Pointers own scope identity; they never expose native host memory. */
export function invokeFixedMemory(platform, descriptor, args) {
  if (descriptor.owner !== owner) return unhandled;
  let value;
  switch (descriptor.name) {
    case 'Pin': value = pin(platform, args); break;
    case 'Release': value = release(platform, args[0]); break;
    case 'Add': value = add(platform, args); break;
    case 'Cast': value = cast(platform, args); break;
    case 'Compare': value = compare(platform, args); break;
    case 'SmallInteger': value = smallInteger(platform, args); break;
    default:
      if (!/^(Read|Write)(Int32|Double|Boolean)$/.test(descriptor.name)) {
        throw new ManagedFault('MissingMethodException', `${owner}::${descriptor.name}`);
      }
      value = access(platform, descriptor, args);
  }
  return {handled: true, value};
}
