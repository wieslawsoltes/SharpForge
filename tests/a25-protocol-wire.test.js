import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePktLine, encodePackets, PktLineDecoder, decodePktLines, decodeSideband, PacketKind } from '../packages/git/src/protocol/pktline.js';
import { concatBytes, encodeText } from '../packages/git/src/protocol/bytes.js';
import { parseAdvertisement } from '../packages/git/src/protocol/advertisement.js';
import { listRemoteRefs } from '../packages/git/src/protocol/v2.js';
import { buildV1FetchRequest } from '../packages/git/src/protocol/v1.js';
import { fetchPack } from '../packages/git/src/protocol/fetch.js';
import { shallowArguments, parseShallow, encodeShallow } from '../packages/git/src/shallow.js';
import { PromisorDatabase, validateFilter } from '../packages/git/src/promisor.js';
import { MemoryObjectDatabase } from '../packages/git/src/memory-odb.js';
import { RefDatabase } from '../packages/git/src/refs.js';
import { fetchRemote } from '../packages/git/src/fetch.js';

const oid = 'a'.repeat(40);
const other = 'b'.repeat(40);
const text = bytes => new TextDecoder().decode(bytes);

test('pkt-line control/data framing survives every split and rejects truncated/oversized input', async () => {
  const wire = concatBytes([encodePktLine('hello\n'), encodePktLine({ kind: 'flush' }),
    encodePktLine({ kind: 'delimiter' }), encodePktLine({ kind: 'end' }), encodePktLine(new Uint8Array(0))]);
  for (let split = 0; split <= wire.length; split++) {
    const decoder = new PktLineDecoder();
    const actual = [...decoder.push(wire.subarray(0, split)), ...decoder.push(wire.subarray(split))];
    decoder.finish();
    assert.deepEqual(actual.map(packet => packet.kind), ['data', 'flush', 'delimiter', 'end', 'data']);
    assert.equal(text(actual[0].data), 'hello\n');
  }
  assert.throws(() => encodePktLine(new Uint8Array(65517)), { code: 'Limit' });
  for (const invalid of ['0003', 'ffff', 'zzzz']) assert.throws(() => new PktLineDecoder().push(encodeText(invalid)), { code: 'Corrupt' });
  const decoder = new PktLineDecoder();
  decoder.push(encodeText('0010short'));
  assert.throws(() => decoder.finish(), { code: 'Corrupt' });
  const packets = [];
  for await (const packet of decodePktLines(wire)) packets.push(packet);
  assert.equal(packets.length, 5);
});

test('pkt-line fuzz corpus remains bounded and sideband preserves binary bytes and fatal errors', () => {
  let state = 0x4132;
  for (let iteration = 0; iteration < 2000; iteration++) {
    const bytes = new Uint8Array(iteration % 131);
    for (let index = 0; index < bytes.length; index++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      bytes[index] = state & 255;
    }
    const decoder = new PktLineDecoder();
    try { decoder.push(bytes); decoder.finish(); }
    catch (error) { assert.equal(error.code, 'Corrupt'); }
    assert.ok(decoder.pending.length <= 65520);
  }
  assert.deepEqual(decodeSideband({ kind: 'data', data: Uint8Array.of(1, 0, 255) }).data, Uint8Array.of(0, 255));
  const progress = [];
  assert.equal(decodeSideband({ kind: 'data', data: concatBytes([Uint8Array.of(2), encodeText('receiving')]) },
    { onProgress: value => progress.push(value) }), null);
  assert.equal(progress[0].message, 'receiving');
  assert.throws(() => decodeSideband({ kind: 'data', data: concatBytes([Uint8Array.of(3), encodeText('denied')]) }), { code: 'Network' });
});

