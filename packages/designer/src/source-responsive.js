import {canonicalType} from '@sharpforge/framework';
import {validateResponsiveDesign} from './layout-authoring-responsive.js';
import {ownerName} from './source-symbols.js';
import {sourcePath, sameSourceValue} from './source-text.js';
import {responsiveMethodTrivia} from './source-responsive-trivia.js';
import {readResponsiveAssignment, readResponsiveCondition, readResponsiveValue, responsiveValueReader, responsiveAssignmentMap,
  assertResponsiveResets} from './source-responsive-values.js';
import {responsiveInvocationArguments} from './source-responsive-syntax.js';
import {checkSourceCancellation, failSource} from './source-errors.js';

const maxStatements = 20_000;

function ownedCheck(condition, node, message) {
  if (!condition) failSource(message, node, 'SFSYNC_OWNERSHIP');
}

function constructorReferences(reader) {
  const references = new Map();
  const owner = ownerName(reader.context.chosen.owner);
  const shortOwner = reader.context.chosen.owner?.name;
  for (const binding of Object.values(reader.bindings)) {
    references.set(binding.name, binding);
    if (!binding.field || binding.statement.kind === 'Local') continue;
    references.set('this.' + binding.name, binding);
    references.set(shortOwner + '.' + binding.name, binding);
    references.set(owner + '.' + binding.name, binding);
  }
  return references;
}

function parameterBindings(reader, method, initializer) {
  const parameters = method.parameters;
  const argumentsList = initializer.expression.args;
  ownedCheck(method.modifiers?.includes('static') && method.returnType === 'void' && parameters.length >= 1
    && canonicalType(parameters[0].type) === 'double' && argumentsList.length === parameters.length, method,
  'Adaptive helpers require a static void method and an exact width/control argument list');
  const references = constructorReferences(reader);
  const bindings = new Map();
  const targets = [];
  for (let index = 1; index < parameters.length; index++) {
    const parameter = parameters[index];
    const binding = references.get(sourcePath(argumentsList[index]));
    const node = binding && reader.nodeMap.get(binding.id);
    ownedCheck(node && canonicalType(parameter.type) === node.type && parameter.name !== parameters[0].name
      && !bindings.has(parameter.name), parameter,
      'Adaptive parameters must bind to distinct named controls in this construction');
    bindings.set(parameter.name, node);
    targets.push({id: node.id, name: parameter.name, type: node.type});
  }
  const resolve = expression => {
    const path = sourcePath(expression);
    if (bindings.has(path)) return bindings.get(path);
    if (path === parameters[0].name) return null;
    const binding = references.get(path);
    if (!binding?.field || binding.statement.kind === 'Local' || !binding.fieldDeclaration?.modifiers?.includes('static')) return null;
    return reader.nodeMap.get(binding.id);
  };
  return {resolve, targets, widthName: parameters[0].name};
}

function readStates(reader, candidate, trivia, resolve, widthName) {
  const {method} = candidate;
  const resets = [];
  const states = [];
  const readValue = responsiveValueReader(reader);
  let statements = 0;
  for (const statement of method.body.statements) {
    checkSourceCancellation(reader.options.signal);
    if (++statements > maxStatements) failSource('Adaptive statement limit exceeded', statement, 'SFSYNC_LIMIT');
    if (statement.kind !== 'If' && !states.length) {
      resets.push(readResponsiveAssignment(statement, resolve, readValue));
      continue;
    }
    ownedCheck(statement.kind === 'If' && !statement.otherwise && statement.then.kind === 'Block', statement,
      'Adaptive helpers contain only baseline resets and ordered width-trigger blocks');
    const body = statement.then.statements;
    ownedCheck(body.length && body.at(-1).kind === 'Return' && !body.at(-1).expression, statement,
      'Every adaptive state must end with its own void return');
    statements += body.length;
    if (statements > maxStatements || states.length >= 64) failSource('Adaptive statement limit exceeded', statement, 'SFSYNC_LIMIT');
    const assignments = body.slice(0, -1).map(item => {
      checkSourceCancellation(reader.options.signal);
      return readResponsiveAssignment(item, resolve, readValue);
    });
    responsiveAssignmentMap(assignments);
    ownedCheck(assignments.every(assignment => assignment.present), statement, 'Adaptive states require concrete property values');
    const range = readResponsiveCondition(statement.condition, widthName, readValue);
    const overrides = {};
    for (const assignment of assignments) (overrides[assignment.id] ??= {})[assignment.property] = assignment.value;
    states.push({id: trivia.ids[states.length], ...range, overrides, assignments, statement});
  }
  ownedCheck(states.length === trivia.ids.length, method, 'Adaptive state identities do not match their width-trigger blocks');
  for (const reset of resets) ownedCheck(!reader.bindings[reset.id]?.properties[reset.property]?.dynamic, reset.statement,
    'Adaptive helpers cannot own a protected construction baseline');
  assertResponsiveResets(resets, states, reader.nodeMap);
  const value = validateResponsiveDesign({nodes: reader.nodes, responsive: {version: 1,
    states: states.map(({id, minWidth, maxWidth, overrides}) => ({id, minWidth, maxWidth, overrides}))}});
  ownedCheck(sameSourceValue([...value.states].reverse().map(state => state.id), trivia.ids), method,
    'Adaptive source order must implement the declared highest-minimum-width rule');
  return {value, resets, states};
}

