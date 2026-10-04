import {insertResponsiveViewport, removeResponsiveViewport} from './source-edit-responsive-viewport.js';
import {validateResponsiveDesign, responsiveSourceMarker} from './layout-authoring-responsive.js';
import {sourceLiteralEdit} from './source-literals.js';
import {responsiveSourceProperty, responsiveAssignmentMap} from './source-responsive-values.js';
import {responsiveSourceFile, responsiveSourceSignature, assertResponsiveReferencesOwned,
  emitResponsiveSource, responsiveMethodBody, responsiveMethodInsertion} from './source-responsive-emission.js';
import {sameSourceValue, sourceInsertion, sourceComments} from './source-text.js';
import {checkSourceCancellation, failSource} from './source-errors.js';
import {responsiveExpressionSpan} from './source-responsive-syntax.js';

function requireKnownFields(value, allowed, location) {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    failSource('Adaptive source contains metadata outside the versioned source profile', location, 'SFSYNC_OWNERSHIP');
  }
}

function desiredAdaptive(base, document, signal) {
  const responsive = validateResponsiveDesign(document);
  requireKnownFields(responsive, ['version', 'states'], base.method);
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const resets = new Map();
  const states = [];
  let statements = 0;
  for (const state of [...responsive.states].reverse()) {
    checkSourceCancellation(signal);
    requireKnownFields(state, ['id', 'minWidth', 'maxWidth', 'overrides'], base.method);
    const assignments = [];
    for (const [id, properties] of Object.entries(state.overrides)) {
      if (!Object.keys(properties).length) delete state.overrides[id];
      const node = nodes.get(id);
      const binding = base.bindings[id];
      for (const [property, value] of Object.entries(properties)) {
        checkSourceCancellation(signal);
        const schema = responsiveSourceProperty(node, property, binding?.creation);
        if (binding?.properties[property]?.dynamic) failSource('Adaptive source cannot replace a protected construction baseline',
          binding.properties[property].expression, 'SFSYNC_OWNERSHIP');
        assignments.push({id, property, value, present: true, type: schema.type});
        const key = id + ':' + property;
        if (!resets.has(key)) {
          resets.set(key, {id, property, type: schema.type,
            present: Object.hasOwn(node.properties, property), value: node.properties[property]});
          statements++;
        }
        if (++statements > 20_000) failSource('Adaptive statement limit exceeded', base.method, 'SFSYNC_LIMIT');
      }
    }
    statements += 2;
    if (statements > 20_000) failSource('Adaptive statement limit exceeded', base.method, 'SFSYNC_LIMIT');
    states.push({...state, assignments});
  }
  return {responsive, states, resets, targets: new Set([...resets.values()].map(reset => reset.id))};
}

function sameAssignments(before, after) {
  const mapped = responsiveAssignmentMap(after);
  return before.length === after.length && before.every(entry => mapped.get(entry.id + ':' + entry.property)?.present === entry.present);
}

function sameShape(before, after) {
  return sameAssignments(before.resets, [...after.resets.values()]) && before.states.length === after.states.length
    && before.states.every((state, index) => (state.maxWidth === null) === (after.states[index].maxWidth === null)
      && sameAssignments(state.assignments, after.states[index].assignments));
}

function literalChange(source, edits, expression, before, after, type) {
  if (sameSourceValue(before, after)) return;
  const span = responsiveExpressionSpan(source, expression);
  edits.push({uri: source.uri, ...sourceLiteralEdit(source.text, span, after, type)});
}

function assignmentEdits(source, edits, before, after) {
  const mapped = responsiveAssignmentMap(after);
  for (const entry of before) {
    if (!entry.present) continue;
    literalChange(source, edits, entry.expression, entry.value, mapped.get(entry.id + ':' + entry.property).value, entry.type);
  }
}

function matchingShapeEdits(base, desired, edits) {
  const before = base.responsiveSource;
  const source = responsiveSourceFile(base, before.method);
  assignmentEdits(source, edits, before.resets, [...desired.resets.values()]);
  for (let index = 0; index < before.states.length; index++) {
    const state = before.states[index];
    const next = desired.states[index];
    literalChange(source, edits, state.minimum, state.minWidth, next.minWidth, 'double');
    if (state.maximum) literalChange(source, edits, state.maximum, state.maxWidth, next.maxWidth, 'double');
    assignmentEdits(source, edits, state.assignments, next.assignments);
  }
  const ids = desired.states.map(state => state.id);
  if (!sameSourceValue(before.ids, ids)) edits.push({uri: source.uri, start: before.marker.start, end: before.marker.end,
    text: responsiveSourceMarker + JSON.stringify(ids)});
}