test('v0 and v2 advertisements preserve capabilities, symbolic HEAD, peel and unborn refs', async () => {
  const legacy = await parseAdvertisement(encodePackets([
    '# service=git-upload-pack\n', `${oid} HEAD\0multi_ack_detailed side-band-64k symref=HEAD:refs/heads/main\n`,
    `${oid} refs/heads/main\n`, `${other} refs/tags/v1^{}\n`
  ]));
  assert.equal(legacy.version, 0);
  assert.equal(legacy.refs[0].symref, 'refs/heads/main');
  const remote = await parseAdvertisement(encodePackets(['version 2\n', 'ls-refs=unborn\n', 'fetch=shallow filter\n', 'object-format=sha1\n']));
  assert.equal(remote.version, 2);
  const requests = [];
  const transport = async request => {
    requests.push(request);
    return { status: 200, body: encodePackets([`${oid} HEAD symref-target:refs/heads/main\n`,
      `${other} refs/tags/v1 peeled:${oid}\n`, 'unborn refs/heads/new symref-target:refs/heads/new\n']) };
  };
  const result = await listRemoteRefs({ transport, url: 'https://git.test/repo.git', remote, prefixes: ['refs/'] });
  assert.equal(result.refs[1].peeled, oid);
  assert.equal(result.refs[2].oid, null);
  assert.match(text(requests[0].body), /ref-prefix refs\//);
});

test('v1 wants/haves and v2 fetch section demultiplexing use byte streaming', async () => {
  const legacy = { capabilities: new Map(['multi_ack_detailed', 'side-band-64k', 'thin-pack', 'ofs-delta', 'shallow']
    .map(name => [name, ''])) };
  const built = buildV1FetchRequest({ remote: legacy, wants: [oid], haves: [other], depth: 1 });
  assert.equal(built.sideband, true);
  assert.match(text(built.body), /want a+ multi_ack_detailed thin-pack ofs-delta side-band-64k/);
  assert.match(text(built.body), /deepen 1/);
  const bytes = concatBytes([encodePktLine('acknowledgments\n'), encodePktLine(`ACK ${other}\n`),
    encodePktLine({ kind: 'delimiter' }), encodePktLine('shallow-info\n'), encodePktLine(`shallow ${oid}\n`),
    encodePktLine({ kind: 'delimiter' }), encodePktLine('packfile\n'), encodePktLine(Uint8Array.of(1, 80, 65, 67, 75)),
    encodePktLine({ kind: 'end' })]);
  const result = await fetchPack({ transport: async () => ({ status: 200, body: bytes }), url: 'https://git.test/repo.git',
    wants: [oid], haves: [other], remote: { algorithm: 'sha1', version: 2, capabilities: new Map([['fetch', 'shallow']]) } });
  const chunks = [];
  for await (const chunk of result.pack) chunks.push(chunk);
  assert.equal(text(concatBytes(chunks)), 'PACK');
  assert.deepEqual(result.state.shallow, [oid]);
  assert.equal(result.state.acknowledgments[0].oid, other);
});

test('shallow options, canonical filters, batch promisor reads and cancellation', async () => {
  assert.deepEqual(shallowArguments({ shallow: [oid], depth: 10, relative: true }), [`shallow ${oid}`, 'deepen 10', 'deepen-relative']);
  assert.throws(() => shallowArguments({ depth: 1, since: 10 }), { code: 'Conflict' });
  assert.throws(() => shallowArguments({ depth: 0 }), { code: 'Corrupt' });
  assert.deepEqual([...parseShallow(encodeShallow([other, oid]))], [oid, other]);
  assert.equal(validateFilter('blob:limit=2k'), 'blob:limit=2048');
  assert.throws(() => validateFilter('combine:blob:none+tree:0'), { code: 'Unsupported' });
  const objects = new Map();
  const calls = [];
  const odb = { has: async key => objects.has(key), read: async key => objects.get(key) };
  const promisor = new PromisorDatabase({ odb, fetchObjects: async oids => {
    calls.push(oids);
    for (const key of oids) objects.set(key, { oid: key, type: 'blob', data: encodeText(key) });
  } });
  await promisor.prefetch([oid, other, oid]);
  assert.deepEqual(calls, [[oid, other]]);
  await Promise.all([promisor.read(oid), promisor.read(oid)]);
  assert.equal(calls.length, 1);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(promisor.read(oid, { signal: abort.signal }), { code: 'Cancelled' });
  promisor.dispose();
});

test('promisor local inspection and object-only fetch preserve repository metadata', async () => {
  const local = new MemoryObjectDatabase();
  const data = encodeText('object-only fetch');
  const key = await local.write('blob', data);
  let requests = 0;
  const promisor = new PromisorDatabase({ odb: local, fetchObjects: async () => { requests++; } });
  assert.equal(promisor.localDatabase, local);
  assert.equal((await promisor.readLocalHeader(key)).size, data.length);
  assert.equal((await promisor.readHeader(key)).size, data.length);
  await assert.rejects(promisor.readLocal(other), { code: 'NotFound' });
  assert.equal(requests, 0);
  await local.store.set('FETCH_HEAD', encodeText('previous fetch\n'));
  await fetchRemote({ odb: local, refs: new RefDatabase({ store: local.store }),
    remote: { refs: [], version: 2, algorithm: 'sha1', capabilities: new Map() }, wants: [key],
    refspecs: [], tags: 'none', haves: [], updateRefs: false, writeFetchHead: false });
  assert.equal(text(await local.store.get('FETCH_HEAD')), 'previous fetch\n');
  await promisor.close();
});