function helperInitializer(reader, candidate) {
  const {method, owner} = candidate;
  const names = new Set([method.name, owner.name + '.' + method.name, ownerName(owner) + '.' + method.name]);
  const statements = reader.context.chosen.method.body.statements;
  const calls = statements.filter(statement => statement.kind === 'ExpressionStatement'
    && statement.expression?.kind === 'Call' && names.has(sourcePath(statement.expression.target)));
  ownedCheck(calls.length === 1, method, 'An adaptive helper requires exactly one owned construction initializer');
  const initializer = calls[0];
  const expected = reader.context.model.getDeclaredSymbol(method);
  const actual = reader.context.model.getSymbolInfo(initializer.expression).symbol;
  ownedCheck(expected && (actual === expected || actual?.legacy && actual.legacy === expected.legacy), initializer,
    'Adaptive initializer must bind to the declared owned helper');
  const index = statements.indexOf(initializer);
  ownedCheck(statements.slice(index + 1).every(statement => statement.kind === 'Return' || statement.kind === 'Empty'
    || statement.expression?.kind === 'Call' && statement.expression.target?.name === 'Activate'), initializer,
  'The adaptive initializer must follow all construction and property statements');
  return initializer;
}

/** Materialize responsive metadata only after semantic construction identities and every helper statement are proved. */
export function readSourceResponsive(reader) {
  const owner = ownerName(reader.context.chosen.owner);
  const candidates = [];
  for (const candidate of reader.context.methods) {
    checkSourceCancellation(reader.options.signal);
    if (ownerName(candidate.owner) !== owner) continue;
    const trivia = responsiveMethodTrivia(candidate, reader.options.signal);
    if (trivia) candidates.push({candidate, trivia});
  }
  if (!candidates.length) return null;
  ownedCheck(candidates.length === 1, candidates[0].candidate.method, 'One responsive helper is supported per construction owner');
  const {candidate, trivia} = candidates[0];
  const {method, parsed} = candidate;
  ownedCheck(candidate.owner, method, 'Adaptive helpers require a containing class');
  ownedCheck(reader.context.methods.filter(item => ownerName(item.owner) === owner && item.method.name === method.name).length === 1,
    method, 'Adaptive helper overloads are not designer-owned');
  const initializer = helperInitializer(reader, candidate);
  const initializerArguments = responsiveInvocationArguments(reader.context.chosen.parsed, initializer.expression);
  const {resolve, targets, widthName} = parameterBindings(reader, method, initializer);
  const width = readResponsiveValue(responsiveValueReader(reader), initializer.expression.args[0]);
  ownedCheck(typeof width === 'number' && Number.isFinite(width) && width >= 100 && width <= 10000, initializer,
    'Adaptive initialization width must be a closed 100–10000 pixel value');
  const result = readStates(reader, candidate, trivia, resolve, widthName);
  const ids = new Set(result.resets.map(reset => reset.id));
  ownedCheck(new Set(targets.map(target => target.id)).size === targets.length
    && targets.every(target => ids.has(target.id)), method, 'Adaptive parameters cannot contain unused or repeated controls');
  reader.unmanaged = reader.unmanaged.filter(item => item.statement !== initializer);
  const region = reader.regions.find(item => item.span.start === initializer.start);
  if (region) {
    region.kind = 'designer';
    region.capabilities = ['navigate', 'adaptive'];
    region.owners = [...ids];
  }
  return {...result, ...trivia, owned: true, uri: parsed.source.uri, method, initializer,
    width, widthExpression: initializer.expression.args[0], initializerArguments, targets, widthName};
}
