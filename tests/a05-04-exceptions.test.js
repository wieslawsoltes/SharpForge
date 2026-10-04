import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyCilAssembly
} from '@sharpforge/cil';
import {
  CilVirtualMachine
} from '@sharpforge/runtime';
import {
  controlFixture
} from './support/control-fixture.js';
const label = (labels, name) => labels.get(name);
const clause = (labels, {
  start = 'try',
  end = 'tryEnd',
  target = 'handler',
  handlerEnd = 'handlerEnd',
  filter,
  flags = 0,
  catchType = 0
} = {}) => ({
  flags,
  start: label(labels, start),
  end: label(labels, end),
  target: label(labels, target),
  handlerEnd: label(labels, handlerEnd),
  catchType: filter ? label(labels, filter) : catchType
});
const throwException = (w, c, message) => w.op('ldstr', 0x70000000 + c.md.userString(message)).op('newobj', c.member('System.Exception', '.ctor',
  'void', ['string'], false)).op('throw');
const run = bytes => {
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return result;
};

function twoPassFixture({
  filterThrows = false,
  filterCalls = false
} = {}) {
  return controlFixture([{
    name: 'Program',
    fields: [{
      name: 'State'
    }, {
      name: 'Observed'
    }],
    methods: [{
        name: 'Main',
        result: 'int',
        body: (w, c) => {
          w.label('try').op('call', c.methods.get('Program.Thrower')).op('leave', 'done').label('tryEnd').label('filter').op('pop').op(
            'ldsfld', c.fields.get('Program.State')).op('stsfld', c.fields.get('Program.Observed'));
          if (filterThrows) w.op('call', c.methods.get('Program.FilterThrows'));
          if (filterCalls) w.op('call', c.methods.get('Program.FilterCatches'));
          else w.op('ldc.i4.1');
          w.op('endfilter').label('filtered').op('pop').op('leave', 'done').label('filteredEnd').label('fallback').op('pop').op('ldsfld', c
              .fields.get('Program.Observed')).op('ldc.i4', 10).op('add').op('stsfld', c.fields.get('Program.Observed')).op('leave', 'done')
            .label('fallbackEnd').label('done').op('ldsfld', c.fields.get('Program.Observed')).op('ldsfld', c.fields.get('Program.State'))
            .op('add').op('ret');
        },
        handlers: (l, c) => [clause(l, {
          flags: 1,
          filter: 'filter',
          target: 'filtered',
          handlerEnd: 'filteredEnd'
        }), clause(l, {
          target: 'fallback',
          handlerEnd: 'fallbackEnd',
          catchType: c.resolve('System.Exception')
        })]
      },
      {
        name: 'Thrower',
        body: (w, c) => {
          w.label('try');
          throwException(w, c, 'original');
          w.label('tryEnd').label('handler').op('ldc.i4.1').op('stsfld', c.fields.get('Program.State')).op('endfinally').label(
          'handlerEnd');
        },
        handlers: l => [clause(l, {
          flags: 2
        })]
      },
      {
        name: 'FilterThrows',
        body: (w, c) => throwException(w, c, 'filter failure')
      },
      {
        name: 'FilterCatches',
        result: 'int',
        locals: ['int'],
        body: (w, c) => {
          w.label('try');
          throwException(w, c, 'caught in filter helper');
          w.label('tryEnd').label('handler').op('pop').op('ldc.i4.1').op('stloc.0').op('leave', 'done').label('handlerEnd').label('done')
            .op('ldloc.0').op('ret');
        },
        handlers: (l, c) => [clause(l, {
          catchType: c.resolve('System.Exception')
        })]
      }
    ]
  }]);
}
test('A05 T04 caller filter observes state before callee finally executes', () => assert.equal(run(twoPassFixture()).returnValue, 1));
test('A05 T04 an escaping filter exception is false and preserves original search', () => assert.equal(run(twoPassFixture({
  filterThrows: true
})).returnValue, 11));
test('A05 T04 filter helper can catch its own exception and accept original fault', () => assert.equal(run(twoPassFixture({
  filterCalls: true
})).returnValue, 1));
test('A05 T04 suspended filter search survives snapshot, collection and restore', () => {
  const vm = new CilVirtualMachine(twoPassFixture());
  let budget = 100;
  while (!vm.top?.filterSearch && budget--) vm.runSlice({
    instructionBudget: 1,
    timeBudgetMs: 1000
  });
  assert(vm.top?.filterSearch);
  const owner = vm.frames.find(frame => frame.id === vm.top.filterOwnerId);
  assert.equal(vm.top.locals, owner.locals);
  const snapshot = vm.snapshot();
  assert.equal(vm.run().returnValue, 1);
  vm.restore(snapshot);
  vm.heap.collect();
  const restored = vm.frames.find(frame => frame.id === vm.top.filterOwnerId);
  assert.equal(vm.top.locals, restored.locals);
  assert.equal(vm.run().returnValue, 1);
});
test('A05 T04 fault executes only on exceptional exit and before selected catch', () => {
  const build = throws => controlFixture([{
    name: 'Program',
    fields: [{
      name: 'State'
    }],
    methods: [{
        name: 'Main',
        result: 'int',
        body: (w, c) => w.label('try').op('call', c.methods.get('Program.Work')).op('leave', 'done').label('tryEnd').label('handler').op(
          'pop').op('leave', 'done').label('handlerEnd').label('done').op('ldsfld', c.fields.get('Program.State')).op('ret'),
        handlers: (l, c) => [clause(l, {
          catchType: c.resolve('System.Exception')
        })]
      },
      {
        name: 'Work',
        body: (w, c) => {
          w.label('try');
          if (throws) throwException(w, c, 'fault');
          else w.op('leave', 'done');
          w.label('tryEnd').label('handler').op('ldc.i4', 42).op('stsfld', c.fields.get('Program.State')).op('endfinally').label(
            'handlerEnd').label('done').op('ret');
        },
        handlers: l => [clause(l, {
          flags: 4
        })]
      }
    ]
  }]);
  assert.equal(run(build(false)).returnValue, 0);
  assert.equal(run(build(true)).returnValue, 42);
});
test('A05 T04 cleanup exception starts a fresh search after original filters', () => {
  const bytes = controlFixture([{
    name: 'Program',
    fields: [{
      name: 'Searches'
    }],
    methods: [{
        name: 'Main',
        result: 'int',
        body: (w, c) => w.label('try').op('call', c.methods.get('Program.Work')).op('leave', 'done').label('tryEnd').label('filter').op(
            'pop').op('ldsfld', c.fields.get('Program.Searches')).op('ldc.i4.1').op('add').op('stsfld', c.fields.get('Program.Searches'))
          .op('ldc.i4.1').op('endfilter').label('handler').op('pop').op('leave', 'done').label('handlerEnd').label('done').op('ldsfld', c
            .fields.get('Program.Searches')).op('ret'),
        handlers: l => [clause(l, {
          flags: 1,
          filter: 'filter'
        })]
      },
      {
        name: 'Work',
        body: (w, c) => {
          w.label('try');
          throwException(w, c, 'first');
          w.label('tryEnd').label('handler');
          throwException(w, c, 'replacement');
          w.label('handlerEnd');
        },
        handlers: l => [clause(l, {
          flags: 2
        })]
      }
    ]
  }]);
  assert.equal(run(bytes).returnValue, 2);
});
test('A05 T04 nested catch rethrow preserves the original exception identity', () => {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
      name: 'Main',
      result: 'int',
      locals: ['object', 'int'],
      body: (w, c) => {
        w.label('outer').label('try');
        throwException(w, c, 'original');
        w.label('tryEnd').label('handler').op('stloc.0').op('rethrow').label('handlerEnd').label('outerEnd').label('outerCatch').op(
          'ldloc.0').op('ceq').op('stloc.1').op('leave', 'done').label('outerCatchEnd').label('done').op('ldloc.1').op('ret');
      },
      handlers: (l, c) => [clause(l, {
        catchType: c.resolve('System.Exception')
      }), clause(l, {
        start: 'outer',
        end: 'outerEnd',
        target: 'outerCatch',
        handlerEnd: 'outerCatchEnd',
        catchType: c.resolve('System.Exception')
      })]
    }]
  }]);
  const vm = new CilVirtualMachine(bytes);
  const identities = [];
  vm.onException = fault => {
    identities.push(fault);
    return false;
  };
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 1);
  assert.equal(identities[0], identities[1]);
});
for (const opcode of ['endfilter', 'endfinally', 'rethrow']) test(`A05 T04 verifier rejects ${opcode} outside its lexical region`, () => {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
      name: 'Main',
      body: w => {
        if (opcode === 'endfilter') w.op('ldc.i4.1');
        w.op(opcode);
      }
    }]
  }]);
  assert.equal(verifyCilAssembly(bytes).success, false);
});
test('A05 T04 verifier rejects branches into filters and handlers', () => {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
      name: 'Main',
      body: w => w.op('br', 'handler').label('try').op('leave', 'done').label('tryEnd').label('filter').op('pop').op('ldc.i4.1').op(
        'endfilter').label('handler').op('pop').op('leave', 'done').label('handlerEnd').label('done').op('ret'),
      handlers: l => [clause(l, {
        flags: 1,
        filter: 'filter'
      })]
    }]
  }]);
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_EH_FLOW' && issue.diagnostic === 'CILCF0009'));
});
test('A05 T04 stop during a filter releases continuations and prevents cleanup resumption', () => {
  const vm = new CilVirtualMachine(twoPassFixture());
  let budget = 100;
  while (!vm.top?.filterSearch && budget--) vm.runSlice({
    instructionBudget: 1,
    timeBudgetMs: 1000
  });
  assert(vm.top?.filterSearch);
  const instructions = vm.instructions;
  vm.stop();
  vm.heap.collect();
  assert.equal(vm.frames.length, 0);
  assert.equal(vm.pendingFault, null);
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.instructions, instructions);
});
