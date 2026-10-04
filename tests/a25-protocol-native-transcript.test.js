import test from 'node:test';
import assert from 'node:assert/strict';
import { PktLineDecoder, decodePktLines, encodePktLine } from '../packages/git/src/index.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';

async function* fragments(bytes, width) {
  for (let offset = 0; offset < bytes.length; offset += width) yield bytes.subarray(offset, offset + width);
}

// SF-A25-T02.1: capture native upload-pack output at runtime; no authored packet bytes supply the reference.
test('captured native upload-pack advertisement decodes to its exact refs and control sequence across fragment boundaries', async context => {
  const available = await gitAvailability();
  if (!available.available) { context.skip(available.reason); return; }
  context.diagnostic(`Reference: ${available.version}; captured upload-pack --advertise-refs stdout`);
  const workspace = await fixtureWorkspace('sharpforge-a25-pkt-capture-');
  try {
    await workspace.git(['init', '-q', '--bare', '--initial-branch=main']);
    const blob = (await workspace.git(['hash-object', '-w', '--stdin'], { input: 'captured fixture\n' })).text;
    const tree = (await workspace.git(['mktree'], { input: `100644 blob ${blob}\tREADME.md\n` })).text;
    const tip = (await workspace.git(['commit-tree', tree, '-m', 'captured advertisement'])).text;
    await workspace.git(['update-ref', 'refs/heads/main', tip]);
    await workspace.git(['update-ref', 'refs/heads/topic', tip]);
    await workspace.git(['tag', '-a', 'v1', '-m', 'captured annotated tag', tip]);
    const expected = (await workspace.git(['show-ref', '--head', '--dereference'])).text.split('\n');
    const transcript = (await workspace.git(['upload-pack', '--stateless-rpc', '--advertise-refs', workspace.root],
      { env: { GIT_PROTOCOL: 'version=0' } })).stdout;
    let reference;
    for (const width of [1, 3, 7, 257, transcript.length]) {
      const packets = [];
      for await (const packet of decodePktLines(fragments(transcript, width))) packets.push(packet);
      assert.deepEqual(packets.map(packet => packet.kind), [...expected.map(() => 'data'), 'flush']);
      const lines = packets.slice(0, -1).map(packet => new TextDecoder().decode(packet.data));
      assert.deepEqual(lines.map(line => line.split('\0', 1)[0].trimEnd()), expected);
      assert.ok(lines[0].split('\0')[1].includes('symref=HEAD:refs/heads/main'));
      const roundtrip = Buffer.concat(packets.map(packet => Buffer.from(encodePktLine(packet.kind === 'data' ? packet.data : packet))));
      assert.deepEqual(roundtrip, transcript);
      if (reference) assert.deepEqual(lines, reference);
      reference = lines;
    }
    const truncated = new PktLineDecoder();
    truncated.push(transcript.subarray(0, transcript.length - 1));
    assert.throws(() => truncated.finish(), { code: 'Corrupt' });
  } finally { await workspace.dispose(); }
});
