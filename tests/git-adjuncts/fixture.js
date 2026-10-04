import { createGitService, createRepository } from '../../packages/git/src/factory.js';
import { encodeCommit, encodeTree } from '../../packages/git/src/objects.js';
import { writePack } from '../../packages/git/src/pack/writer.js';
import { encodePackets, encodePktLine } from '../../packages/git/src/protocol/pktline.js';
import { concatBytes } from '../../packages/git/src/protocol/bytes.js';

export const identity = { name: 'Adjunct Fixture', email: 'adjunct@example.test', timestamp: 1700000000, timezone: '+0000' };
export const text = value => new TextEncoder().encode(value);
export const decode = value => new TextDecoder().decode(value);
export const remoteUrl = 'https://git.test/fixture.git';

export async function openService(t, input = {}, options = {}) {
  const service = createGitService(options);
  t.after(() => service.dispose());
  await service.request('init', { filemode: true, ...input });
  return { service, repo: service.repositories.get(input.repositoryId ?? 'default').repository };
}

export async function commitFiles(repo, files, message = 'fixture') {
  for (const [path, value] of Object.entries(files)) {
    await repo.worktree.write(path, value?.data ?? value, { mode: value?.mode });
  }
  await repo.add(Object.keys(files).map(path => `:(literal)${path}`));
  return repo.commit({ message, author: identity, committer: identity });
}

export async function authorize(service, { url = remoteUrl, origins = [new URL(url).origin], write = false } = {}) {
  const remoteId = new URL(url).origin;
  await service.request('git.auth', { method: 'grant', input: { remoteId, origins, consent: true } });
  if (write) await service.request('git.auth', { method: 'setCredential', input: {
    id: 'fixture-credential', credential: { provider: 'github', kind: 'pat', accessToken: 'fixture-access-token',
      scopes: ['repo'], allowedOrigins: [remoteId] }
  } });
  return { remoteId, ...(write ? { credentialId: 'fixture-credential',
    writeConsent: { confirmed: true, remoteId, scope: 'push' } } : {}) };
}

export async function objectFixture(t, { algorithm = 'sha1' } = {}) {
  const opened = await createRepository({ algorithm });
  t.after(opened.dispose);
  const repo = opened.repository;
  const blob = await repo.odb.write('blob', text('fixture content\n'));
  const tree = await repo.odb.write('tree', encodeTree([{ name: 'README.md', mode: 0o100644, oid: blob }], { algorithm }));
  const tip = await repo.odb.write('commit', encodeCommit({
    tree, parents: [], author: identity, committer: identity, message: 'fixture'
  }, { algorithm }));
  const objects = await Promise.all((await repo.odb.list()).map(oid => repo.odb.read(oid)));
  const full = (await writePack(objects, { algorithm })).pack;
  const metadata = (await writePack(objects.filter(object => object.type !== 'blob'), { algorithm })).pack;
  const content = (await writePack(objects.filter(object => object.type === 'blob'), { algorithm })).pack;
  return { repo, blob, tree, tip, objects, full, metadata, content, algorithm };
}

export function smartResponse(fixture, request, { partial = false } = {}) {
  if (request.method === 'GET') return new Response(encodePackets([
    'version 2\n', 'ls-refs=unborn\n', 'fetch=shallow filter\n', 'object-format=' + fixture.algorithm + '\n'
  ]));
  const body = decode(request.body);
  if (body.includes('command=ls-refs')) return new Response(encodePackets([
    fixture.tip + ' HEAD symref-target:refs/heads/main\n', fixture.tip + ' refs/heads/main\n'
  ]));
  const pack = partial ? body.includes('filter blob:none') ? fixture.metadata : fixture.content : fixture.full;
  return new Response(concatBytes([encodePktLine('packfile\n'), encodePktLine(concatBytes([Uint8Array.of(1), pack])),
    encodePktLine({ kind: 'flush' })]));
}
