import {canonicalType, XAML} from '@sharpforge/framework';
import {Scanner} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {responsiveViewportMarker} from './layout-authoring-viewport.js';
import {ownerName} from './source-symbols.js';
import {sourcePath} from './source-text.js';
import {sourceSyntaxCancellationToken} from './source-cancellation.js';
import {failSource} from './source-errors.js';

function requireOwned(condition, node, message) {
  if (!condition) failSource(message, node, 'SFSYNC_OWNERSHIP');
}

function viewportTrivia(candidate, signal) {
  const {method, parsed} = candidate;
  if (method.body?.kind !== 'Block') return null;
  const first = method.body.statements[0]?.start ?? method.body.end - 1;
  if (!parsed.source.text.slice(method.body.start, first).includes(responsiveViewportMarker)) return null;
  const text = parsed.source.text.slice(method.start, method.end);
  const scanner = new Scanner(new SourceText(text, parsed.source.uri), undefined,
    {cancellationToken: sourceSyntaxCancellationToken(signal)});
  const {raws} = scanner.sequence(null);
  requireOwned(!scanner.directives.length && !scanner.diagnostics.length, method,
    'Adaptive viewport handlers cannot own conditional directives or malformed trivia');
  const comments = raws.flatMap(token => [...(token.leading ?? []), ...(token.trailing ?? [])])
    .filter(trivia => trivia.kind.includes('Comment'))
    .map(trivia => ({start: method.start + trivia.start, end: method.start + trivia.end, text: text.slice(trivia.start, trivia.end)}));
  const markers = comments.filter(comment => comment.text === responsiveViewportMarker
    && comment.start > method.body.start && comment.end <= first);
  requireOwned(markers.length === 1, method, 'Adaptive viewport handlers require one versioned marker');
  return {marker: markers[0], comments: comments.filter(comment => comment !== markers[0] && comment.start > method.body.start)};
}

function sameMethod(reader, expression, method) {
  const expected = reader.context.model.getDeclaredSymbol(method);
  const actual = reader.context.model.getSymbolInfo(expression).symbol;
  return expected && (actual === expected || actual?.legacy && actual.legacy === expected.legacy);
}

/** Own only the exact native window event adapter, never a merely similar handwritten event handler. */
export function readResponsiveViewport(reader, adaptive) {
  const owner = ownerName(adaptive.owner);
  const candidates = reader.context.methods.filter(candidate => ownerName(candidate.owner) === owner)
    .map(candidate => ({candidate, trivia: viewportTrivia(candidate, reader.options.signal)})).filter(item => item.trivia);
  if (!candidates.length) return null;
  requireOwned(candidates.length === 1, adaptive.method, 'One owned adaptive viewport handler is supported');
  const {candidate, trivia} = candidates[0];
  const {method, parsed} = candidate;
  const parameters = method.parameters;
  requireOwned(method.modifiers?.includes('static') && method.returnType === 'void' && parameters.length === 2
    && canonicalType(parameters[0].type) === 'object' && canonicalType(parameters[1].type) === XAML + 'WindowSizeChangedEventArgs'
    && adaptive.method.parameters.length === 1, method, 'Automatic adaptive viewports require static-field targets and native event arguments');
  requireOwned(reader.context.methods.filter(item => ownerName(item.owner) === owner && item.method.name === method.name).length === 1,
    method, 'Adaptive viewport handler overloads are not designer-owned');
  const statement = method.body.statements[0];
  const call = statement?.expression;
  requireOwned(method.body.statements.length === 1 && statement.kind === 'ExpressionStatement' && call?.kind === 'Call'
    && sameMethod(reader, call, adaptive.method) && call.args.length === 1
    && sourcePath(call.args[0]) === parameters[1].name + '.Size.Width', method,
  'The owned viewport handler must only apply its native window width');
  const subscriptions = Object.values(reader.bindings).flatMap(binding =>
    (binding.events.SizeChanged?.subscriptions ?? []).filter(subscription => sameMethod(reader, subscription.expression, method))
      .map(subscription => ({binding, subscription})));
  requireOwned(subscriptions.length === 1, method, 'An adaptive viewport handler requires exactly one construction subscription');
  const {binding, subscription} = subscriptions[0];
  const window = reader.nodeMap.get(binding.id);
  requireOwned(window?.type === XAML + 'Window' && (!reader.root || reader.root === window.id), subscription.statement,
    'The adaptive viewport must observe the selected Window');
  return {...trivia, uri: parsed.source.uri, method, statement: subscription.statement, subscription,
    windowId: window.id, handlerName: method.name};
}

/** Remove only the proved generated subscription from ordinary user-event ownership and diagnostics. */
export function ownResponsiveViewport(reader, viewport) {
  if (!viewport) return;
  const binding = reader.bindings[viewport.windowId];
  const node = reader.nodeMap.get(viewport.windowId);
  const subscriptions = binding.events.SizeChanged.subscriptions.filter(item => item !== viewport.subscription);
  delete binding.events.SizeChanged;
  delete node.events.SizeChanged;
  reader.warnings = reader.warnings.filter(warning => warning.code !== 'SFSYNC_EVENT'
    || warning.node !== viewport.windowId || warning.event !== 'SizeChanged');
  if (subscriptions.length) {
    const last = subscriptions.at(-1);
    const dynamic = subscriptions.length > 1 || !last.handler;
    binding.events.SizeChanged = {...last, subscriptions, dynamic, capability: dynamic ? 'navigate' : 'edit',
      reason: subscriptions.length > 1 ? 'multiple' : !last.handler ? 'lambda' : null};
    const named = subscriptions.find(item => item.handler);
    if (named) node.events.SizeChanged = named.handler;
    if (dynamic) reader.warnings.push({code: 'SFSYNC_EVENT', node: node.id, event: 'SizeChanged',
      message: 'Existing window event subscriptions remain protected.', uri: last.expression.uri,
      start: last.expression.start, end: last.expression.end});
  }
  const region = reader.regions.find(item => item.span.start === viewport.statement.start);
  if (region) Object.assign(region, {kind: 'designer', capabilities: ['navigate', 'adaptive'], owners: [node.id]});
}
