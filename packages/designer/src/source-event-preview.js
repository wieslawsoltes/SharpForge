import {eventsFor} from '@sharpforge/framework';

const eventProfileMessage = 'The program is valid C# but is not executable on this runtime profile: '
  + 'it uses framework events with lowered delegates';
const unavailable = reason => ({previewAvailable: false, readOnly: true, sourceWrites: false, reason});
// The legacy syntax adapter retains lambda syntax kinds; it does not expose the compiler's bound Lambda kind.
const handlerKinds = new Set(['SimpleLambdaExpression', 'ParenthesizedLambdaExpression', 'Name', 'Member']);

function eventSpans(analysis) {
  const nodes = new Map(analysis.document.nodes.map(node => [node.id, node]));
  const spans = [];
  let protectedCount = 0;
  for (const binding of Object.values(analysis.bindings)) {
    const node = nodes.get(binding.id);
    if (!node) continue;
    if (Object.values(binding.properties).some(property => property.dynamic)
      || Object.values(binding.collections ?? {}).some(collection => collection.dynamic)) return null;
    for (const [event, owned] of Object.entries(binding.events)) {
      if (!Object.hasOwn(eventsFor(node.type), event)) return null;
      for (const subscription of owned.subscriptions) {
        if (!handlerKinds.has(subscription.expression.kind) || spans.length === 4096) return null;
        if (subscription.protected) protectedCount++;
        const statement = subscription.statement;
        spans.push({nodeId: node.id, event, uri: statement.uri, start: statement.start, end: statement.end});
      }
    }
  }
  return protectedCount ? spans.sort((left, right) => left.start - right.start) : null;
}

/** Read-only inspection of closed source constructions whose only compiler errors belong to owned protected event subscriptions. */
export function designProtectedEventPreviewCapability(analysis) {
  if (analysis?.compilationSucceeded !== false || !analysis.context || !analysis.document?.nodes?.length
    || analysis.document.previewOnly || analysis.document.nodes.some(node => node.projectType)) {
    return unavailable('Protected event preview requires a raw analysis of a directly typed construction.');
  }
  const errors = analysis.compilerDiagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (!errors.length || errors.some(diagnostic => diagnostic.code !== 'SF2200' || diagnostic.message !== eventProfileMessage)) {
    return unavailable('Only the known framework-event delegate profile error permits this preview.');
  }
  if (analysis.unmanaged.length || analysis.detached.length || analysis.warnings.some(warning => warning.code !== 'SFSYNC_EVENT')) {
    return unavailable('Protected event preview requires a closed literal construction without other dynamic source.');
  }
  const spans = eventSpans(analysis);
  if (!spans) return unavailable('Event preview requires at most 4096 owned subscriptions with protected lambdas or direct handler references.');
  let index = 0;
  for (const diagnostic of [...errors].sort((left, right) => left.start - right.start)) {
    if (diagnostic.uri !== analysis.uri || !Number.isSafeInteger(diagnostic.start)
      || !Number.isSafeInteger(diagnostic.length) || diagnostic.length <= 0) {
      return unavailable('The event profile diagnostic does not identify an owned subscription.');
    }
    while (index < spans.length && spans[index].end <= diagnostic.start) index++;
    const span = spans[index];
    if (!span || span.uri !== diagnostic.uri || span.start > diagnostic.start || span.end < diagnostic.start + diagnostic.length) {
      return unavailable('The event profile diagnostic falls outside the selected construction subscriptions.');
    }
  }
  return {kind: 'events', previewAvailable: true, readOnly: true, sourceWrites: false, subscriptions: spans,
    reason: 'Framework events with lowered delegates are not executable on this runtime profile. '
      + 'The closed construction is available as a read-only preview; existing subscriptions remain navigable.'};
}
