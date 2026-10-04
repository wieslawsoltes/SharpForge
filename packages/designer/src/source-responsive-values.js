import {canonicalType} from '@sharpforge/framework';
import {normalizeProperty, propertySchema} from './model.js';
import {sourcePath, sameSourceValue} from './source-text.js';
import {readSourceValue} from './source-values.js';
import {DesignSyncError, checkSourceCancellation, failSource} from './source-errors.js';

function fail(node, message = 'Adaptive helpers contain an unowned or edited statement') {
  failSource(message, node, 'SFSYNC_OWNERSHIP');
}

/** Helper constants bind in their own method; typed arithmetic/casts come from the compiler's constant-value contract. */
export function responsiveValueReader(reader) {
  const state = {
    context: reader.context,
    lookup: () => undefined,
    constantValue(expression) {
      checkSourceCancellation(reader.options.signal);
      const value = reader.context.model.getConstantValue(expression);
      if (!value.hasValue && ['Unary', 'Binary', 'Cast', 'Checked', 'Unchecked'].includes(expression.kind)) {
        fail(expression, 'Adaptive operators require a compiler-proven closed constant');
      }
      return value;
    }
  };
  return expression => readSourceValue(expression, state);
}

export function readResponsiveValue(readValue, expression) {
  try { return readValue(expression); }
  catch (error) {
    if (!(error instanceof DesignSyncError) || ['SFSYNC_LIMIT', 'SFSYNC_CANCELLED'].includes(error.code)) throw error;
    fail(expression, 'Adaptive values must be closed supported constants: ' + error.message);
  }
}

export function responsiveSourceProperty(target, property, location) {
  const schema = target && propertySchema(target.type)[property];
  if (!target || !schema || schema.readOnly || schema.isStatic || property === 'Name') fail(location);
  if (target.children.length && property === 'Content') fail(location, 'Adaptive source cannot replace an existing visual child');
  if (target.bindings?.[property] || target.resourceReferences?.[property] || target.templatePropertyBindings?.[property]) {
    fail(location, 'Adaptive resets cannot replace a protected local value source');
  }
  return schema;
}

/** Decode only the emitted property assignment, registered attached setter, or matching ClearValue form. */
export function readResponsiveAssignment(statement, resolve, readValue) {
  const expression = statement.expression;
  if (statement.kind !== 'ExpressionStatement') fail(statement);
  let target;
  let property;
  let valueExpression;
  let present = true;
  if (expression?.kind === 'Assignment' && expression.operator === '=' && expression.left.kind === 'Member') {
    target = resolve(expression.left.target);
    property = expression.left.name;
    valueExpression = expression.right;
    if (target && propertySchema(target.type)[property]?.attached) fail(expression);
  } else if (expression?.kind === 'Call' && expression.target.kind === 'Member') {
    const call = expression.target;
    if (call.name === 'ClearValue' && expression.args.length === 1) {
      target = resolve(call.target);
      const dependency = readResponsiveValue(readValue, expression.args[0]);
      property = target && Object.entries(propertySchema(target.type)).find(([name, schema]) =>
        (schema.member ?? name) === dependency?.dependencyProperty
        && canonicalType(schema.owner ?? target.type) === dependency.owner)?.[0];
      present = false;
    } else if (call.name.startsWith('Set') && expression.args.length === 2) {
      target = resolve(expression.args[0]);
      const owner = canonicalType(sourcePath(call.target));
      property = target && Object.entries(propertySchema(target.type)).find(([name, schema]) =>
        schema.attached && canonicalType(schema.owner) === owner && 'Set' + (schema.member ?? name) === call.name)?.[0];
      valueExpression = expression.args[1];
    }
  }
  const schema = responsiveSourceProperty(target, property, statement);
  let value;
  if (present) {
    const literal = readResponsiveValue(readValue, valueExpression);
    try { value = normalizeProperty(target.type, property, literal); }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      fail(valueExpression, 'Adaptive property value is invalid: ' + error.message);
    }
  }
  return {id: target.id, property, present, ...(present ? {value} : {}),
    expression: valueExpression, statement, type: schema.type};
}

function widthComparison(expression, operator, width, readValue) {
  if (expression?.kind !== 'Binary' || expression.operator !== operator
    || expression.left.kind !== 'Name' || expression.left.name !== width) fail(expression);
  const value = readResponsiveValue(readValue, expression.right);
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(expression, 'Adaptive thresholds require finite closed constants');
  return {value, expression: expression.right};
}

/** The declared order is checked separately against the responsive state's highest-minimum rule. */
export function readResponsiveCondition(expression, width, readValue) {
  const pair = expression?.kind === 'Binary' && expression.operator === '&&';
  const minimum = widthComparison(pair ? expression.left : expression, '>=', width, readValue);
  const maximum = pair ? widthComparison(expression.right, '<', width, readValue) : null;
  return {minWidth: minimum.value, maxWidth: maximum?.value ?? null,
    minimum: minimum.expression, maximum: maximum?.expression ?? null};
}

export function responsiveAssignmentMap(entries) {
  const result = new Map();
  for (const entry of entries) {
    const key = entry.id + ':' + entry.property;
    if (result.has(key)) fail(entry.statement, 'Adaptive properties must appear exactly once in each reset or state');
    result.set(key, entry);
  }
  return result;
}

export function assertResponsiveResets(resets, states, nodes) {
  const actual = responsiveAssignmentMap(resets);
  const expected = new Set(states.flatMap(state => state.assignments.map(entry => entry.id + ':' + entry.property)));
  if (actual.size !== expected.size || [...actual.keys()].some(key => !expected.has(key))) {
    fail(resets[0]?.statement, 'Adaptive resets must cover exactly the authored state properties');
  }
  for (const reset of resets) {
    const node = nodes.get(reset.id);
    const present = Object.hasOwn(node.properties, reset.property);
    if (present !== reset.present || present && !sameSourceValue(node.properties[reset.property], reset.value)) {
      fail(reset.statement, 'Adaptive reset differs from its construction baseline; reconcile both values in Code view');
    }
  }
}
