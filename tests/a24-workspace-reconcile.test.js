import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWorkspaceText, reconcileWorkspaceFile} from '@sharpforge/workspace';

test('three-way text merge preserves disjoint edits and reports overlapping edits with all versions', () => {
  assert.equal(mergeWorkspaceText('one\ntwo\n', 'ONE\ntwo\n', 'one\nTWO\n').text, 'ONE\nTWO\n');
  assert.equal(mergeWorkspaceText('old', 'same', 'same').text, 'same');
  const result = mergeWorkspaceText('old', 'mine', 'theirs');
  assert.equal(result.status, 'conflict');
  assert.equal(result.base, 'old');
  assert.equal(result.mine, 'mine');
  assert.equal(result.theirs, 'theirs');
  assert.equal(result.conflicts.length, 1);
});

test('merge size, work budget and cancellation preserve explicit outcomes', () => {
  assert.throws(() => mergeWorkspaceText('a', 'aa', 'b', {maxLength: 1}), /size limit/i);
  assert.throws(() => mergeWorkspaceText('a', 'b', 'c', {signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.throws(() => mergeWorkspaceText(null, 'b', 'c'), /text versions/i);
  const result = mergeWorkspaceText('a\nb\nc', 'A\nb\nc', 'a\nb\nC', {maxCells: 0});
  assert.equal(result.status, 'merged');
  assert.equal(result.text, 'A\nb\nC');
});

test('binary conflicts require a choice and adopted contents do not alias the input', () => {
  const base = Uint8Array.of(0), mine = Uint8Array.of(1, 255), theirs = Uint8Array.of(2);
  const input = {path: 'asset.bin', base, mine, theirs};
  assert.equal(reconcileWorkspaceFile(input).status, 'choice-required');
  assert.equal(reconcileWorkspaceFile({...input, choice: 'merge'}).code, 'SFW1202');
  const kept = reconcileWorkspaceFile({...input, choice: 'keep-mine'});
  assert.deepEqual(kept.content, mine);
  kept.content[0] = 9;
  assert.equal(mine[0], 1);
  assert.deepEqual(reconcileWorkspaceFile({...input, mine: base, choice: 'merge'}).content, theirs);
});
