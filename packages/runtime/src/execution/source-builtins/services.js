import {ManagedFault} from '../../heap.js';

function absoluteInt32(vm,args,value) {
  if(value===-2147483648)throw new ManagedFault('OverflowException','Absolute value of Int32.MinValue is not representable');
  return Math.abs(value);
}
function writeLine(vm,args) { vm.emitOutput((args.length?vm.format(args[0]):'')+'\n'); return null; }
function write(vm,args) { vm.emitOutput(vm.format(args[0])); return null; }
function debugAssert(vm,args,value) {
  if(value!==true)throw new ManagedFault('AssertionException',args.length>1?vm.format(args[1]):'Assertion failed');
  return null;
}
function tickCount() { return Math.trunc(performance.now())|0; }

export const serviceBuiltins=Object.freeze({
  '$Math.Abs.Int32':absoluteInt32,
  'Console.WriteLine':writeLine,
  'Console.Write':write,
  'Debug.Assert':debugAssert,
  'Environment.TickCount':tickCount
});
