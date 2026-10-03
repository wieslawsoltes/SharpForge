import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AssemblyLoadError, LoadErrorCode, AssemblyProvider, AssemblyResolver } from '../packages/clr/src/index.js';

const hasCode = code => error => error instanceof AssemblyLoadError && error.code === code;

test('CLR resolver applies provider order, binding, caches, diagnostics and disposal', () => {
  const resolver = new AssemblyResolver({ providers: [
    new AssemblyProvider('memory', [{ identity: 'Demo, Version=2.0', path: 'memory.dll' }]),
    new AssemblyProvider('app-local', [{ identity: 'Demo, Version=3.0', path: 'app.dll' }]),
  ], versionPolicy: 'higher' });
  const result = resolver.resolve('Demo, Version=1.0');
  assert.equal(result.path, 'memory.dll');
  assert.equal(resolver.resolve('Demo, Version=1.0'), result);
  assert.throws(() => resolver.resolve('Absent', { requester: 'Application' }), error =>
    hasCode(LoadErrorCode.MissingAssembly)(error) && error.fusionLog.includes('Requester: Application'));
  assert.throws(() => resolver.resolve('Demo, Version=4.0'), hasCode(LoadErrorCode.IdentityMismatch));
  assert.throws(() => resolver.resolve('Demo', { signal: AbortSignal.abort() }), hasCode(LoadErrorCode.Cancelled));
  resolver.dispose();
  resolver.dispose();
  assert.throws(() => resolver.resolve('Demo'), hasCode(LoadErrorCode.Disposed));
  const duplicate = new AssemblyResolver({ providers: [new AssemblyProvider('app', [
    { identity: 'Demo, Version=1.0', path: 'a.dll' }, { identity: 'Demo, Version=1.0', path: 'b.dll' },
  ])] });
  assert.throws(() => duplicate.resolve('Demo'), hasCode(LoadErrorCode.ConflictingAssembly));
});

test('CLR resolution package has no reachable network or host filesystem imports', () => {
  const source = new URL('../packages/clr/src/', import.meta.url);
  for (const file of readdirSync(source).filter(file => file.endsWith('.js'))) {
    const text = readFileSync(new URL(file, source), 'utf8');
    assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest|WebSocket|eval)\s*\(|node:(?:fs|http|https|net)|\bimport\s*\(/, file);
  }
});

