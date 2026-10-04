import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {hostedEnvironment} from './hosted-environment.js';
import {hostedResources} from './hosted-plan.js';
import {assessHostedResult} from './hosted-results.js';
import {readJson, retainReference, sourceIdentity, writeJson} from './hosted-provenance.js';
import {runHostedProcess} from './hosted-process.js';
import {verifyHostedReference} from './hosted-reference-check.js';

/** Independent misses continue; setup, mutation and cancellation never become timing observations. */
export async function runHostedQueue(context, services = {}) {
  const run = services.run ?? runHostedProcess;
  const identity = services.identity ?? sourceIdentity;
  const observe = services.observe ?? hostedEnvironment;
  const read = services.read ?? readJson;
  const retain = services.retain ?? retainReference;
  const verifyReference = services.verifyReference ?? verifyHostedReference;
  const {journal, product, directory, signal, save} = context;
  for (const record of journal.commands) {
    if (signal?.aborted) {
      record.status = 'not-run';
      record.reason = 'Whole-queue cancellation or infrastructure deadline';
      save();
      continue;
    }
    const blocked = record.dependencies.filter(id =>
      journal.commands.find(item => item.id === id)?.assessment?.status !== 'satisfied');
    if (blocked.length) {
      record.status = 'blocked';
      record.reason = 'Required prerequisite did not complete: ' + blocked.join(', ');
      save();
      continue;
    }
    try {
      record.sourceBefore = identity(product, journal.expectedCommit);
    } catch (error) {
      journal.provenanceFailure = {message: error.message, beforeCommand: record.id};
      for (const remaining of journal.commands.filter(item => item.status === 'pending')) {
        remaining.status = 'blocked';
        remaining.reason = 'Source/dependency provenance failed';
      }
      save();
      break;
    }
    record.status = 'running';
    record.command = [process.execPath, ...record.argv];
    record.cwd = product;
    record.resources = {...hostedResources, NODE_OPTIONS: process.env.NODE_OPTIONS ?? null};
    writeJson(join(directory, record.id + '.before.json'), observe());
    save();
    process.stdout.write(record.id + ': starting\n');
    try {
      record.process = await run({argv: record.argv, cwd: product, log: join(directory, record.id + '.log'), signal,
        env: {...process.env, ...hostedResources,
          GIT_AUTHOR_NAME: 'A05 qualification reference', GIT_AUTHOR_EMAIL: 'a05-reference@invalid.example',
          GIT_COMMITTER_NAME: 'A05 qualification reference', GIT_COMMITTER_EMAIL: 'a05-reference@invalid.example'}});
      record.sourceAfter = identity(product, journal.expectedCommit);
      const report = read(record.output);
      if (record.kind === 'reference' && record.process.exitCode === 0) retain(directory, product, report);
      if (record.kind === 'profiler-off') {
        record.referenceAfter = await verifyReference({directory, product, signal});
        if (record.referenceAfter.process.exitCode !== 0 || record.referenceAfter.report.status !== 'validated' ||
            record.referenceAfter.report.sourceCommit !== journal.expectedCommit) {
          throw new Error('Strict profiler reference verification failed after the comparison');
        }
      }
      record.assessment = assessHostedResult(record, record.process, report, journal.expectedCommit);
      record.status = 'completed';
    } catch (error) {
      record.status = 'failed';
      record.error = {name: error.name, message: error.message};
      record.assessment = {status: 'unmet', reason: 'Execution, report or source verification failed'};
    } finally {
      writeJson(join(directory, record.id + '.after.json'), observe());
      save();
      process.stdout.write(`${record.id}: ${record.status}; exit=${record.process?.exitCode ?? 'unavailable'}; ` +
        `assessment=${record.assessment?.status ?? 'unavailable'}\n`);
    }
    // A missing report is a recorded failure. A mutated product blocks every subsequent measurement.
    if (!record.sourceAfter) {
      try { identity(product, journal.expectedCommit); }
      catch (error) {
        journal.provenanceFailure = {message: error.message, afterCommand: record.id};
        for (const remaining of journal.commands.filter(item => item.status === 'pending')) {
          remaining.status = 'blocked';
          remaining.reason = 'Source/dependency provenance failed';
        }
        save();
        break;
      }
    }
  }
}

export function markUnfinished(journal) {
  for (const record of journal.commands) {
    if (!['pending', 'running'].includes(record.status)) continue;
    record.reason = record.status === 'running' ? 'Orchestrator interrupted before recording completion' :
      'Prerequisite failure or job interruption prevented this planned command';
    record.status = 'not-run';
  }
  if (!existsSync(journal.directory)) throw new Error('Evidence directory disappeared');
}
