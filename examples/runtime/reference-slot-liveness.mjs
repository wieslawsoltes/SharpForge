import {FORMAT_VERSION, Op} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';

// A minimal verified body uses local 0 once, then has two instructions left to run.
const image = {
  formatVersion: FORMAT_VERSION,
  entryPoint: 0,
  constants: [7],
  types: [],
  statics: [],
  sequencePoints: [],
  sources: [],
  methods: [{
    id: 0,
    name: 'Main',
    qualifiedName: 'Main',
    isStatic: true,
    returnType: 'int',
    parameters: [],
    handlers: [],
    locals: [{slot: 0, name: 'value', type: 'object'}],
    code: Int32Array.from([
      Op.LDLOC, 0, 0,
      Op.POP, 0, 0,
      Op.NOP, 0, 0,
      Op.CONST, 0, 0,
      Op.RET, 0, 0,
    ]),
  }],
};

const vm = new VirtualMachine(image, {preciseRootLiveness: true});
try {
  const reference = vm.heap.object('object', []);
  const weak = vm.heap.createHandle(reference, {weak: true});
  vm.top.locals[0] = reference;
  vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
  vm.heap.collect();
  console.log('Dead reference collected:', vm.heap.getHandle(weak) === null);
  console.log('Dead slot cleared:', vm.top.locals[0] === undefined);
  console.log('Execution state:', vm.run().state);
  console.log('Return value:', vm.returnValue);
} finally {
  vm.stop();
}
