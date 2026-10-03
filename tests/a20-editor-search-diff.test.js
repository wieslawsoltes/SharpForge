import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '../packages/editor/src/model.js';
import {EditorModelWorkspace, commitWorkspaceEdit} from '../packages/editor/src/services/index.js';
import {EditorSearchSession, preserveReplacementCase} from '../packages/editor/src/features/search-session.js';
import {buildDiffRows, inlineDiffRows, MergeSession} from '../packages/editor/src/diff/index.js';

test('regex replacement with numbered and named groups spans open documents atomically', () => {
  const models = new Map([['a', new EditorModel('one=12; two=34;', {uri: 'a'})], ['b', new EditorModel('three=56;', {uri: 'b'})]]);
  const workspace = new EditorModelWorkspace(models);
  const search = new EditorSearchSession(workspace);
  assert.equal(search.search('(?<name>\\w+)=(\\d+)', {scope: 'open', regex: true}).matches.length, 3);
  commitWorkspaceEdit(workspace, search.prepareReplacement('$<name>($2)'));
  assert.equal(models.get('a').value, 'one(12); two(34);');
  assert.equal(models.get('b').value, 'three(56);');
});

test('find selection scope retains the captured range, whole-word filters and preserve-case replacements', () => {
  const model = new EditorModel('FOO Foo foo food foo', {uri: 'a'});
  const workspace = new EditorModelWorkspace(new Map([['a', model]]));
  const search = new EditorSearchSession(workspace);
  const result = search.search('foo', {uri: 'a', scope: 'selection', selection: {start: 0, end: 11}, wholeWord: true, preserveCase: true});
  assert.equal(result.matches.length, 3);
  commitWorkspaceEdit(workspace, search.prepareReplacement('bar'));
  assert.equal(model.value, 'BAR Bar bar food foo');
  assert.equal(preserveReplacementCase('newName', 'NAME'), 'NEWNAME');
  assert.equal(preserveReplacementCase('name', '123'), 'name');
});

test('invalid regex and stale replace preview leave source unchanged and history stays bounded', () => {
  const model = new EditorModel('value value', {uri: 'a'});
  const workspace = new EditorModelWorkspace(new Map([['a', model]]));
  const search = new EditorSearchSession(workspace);
  assert.throws(() => search.search('(', {uri: 'a', regex: true}));
  search.search('value', {uri: 'a'});
  const plan = search.prepareReplacement('other');
  model.applyEdits([{start: 0, end: 0, text: '!'}]);
  assert.throws(() => commitWorkspaceEdit(workspace, plan), /changed before commit/);
  assert.equal(model.value, '!value value');
  for (let index = 0; index < 80; index++) { search.query = String(index); search.remember(); }
  assert.equal(search.history.length, 50);
  assert.equal(search.history[0], '79');
});

test('side-by-side and inline rows share hunks and preserve line alignment around insertion and deletion', () => {
  const original = 'a\r\nb\r\nc\r\nd\r\n';
  const modified = 'a\r\nnew\r\nnewer\r\nc\r\nd\r\n';
  const aligned = buildDiffRows(original, modified);
  const inline = inlineDiffRows(aligned);
  assert.equal(aligned.rows.filter(row => row.original).map(row => row.original.text).join('|'), 'a|b|c|d');
  assert.equal(aligned.rows.filter(row => row.modified).map(row => row.modified.text).join('|'), 'a|new|newer|c|d');
  assert(aligned.rows.some(row => row.original === null));
  assert.equal(new Set(inline.filter(row => row.hunk !== null).map(row => row.hunk)).size, aligned.hunks.length);
  assert.equal(inline.filter(row => row.kind !== 'deleted').map(row => row.text).join('|'), 'a|new|newer|c|d');
  assert.equal(buildDiffRows('', '').rows.length, 1);
  assert.equal(buildDiffRows('same', 'same').hunks.length, 0);
});

test('merge preserves unresolved conflict bytes until a chosen side, both or manual result is accepted', () => {
  const base = 'header\nbase\nfooter\n';
  const ours = 'header\nleft\nfooter\n';
  const theirs = 'header\nright\nfooter\n';
  for (const [choice, expected] of [['left', ours], ['right', theirs], ['both', 'header\nleft\nright\nfooter\n']]) {
    const session = new MergeSession(base, ours, theirs);
    const original = session.text;
    assert.equal(session.unresolved, 1);
    assert(session.text.includes('<<<<<<<'));
    session.resolve(session.conflicts[0].id, choice);
    assert.equal(session.text, expected);
    assert.equal(session.unresolved, 0);
    assert.equal(session.undo(), true);
    assert.equal(session.text, original);
    assert.equal(session.unresolved, 1);
  }
  const manual = new MergeSession(base, ours, theirs);
  const conflict = manual.conflicts[0];
  manual.edit(conflict.start, conflict.end, 'manual\n');
  assert.equal(manual.unresolved, 1);
  manual.resolve(conflict.id, 'manual');
  assert.equal(manual.text, 'header\nmanual\nfooter\n');
  assert.equal(manual.unresolved, 0);
  assert.throws(() => manual.resolve('missing', 'left'));
});

test('independent merge changes are accepted automatically and adjacent conflict offsets track replacement length', () => {
  const automatic = new MergeSession('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n');
  assert.equal(automatic.unresolved, 0);
  assert.equal(automatic.text, 'A\nb\nC\n');
  const session = new MergeSession('a\nb\nc\nd\ne\n', 'A\nb\nc\nD\ne\n', 'X\nb\nc\nY\ne\n');
  const conflicts = [...session.conflicts];
  assert.equal(conflicts.length, 2);
  session.resolve(conflicts[0].id, 'left');
  session.resolve(conflicts[1].id, 'right');
  assert.equal(session.text, 'A\nb\nc\nY\ne\n');
});