function replaceSpan(result, uri, span, text) {
  const edit = {uri, start: span.start, end: span.end, text};
  result.edits.push(edit);
  result.covered.push(edit);
}

function retainedComments(text, newline) {
  return sourceComments(text).map(comment => comment.startsWith('//') ? comment + newline : comment + ' ').join('');
}

function parameterEdits(base, signature, result) {
  const before = base.responsiveSource;
  const source = responsiveSourceFile(base, before.method);
  const parameters = before.method.parameters;
  const span = {start: parameters[0].end, end: parameters.at(-1).end};
  const comments = retainedComments(source.text.slice(span.start, span.end), source.style.newline);
  const text = signature.parameters.map(parameter => `, ${parameter.type} ${parameter.name}`).join('');
  replaceSpan(result, source.uri, span, comments + text);
  const args = before.initializerArguments;
  const argumentsSpan = {start: args[0].end, end: args.at(-1).end};
  const argumentComments = retainedComments(base.text.slice(argumentsSpan.start, argumentsSpan.end), base.style.newline);
  replaceSpan(result, base.uri, argumentsSpan, argumentComments + signature.parameters.map(parameter => ', ' + parameter.argument).join(''));
}

function signatureChanged(before, signature) {
  return !sameSourceValue(before.targets.map(({id, name, type}) => ({id, name, type})),
    signature.parameters.map(({id, name, type}) => ({id, name, type})));
}

function removeAdaptive(base, result) {
  assertResponsiveReferencesOwned(base);
  removeResponsiveViewport(base, result);
  const before = base.responsiveSource;
  const source = responsiveSourceFile(base, before.method);
  const header = sourceComments(source.text.slice(before.method.start, before.method.body.start));
  const comments = [...header, ...before.comments.map(comment => comment.text)]
    .map(comment => source.style.methodIndent + comment).join(source.style.newline);
  replaceSpan(result, source.uri, before.method, comments + (comments ? source.style.newline : ''));
  const initializer = base.text.slice(before.initializer.start, before.initializer.end);
  replaceSpan(result, base.uri, before.initializer, retainedComments(initializer, base.style.newline));
  result.structural = true;
}

/** Plans only proved helper/initializer edits; existing all-file conflict and compilation gates remain authoritative. */
export function sourceResponsiveEdits(base, document, names, options = {}) {
  const result = {edits: [], covered: [], structural: false};
  if (!base.responsiveSource && !document.responsive) return result;
  const desired = desiredAdaptive(base, document, options.signal);
  const before = base.responsiveSource;
  if (!desired.states.length) {
    if (before) removeAdaptive(base, result);
    return result;
  }
  if (!before && base.unmanaged.length) {
    failSource('Adding adaptive source requires an owned construction region; existing helper calls remain protected',
      base.unmanaged[0].statement, 'SFSYNC_OWNERSHIP');
  }
  const signature = responsiveSourceSignature(base, document, names, desired.targets);
  if (!before) {
    const generated = emitResponsiveSource({...document, responsive: desired.responsive}, signature, options.signal);
    result.edits.push(responsiveMethodInsertion(base, generated), {uri: base.uri, ...sourceInsertion(base, generated.initializers)});
    insertResponsiveViewport(base, generated, result);
    result.structural = true;
    return result;
  }
  const changedSignature = signatureChanged(before, signature);
  if (changedSignature) {
    assertResponsiveReferencesOwned(base);
    parameterEdits(base, signature, result);
    if (before.viewport && !signature.viewport) removeResponsiveViewport(base, result);
  }
  if (sameShape(before, desired) && !changedSignature) matchingShapeEdits(base, desired, result.edits);
  else {
    const generated = emitResponsiveSource({...document, responsive: desired.responsive}, signature, options.signal);
    const source = responsiveSourceFile(base, before.method);
    replaceSpan(result, source.uri, before.method.body, responsiveMethodBody(generated, source, before.comments));
    result.structural = true;
  }
  literalChange(base, result.edits, before.widthExpression, before.width, document.width, 'double');
  return result;
}
