import test from 'node:test';
import assert from 'node:assert/strict';
import {remapSourceBreakpoints} from '@sharpforge/debugger';

test('empty breakpoint requests yield independent empty arrays for large edited and unchanged sources', () => {
  const source = Array.from({length: 3000}, (_, line) => `int value${line} = ${line}; // 😀\r\n`).join('');
  const requests = Object.freeze([]);
  for (const after of [source, '// prefix\r\n' + source, source.slice(0, 20), '']) {
    const result = remapSourceBreakpoints(source, after, requests);
    assert.deepEqual(result, []);
    assert.notEqual(result, requests);
    result.push({line: 1});
    assert.deepEqual(requests, []);
  }
});

test('empty requests retain source and request-type validation', () => {
  for (const [before, after, requests] of [[null, '', []], ['', {}, []], [42, '', []], ['', '', null], ['', '', {}]]) {
    assert.throws(() => remapSourceBreakpoints(before, after, requests), {
      name: 'TypeError', message: 'Expected source text and breakpoint array'
    });
  }
});

test('nonempty breakpoint remapping preserves anchors, metadata and independent snapshots after extraction', () => {
  const before = 'before\r\nanchor();\r\nafter';
  const requests = Object.freeze([Object.freeze({line: 2, column: 3, condition: 'ready', enabled: false, verified: true, requestedLine: 9})]);
  const after = 'prefix\r\nbefore\r\nanchor();\r\nafter';
  const moved = remapSourceBreakpoints(before, after, requests);
  assert.deepEqual(moved, [{line: 3, column: 3, condition: 'ready', enabled: false, verified: undefined, requestedLine: undefined}]);
  assert.notEqual(moved[0], requests[0]);
  assert.deepEqual(remapSourceBreakpoints(before, before, requests), requests);
  assert.notEqual(remapSourceBreakpoints(before, before, requests)[0], requests[0]);
  assert.deepEqual(remapSourceBreakpoints(before, 'before', requests).map(breakpoint => breakpoint.line), [1]);
  assert.deepEqual(requests[0], {line: 2, column: 3, condition: 'ready', enabled: false, verified: true, requestedLine: 9});
});
