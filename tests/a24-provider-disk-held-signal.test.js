import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderDiskWorkspace as DiskWorkspace} from '@sharpforge/project-system';
import {MemoryFileSystemProvider, WorkspaceSaveLocks} from '@sharpforge/workspace';

const bytes = value => new TextEncoder().encode(value);

test('disk save forwards the held ownership signal to its actual read and write adapters', async () => {
  const memory = new MemoryFileSystemProvider();
  await memory.writeFile('A.cs', bytes('original'));
  const held = new AbortController();
  const signals = [];
  const provider = new Proxy(memory, {get(target, name) {
    if (name === 'readFile' || name === 'writeFile') return (...args) => {
      signals.push({name, signal: args[name === 'readFile' ? 1 : 2]?.signal});
      return target[name](...args);
    };
    const value = target[name];
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  const saveLocks = {async guardedSave({read, write}) {
    assert.equal(new TextDecoder().decode(await read({signal: held.signal})), 'original');
    return write({signal: held.signal});
  }};
  const disk = new DiskWorkspace([{path: 'A.cs', text: 'original'}], new Map(), 'Signals', [], [], {provider, saveLocks});
  await disk.save([{path: 'A.cs', text: 'new'}]);
  assert(signals.some(item => item.name === 'readFile' && item.signal === held.signal));
  assert.equal(signals.findLast(item => item.name === 'writeFile').signal, held.signal);
});

test('an aborted held save signal prevents the physical write even if the request signal remains live', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('A.cs', bytes('original'));
  const held = new AbortController();
  const saveLocks = {async guardedSave({read, write}) {
    await read({signal: held.signal});
    held.abort();
    return write({signal: held.signal});
  }};
  const disk = new DiskWorkspace([{path: 'A.cs', text: 'original'}], new Map(), 'Signals', [], [], {provider, saveLocks});
  await assert.rejects(disk.save([{path: 'A.cs', text: 'replacement'}]), {name: 'AbortError'});
  assert.equal(new TextDecoder().decode(await provider.readFile('A.cs')), 'original');
});

test('provider disk save composes the concrete shared-ownership coordinator', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('A.cs', bytes('original'));
  const requests = [];
  const saveLocks = new WorkspaceSaveLocks({identity: 'directory:physical', locks: {
    request: async (name, options, action) => { requests.push({name, mode: options.mode}); return action(); }
  }});
  const disk = new DiskWorkspace([{path: 'A.cs', text: 'original'}], new Map(), 'Locks', [], [], {provider, saveLocks});
  assert.deepEqual((await disk.save([{path: 'A.cs', text: 'saved'}])).written, ['A.cs']);
  assert.deepEqual(requests.map(request => request.mode), ['shared', 'exclusive']);
  assert.equal(new TextDecoder().decode(await provider.readFile('A.cs')), 'saved');
  saveLocks.dispose();
});

test('disk save and unload preserve the document watermark for the next load', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('A.cs', bytes('original'));
  const disk = new DiskWorkspace([{path: 'A.cs', size: 8, lazy: true, version: 20}], new Map(), 'Versions', [], [], {provider});
  assert.equal((await disk.load('A.cs')).version, 21);
  await disk.save([{path: 'A.cs', text: 'saved'}]);
  assert.equal(disk.record('A.cs').version, 22);
  assert.equal(disk.unload('A.cs'), true);
  assert.equal(disk.record('A.cs').version, 22);
  assert.equal((await disk.load('A.cs')).version, 23);
});

test('exhausted disk versions reject a save before opening a physical write', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('A.cs', bytes('original'));
  const record = {path: 'A.cs', text: 'original', version: Number.MAX_SAFE_INTEGER};
  const disk = new DiskWorkspace([record], new Map(), 'Versions', [], [], {provider});
  await assert.rejects(disk.save([{path: 'A.cs', text: 'replacement'}]), /version space exhausted/);
  assert.equal(new TextDecoder().decode(await provider.readFile('A.cs')), 'original');
  assert.equal(disk.record('A.cs'), record);
});
