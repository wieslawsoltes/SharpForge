import {
  CilDispatchTable
} from '@sharpforge/cil';
import {
  ManagedFault
} from '../heap.js';
import {
  callSourceFromStack
} from './call-frames.js';

const dispatches = new WeakMap();
const typeToken = id => 0x02000001 + id;
const methodToken = id => 0x06000001 + id;

function methodFlags(method) {
  return (method.isStatic ? 0x10 : 0) | (method.isVirtual ? 0x40 : 0) | (method.isAbstract ? 0x400 : 0) |
    (method.isNewSlot ? 0x100 : 0) | (method.isFinal ? 0x20 : 0) |
    ({
      private: 1,
      internal: 3,
      protected: 4,
      public: 6
    } [method.access] ?? 6);
}

/** The source image is monomorphized; its ordinary declaration IDs form a complete CLI dispatch view. */
function sourceInspector(image) {
  const names = new Map(image.types.map(type => [type.name, typeToken(type.id)]));
  const methods = new Map(image.methods.map(method => [methodToken(method.id), {
    token: methodToken(method.id),
    name: method.name,
    ownerToken: names.get(method.owner),
    ownerInstance: method.owner,
    flags: methodFlags(method),
    hasBody: !method.isAbstract,
    signature: {
      kind: 'method',
      isStatic: method.isStatic,
      genericArity: 0,
      callingConvention: method.callingConvention ?? 0,
      parameters: method.parameters.map(parameter => parameter.type),
      returnType: method.returnType
    }
  }]));
  const ownedMethods = new Map();
  for (const method of methods.values()) {
    const entries = ownedMethods.get(method.ownerToken) ?? [];
    entries.push(method);
    ownedMethods.set(method.ownerToken, entries);
  }
  const types = image.types.map(type => ({
    token: typeToken(type.id),
    name: type.name,
    flags: type.interface ? 0xa0 : type.abstract ? 0x80 : 0,
    baseToken: names.get(type.base) ?? 0,
    interfaces: (type.interfaces ?? []).map(name => names.get(name)).filter(Boolean),
    methods: ownedMethods.get(typeToken(type.id)) ?? []
  }));
  const tokenNames = new Map(types.map(type => [type.token, type.name]));
  const implementations = image.methods.flatMap(method => (method.explicitInterfaceImplementations ?? []).map(declaration => [names.get(method
    .owner) & 0xffffff, (method.id + 1) << 1, (declaration + 1) << 1
  ]));
  return {
    types,
    methods,
    signature: token => methods.get(token).signature,
    metadata: {
      rows: {
        25: implementations
      },
      typeName: token => tokenNames.get(token)
    }
  };
}

class SourceDispatchTable extends CilDispatchTable {
  definition(token) {
    const method = this.inspector.methods.get(token);
    if (!method) throw new ManagedFault('InvalidProgramException', 'Unknown source dispatch declaration');
    return method;
  }
}

function dispatchTable(image) {
  let dispatch = dispatches.get(image);
  if (!dispatch) dispatches.set(image, dispatch = new SourceDispatchTable(sourceInspector(image)));
  return dispatch;
}

/** Dispatch resolves before consuming operands; calls retain normal frame admission and exception behavior. */
export function callSourceVirtual(vm, frame, declaration, count) {
  const index = vm.stack.length - count,
    receiver = vm.stack[index];
  if (receiver === null) throw new ManagedFault('NullReferenceException', 'Cannot dispatch an interface call on null');
  const object = vm.heap.get(receiver);
  let target;
  try {
    target = dispatchTable(vm.image).resolve(object.methodTable.name, methodToken(declaration));
  } catch (error) {
    throw new ManagedFault('InvalidProgramException', error.message);
  }
  if (target?.ambiguousImplementation)
    throw new ManagedFault('System.Runtime.AmbiguousImplementationException', 'The interface declaration has competing default implementations');
  const method = vm.image.methods[target - 0x06000001];
  if (!method || method.isAbstract) throw new ManagedFault('MissingMethodException', 'The interface declaration has no executable implementation');
  if (object.kind === 'box' && object.methodTable.flags.valueType && method.owner === object.methodTable.name)
    vm.stack[index] = vm.address('box', 0, receiver);
  callSourceFromStack(vm, method.id, count);
}
