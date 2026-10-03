import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ConfigDocument, GitConfig } from '../packages/git/src/config.js';
import { MemoryStore } from '../packages/git/src/memory-odb.js';

const fixture = '# Existing configuration\r\n[Core] # section comment\r\n\tfileMode = true ; mode\r\n'
  + '\tautocrlf = input\r\n[remote "Origin"]\r\n\turl = "https://example.test/team/repo#anchor" # retain\r\n'
  + '\tfetch = +refs/heads/*:refs/remotes/Origin/*\r\n[branch "main"]\r\n\tremote = Origin\r\n'
  + '\tmerge = refs/heads/main\r\n[user]\r\n\tname = "Ada \\"Lovelace\\""\r\n'
  + '\temail = ada@example.test\r\n[include]\r\n\tpath = /outside/config\r\n'
  + '[includeIf "gitdir:~/work/"]\r\n\tpath = private.inc\r\n';

test('Git config round-trips comments, case, ordering and CRLF bytes while ignoring includes', () => {
  const document = new ConfigDocument(fixture);
  assert.equal(document.toString(), fixture);
  assert.equal(document.getBoolean('core.filemode'), true);
  assert.equal(document.get('CORE.AUTOCRLF'), 'input');
  assert.equal(document.get('remote.Origin.url'), 'https://example.test/team/repo#anchor');
  assert.equal(document.get('remote.origin.url'), undefined);
  assert.equal(document.get('user.name'), 'Ada "Lovelace"');
  assert.equal(document.warnings.length, 2);
  assert.ok(document.warnings.every(warning => warning.code === 'GitConfigIncludeDisabled'));
  document.set('core.filemode', false);
  const expected = fixture.replace('fileMode = true ; mode', 'fileMode = false ; mode');
  assert.equal(document.toString(), expected);
  document.set('remote.Origin.fetch', '+refs/tags/*:refs/tags/*', { append: true });
  assert.equal(document.getAll('remote.Origin.fetch').length, 2);
  document.unset('branch.main.remote');
  assert.equal(new ConfigDocument(document.toString()).get('branch.main.remote'), undefined);
});

test('config values decode quoted escapes, line continuations, multivars and valueless booleans', () => {
  const source = '[core]\n\tbare # enabled\n\tempty =\n\tcache = 4k\n'
    + '[user]\n\tname = first\\\n second\n\tname = "space \\t tab \\n line \\b back"\n';
  const document = new ConfigDocument(source);
  assert.equal(document.getBoolean('core.bare'), true);
  assert.equal(document.getBoolean('core.empty'), false);
  assert.equal(document.getInteger('core.cache'), 4096);
  assert.deepEqual(document.getAll('user.name'), ['first second', 'space \t tab \n line \b back']);
  assert.equal(document.toString(), source);
  document.set('user.name', '# literal ; quote " slash \\');
  assert.equal(new ConfigDocument(document.toString()).get('user.name'), '# literal ; quote " slash \\');
  const legacy = new ConfigDocument('[remote.ORIGIN]\nurl = https://example.test\n');
  assert.equal(legacy.get('remote.origin.url'), 'https://example.test');
});

test('native git config agrees on fixture values and lossless rewrites', t => {
  const version = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) return t.skip('Native Git is unavailable on this platform');
  t.diagnostic(version.stdout.trim());
  const source = '[core]\nfilemode = true\nautocrlf = input\n[remote "origin"]\nurl = "https://example.test/a#b"\n'
    + '[user]\nname = "Ada \\"Lovelace\\""\n';
  const document = new ConfigDocument(source);
  for (const key of ['core.filemode', 'core.autocrlf', 'remote.origin.url', 'user.name']) {
    const result = spawnSync('git', ['config', '--file', '-', '--get', key], { input: source, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.get(key), result.stdout.replace(/\n$/u, ''));
  }
});

test('config rejects malformed grammar, invalid numbers and unsafe edits', () => {
  for (const source of ['x = y\n', '[bad section]\n', '[user]\nname = "unterminated\n', '[user]\nname = bad\\q\n', '[u]\nx = a\0b']) {
    assert.throws(() => new ConfigDocument(source), { code: 'Corrupt' }, source);
  }
  const document = new ConfigDocument('[core]\nfilemode = maybe\nsize = 999999999999999999999999g\n');
  assert.throws(() => document.getBoolean('core.filemode'), { code: 'Corrupt' });
  assert.throws(() => document.getInteger('core.size'), { code: 'Limit' });
  assert.throws(() => document.set('unsafe\nsection.key', 'value'), { code: 'Unsafe' });
  assert.throws(() => new ConfigDocument('[core]\nx=1', { maxBytes: 2 }), { code: 'Limit' });
});

test('config persistence detects stale edits and preserves committed bytes on cancellation', async () => {
  const store = new MemoryStore();
  const first = await new GitConfig({ store }).load();
  const second = await new GitConfig({ store }).load();
  first.set('user.name', 'First');
  await first.save();
  second.set('user.name', 'Stale');
  await assert.rejects(second.save(), { code: 'Conflict' });
  assert.equal((await new GitConfig({ store }).load()).get('user.name'), 'First');
  const controller = new AbortController();
  controller.abort();
  first.set('user.name', 'Cancelled');
  await assert.rejects(first.save({ signal: controller.signal }), { code: 'Cancelled' });
  assert.equal((await new GitConfig({ store }).load()).get('user.name'), 'First');
});

test('config persistence retains the UTF-8 BOM and reports malformed UTF-8 metadata', async () => {
  const store = new MemoryStore();
  const source = '\ufeff[core]\nfilemode = false\n';
  await store.set('config', new TextEncoder().encode(source));
  const config = await new GitConfig({ store }).load();
  assert.equal(config.toString(), source);
  await config.save();
  assert.deepEqual(await store.get('config'), new TextEncoder().encode(source));
  await store.set('config', Uint8Array.of(0xff));
  await assert.rejects(new GitConfig({ store }).load(), { code: 'Corrupt' });
});
