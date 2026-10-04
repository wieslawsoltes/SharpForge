import {validateBindingDiagnosticBatch} from '../workers/binding-diagnostics.js';

export const bindingOutputId = session => 'bindings:' + session.id;

/** Binding output remains separate from Console output, which debugger snapshots replace or rewind. */
export function appendBindingDiagnostics(session, value) {
  const batch = validateBindingDiagnosticBatch(value), output = session.output;
  if (!output) return batch;
  const channelId = bindingOutputId(session);
  output.ensure(channelId, {name: session.name + ' · Bindings', projectId: session.projectId, sessionId: session.id, kind: 'binding'});
  const identity = {projectId: session.projectId, appId: session.id, sessionId: session.id, generation: session.worker.generation,
    runtimeSession: session.runtimeSession, identity: session.identity, source: 'binding', severity: 'warning'};
  for (const record of batch.records) {
    const count = record.occurrences > 1 ? ' (' + record.occurrences + ' occurrences)' : '';
    const step = record.step === null ? '' : ', step ' + record.step;
    const text = `${record.code}: ${record.sourceType ?? '(unknown source)'}.${record.path} -> ${record.targetProperty ?? '(unknown target)'}`;
    output.append(channelId, text + step + ': ' + record.message + count + '\n', {...identity, code: record.code, diagnostic: record});
  }
  if (batch.omitted) output.append(channelId, `${batch.omitted} additional binding diagnostics exceeded the pending output limit.\n`,
    {...identity, omitted: batch.omitted});
  return batch;
}
