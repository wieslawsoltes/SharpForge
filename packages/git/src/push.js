import { checkCancelled } from './errors.js';
import { discoverRemote } from './protocol/v2.js';
import { sendPack } from './protocol/push.js';
import { writePack } from './pack/writer.js';
import { validatePushPolicy } from './push-policy.js';
import { collectReachable } from './remote-graph.js';
import { parseShallow } from './shallow.js';

/** Push only objects unreachable from advertised remote tips and retain exact server-side old-ID leases. */
export async function pushRemote(options) {
  const { odb, refs, signal, algorithm = 'sha1', remoteName = 'origin' } = options;
  checkCancelled(signal);
  const remote = options.remote ?? await discoverRemote({ ...options, service: 'git-receive-pack' });
  const selected = options.updates ? null : await refs.resolve(options.ref ?? 'HEAD', { signal });
  const requested = options.updates ?? [{ name: options.remoteRef ?? selected.ref,
    newOid: options.oid ?? selected.oid }];
  const updates = await validatePushPolicy({ ...options, updates: requested, remoteRefs: remote.refs });
  const shallow = parseShallow(await odb.store?.get('shallow', { signal }), { algorithm });
  const excluded = await collectReachable({ odb, tips: remote.refs.map(ref => ref.oid), algorithm, shallow, signal, allowMissing: true });
  const outgoing = await collectReachable({ odb, tips: updates.map(update => update.newOid), exclude: excluded, algorithm, shallow, signal });
  if (options.lfs) await options.lfs.uploadPointers({ odb, oids: [...outgoing], signal });
  const objects = [];
  for (const oid of outgoing) objects.push(await odb.read(oid, { signal }));
  const encoded = await writePack(objects, { ...options, deltas: remote.capabilities.has('ofs-delta') && options.deltas !== false });
  const status = await sendPack({ ...options, remote, updates, pack: updates.some(update => update.newOid) ? encoded.pack : null });
  const tracking = [];
  for (const update of updates) if (update.name.startsWith('refs/heads/')) {
    const name = `refs/remotes/${remoteName}/${update.name.slice(11)}`;
    tracking.push({ name, oid: update.newOid, expected: await refs.read(name), message: 'push tracking update' });
  }
  if (tracking.length) await refs.transaction(tracking, { signal });
  return { ...status, objects: outgoing.size, bytes: encoded.pack.length };
}
