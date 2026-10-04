import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Preserve raw compiler evidence and compare diagnostic identity, text and exact native source spans. */
function compileConsumer(context, { id, reference, name, source }) {
  const output = join(context.temporary, id, 'consumers', name + '.dll');
  const errorLog = join(context.output, id.replaceAll('/', '-') + '-diagnostics.sarif');
  mkdirSync(dirname(output), { recursive: true });
  const args = [...context.common, '-target:library', '-r:' + reference, '-out:' + output,
    '-errorlog:' + errorLog + ',version=2.1', source];
  const attempt = spawnSync(context.dotnet, args, { cwd: context.temporary, env: context.environment,
    encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (attempt.error) throw attempt.error;
  assert.equal(attempt.signal, null, 'Consumer compiler must terminate normally');
  const sarif = JSON.parse(readFileSync(errorLog, 'utf8'));
  const diagnostics = sarif.runs.flatMap(run => run.results ?? []).map(result => ({
    code: result.ruleId, level: result.level, message: result.message.text,
    locations: (result.locations ?? []).map(location => location.physicalLocation),
  }));
  const result = { status: attempt.status, diagnostics };
  writeFileSync(errorLog.replace('.sarif', '.json'), JSON.stringify({
    command: [context.dotnet, ...args], stdout: attempt.stdout, stderr: attempt.stderr, ...result,
  }, null, 2) + '\n');
  return result;
}

/** Positive contracts, native fixed-buffer reference limitation, and friend access are all checked against both images. */
export function compareReferenceConsumers(context, { id, native, emitted, friends, fixture }) {
  const friendSource = join(context.temporary, 'Friend.cs');
  writeFileSync(friendSource, 'public class FriendUse { public int Read(RefSurface.Contract c) => c.Internal(); }');
  const probes = [
    { id: 'positive', name: 'Consumer', source: join(fixture, 'positive-consumer.cs'), success: true },
    { id: 'fixed-buffers', name: 'Consumer', source: join(fixture, 'consumer.cs'), success: false },
    { id: 'friend-access', name: 'Friend', source: friendSource, success: friends },
  ];
  const observations = [];
  for (const probe of probes) {
    const expected = compileConsumer(context, { ...probe, id: id + '/' + probe.id + '/roslyn', reference: native });
    const observed = compileConsumer(context, { ...probe, id: id + '/' + probe.id + '/sharpforge', reference: emitted });
    assert.deepEqual(observed, expected, `${id}/${probe.id}: native consumer diagnostics and exact source spans must match`);
    assert.equal(expected.status, probe.success ? 0 : 1, `${probe.id}: captured native success contract`);
    if (probe.id === 'fixed-buffers') assert.deepEqual(expected.diagnostics.map(diagnostic => diagnostic.code), ['CS0648', 'CS0648', 'CS0648']);
    if (probe.id === 'friend-access' && !friends) {
      assert.equal(expected.diagnostics.length, 1);
      assert.match(expected.diagnostics[0].code, /^CS(?:1061|0122)$/);
    }
    observations.push({ id: probe.id, ...expected });
  }
  return observations;
}
