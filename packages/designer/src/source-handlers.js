import {eventsFor, frameworkType} from '@sharpforge/framework';
import {sourceInsertion} from './source-text.js';
import {finishSourcePlan, assertSourceBaseline} from './source-plan.js';
import {failSource} from './source-errors.js';

function handlerName(name, event) {
  const bare = name.replace(/^v_/, '');
  return 'On' + bare[0].toUpperCase() + bare.slice(1) + event;
}

/** Creates a delegate-correct handler once, or returns navigation to the existing subscription. */
export function planDesignEventHandler(base, nodeId, event = 'Click', options = {}) {
  assertSourceBaseline(base, options.currentSources ?? base.sources);
  const node = base.document.nodes.find(candidate => candidate.id === nodeId);
  const binding = base.bindings[nodeId];
  if (!node || !binding) failSource('Unknown control for event handler', null, 'SFSYNC_EVENT');
  const delegateName = eventsFor(node.type)[event];
  const delegate = frameworkType(delegateName);
  if (!delegate || delegate.kind !== 'delegate') failSource('Event delegate signature is not available', binding.creation, 'SFSYNC_EVENT');
  const current = binding.events[event];
  if (current) {
    const subscription = current.subscriptions[0];
    return {...finishSourcePlan(base, []), navigation: subscription.location ?? {
      uri: base.uri, start: subscription.expression.start, end: subscription.expression.end}, existing: true,
      readOnly: current.dynamic, handler: subscription.handler};
  }
  if (!base.owner) failSource('Event handlers require a containing class', base.method, 'SFSYNC_EVENT');
  const preferred = options.name ?? handlerName(node.properties.Name ?? binding.name, event);
  let name = preferred;
  let suffix = 1;
  const existingNames = new Set(base.context.symbols.map(symbol => symbol.name));
  while (existingNames.has(name)) name = preferred + suffix++;
  if (!/^[A-Za-z_]\w*$/.test(name)) failSource('Invalid handler identifier', binding.creation, 'SFSYNC_EVENT');
  const style = base.style;
  const parameters = delegate.parameters.map((type, index) => `${type} ${index === 0 ? 'sender' : index === 1 ? 'args' : 'arg' + index}`);
  const modifier = base.method.modifiers?.includes('static') ? 'static ' : '';
  const signature = `${style.methodIndent}private ${modifier}${delegate.result} ${name}(${parameters.join(', ')})`;
  const body = delegate.result === 'void' ? '' : `${style.indent}return default(${delegate.result});${style.newline}`;
  const method = style.braceOnNewLine
    ? `${signature}${style.newline}${style.methodIndent}{${style.newline}${body}${style.methodIndent}}`
    : `${signature} {${style.newline}${body}${style.methodIndent}}`;
  const subscribe = sourceInsertion(base, [`${binding.name}.${event} += ${name};`]);
  const insert = {uri: base.uri, start: base.owner.end - 1, end: base.owner.end - 1,
    text: style.newline + method + style.newline};
  const result = finishSourcePlan(base, [{...subscribe, uri: base.uri}, insert], options);
  const created = result.analysis.context.methods.find(candidate => candidate.method.name === name)?.method;
  return {...result, handler: name, existing: false, navigation: {uri: created?.uri ?? base.uri,
    start: created?.body.start + 1, end: created?.body.start + 1}};
}
