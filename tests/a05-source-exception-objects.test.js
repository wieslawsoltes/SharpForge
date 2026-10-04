import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  compileToIL
} from '@sharpforge/compiler';
import {
  loadAssembly
} from '@sharpforge/cil';
import {
  VirtualMachine,
  CilVirtualMachine
} from '@sharpforge/runtime';
import {
  BuiltinMap
} from '@sharpforge/bytecode';
import {
  RegistryBridge
} from '../packages/compiler/src/symbols/registry-bridge.js';

test('T04 managed StackTrace string members expose one overload per CLR signature', () => {
  const bridge = new RegistryBridge();
  const text = bridge.typeFromName('string');
  const contains = text.getMembers('Contains').filter(method => !method.isStatic &&
    method.parameters.length === 1 && method.parameters[0].type === text);
  assert.equal(contains.length, 1);
  assert(contains[0].contract);
  assert.equal(bridge.symbolForBuiltin(BuiltinMap.get('string.Contains')), contains[0]);
});

const cases = [{
    name: 'a constructed derived exception selects the matching typed catch',
    body: 'try{throw new InvalidOperationException();}' +
      'catch(ArgumentException){Console.WriteLine("wrong");}' +
      'catch(InvalidOperationException e){Console.WriteLine(e.GetType().Name);}',
    output: 'InvalidOperationException\n'
  },
  {
    name: 'message and inner chain survive typed filtering',
    body: 'Exception inner=new ArithmeticException("inner");' +
      'try{throw new InvalidOperationException("outer",inner);}' +
      'catch(SystemException e)when(e.InnerException==inner){' +
      'Console.WriteLine(e.Message);Console.WriteLine(e.InnerException.Message);' +
      'Console.WriteLine(e.GetBaseException()==inner);}',
    output: 'outer\ninner\nTrue\n'
  },
  {
    name: 'a thrown object exposes a managed stack trace and its native HResult',
    body: 'try{throw new InvalidOperationException("saved");}' +
      'catch(InvalidOperationException e){Console.WriteLine(e.StackTrace.Contains("Main"));' +
      'Console.WriteLine(e.HResult);}',
    output: 'True\n-2146233079\n'
  },
  {
    name: 'a captured derived catch variable retains its actual type and message',
    body: 'Func<string> get=null;try{throw new ArithmeticException("captured");}' +
      'catch(ArithmeticException e){get=()=>e.Message;}Console.WriteLine(get());',
    output: 'captured\n'
  },
  {
    name: 'successive exception base conversions preserve identity and dispatch',
    body: 'ArithmeticException arithmetic=new DivideByZeroException("base chain");' +
      'SystemException system=arithmetic;Exception error=system;' +
      'Console.WriteLine(error==arithmetic);Console.WriteLine(error.Message);' +
      'Console.WriteLine(error.GetType().Name);',
    output: 'True\nbase chain\nDivideByZeroException\n'
  }
];

const sourceOf = body => 'using System;class Program{static void Main(){' + body + '}}';
const engines = {
  source: artifact => new VirtualMachine(artifact.image),
  reload: artifact => new VirtualMachine(loadAssembly(artifact.assembly)),
  cil: artifact => new CilVirtualMachine(artifact.assembly)
};

for (const [engine, create] of Object.entries(engines)) {
  for (const item of cases) test('T04 source exception objects ' + engine + ': ' + item.name, () => {
    const artifact = compileToIL(sourceOf(item.body));
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const result = create(artifact).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, item.output);
  });
}

test('T04 source exception overloads with parameter-name semantics remain explicit profile gaps', () => {
  for (const type of ['ArgumentNullException', 'ArgumentOutOfRangeException', 'ObjectDisposedException']) {
    const result = compile(sourceOf('throw new ' + type + '("name");'));
    assert.equal(result.success, false);
    assert(result.diagnostics.some(item => item.code === 'SF2200'), JSON.stringify(result.diagnostics));
  }
});
