import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSources, resolveSources } from '@sharpforge/symbols';

function fixture(count = 3) {
  return {
    documents: [],
    methods: Array.from({ length: count }, (_, index) => ({ token: 0x06000001 + index, points: [] })),
    scopes: [],
  };
}
const scope = (methodToken, name, index, start, end, hidden = false) => ({
  methodToken,
  start,
  end,
  variables: [{ name, index, hidden }],
});

test('source projection preserves interleaved scope order, reused slots and lexical extents', async () => {
  const symbols = fixture();
  const [first, second, third] = symbols.methods.map((method) => method.token);
  symbols.scopes = [
    scope(second, 'other', 0, 0, 50),
    scope(first, 'outer', 0, 0, 30),
    scope(first, 'inner', 0, 10, 20, true),
    scope(second, 'later', 1, 50, 60),
  ];
  const expected = [
    {
      token: first,
      locals: [
        { name: 'outer', slot: 0, hidden: false, startOffset: 0, endOffset: 30 },
        { name: 'inner', slot: 0, hidden: true, startOffset: 10, endOffset: 20 },
      ],
    },
    {
      token: second,
      locals: [
        { name: 'other', slot: 0, hidden: false, startOffset: 0, endOffset: 50 },
        { name: 'later', slot: 1, hidden: false, startOffset: 50, endOffset: 60 },
      ],
    },
    { token: third, locals: [] },
  ];
  assert.deepEqual(bindSources(symbols).methods, expected);
  assert.deepEqual((await resolveSources(symbols)).methods, expected);
});

test('scope traversal stays linear as the number of methods grows', () => {
  const symbols = fixture(200);
  const scopes = Array.from({ length: 500 }, (_, index) =>
    scope(symbols.methods[index % symbols.methods.length].token, 'value-' + index, 0, index, index + 1),
  );
  let elementReads = 0;
  symbols.scopes = new Proxy(scopes, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) elementReads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const projected = bindSources(symbols);
  assert.equal(
    projected.methods.reduce((sum, method) => sum + method.locals.length, 0),
    scopes.length,
  );
  assert(elementReads <= scopes.length * 2, `scope reads exceeded a linear bound: ${elementReads}`);
});

test('projection owns output records and refreshes them on each call without retaining an index', () => {
  const symbols = fixture();
  symbols.scopes = [scope(symbols.methods[0].token, 'original', 0, 0, 10)];
  const first = bindSources(symbols);
  first.methods[0].locals[0].name = 'changed-output';
  symbols.scopes[0].variables[0].name = 'changed-input';
  const second = bindSources(symbols);
  assert.equal(second.methods[0].locals[0].name, 'changed-input');
  assert.notEqual(first.methods[0].locals, second.methods[0].locals);
  assert.notEqual(second.methods[1].locals, second.methods[2].locals);
  assert.deepEqual(bindSources(fixture(0)).methods, []);
});

test('scopes outside the projected method set do not read or retain local values', () => {
  const symbols = fixture(1);
  symbols.scopes = [
    {
      methodToken: 0x06000099,
      get variables() {
        assert.fail('unselected scope variables');
      },
    },
  ];
  assert.deepEqual(bindSources(symbols).methods[0].locals, []);
});
