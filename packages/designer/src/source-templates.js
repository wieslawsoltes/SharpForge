import {canonicalType, CONTROLS} from '@sharpforge/framework';
import {childSlot} from './model.js';
import {sourcePath, designIdentifier} from './source-text.js';
import {isDesignControl} from './source-symbols.js';
import {failSource} from './source-errors.js';

/** Reads the existing declarative ControlTemplate factory contract without invoking it. */
export function readSourceTemplate(method, readValue) {
  if (method.body?.kind !== 'Block') failSource('Template factories require a block body', method, 'SFSYNC_OWNERSHIP');
  const state = {parts: new Map(), templateName: null, root: null, targetType: CONTROLS + 'Button', readValue};
  for (const statement of method.body.statements) {
    if (statement.kind === 'Return') continue;
    if (statement.kind === 'Local') {
      for (const declaration of statement.declarations) templateDeclaration(state, declaration);
      continue;
    }
    if (!templateAssignment(state, statement.expression) && !templateCall(state, statement.expression)) {
      failSource('Custom template code is preserved but cannot be regenerated', statement, 'SFSYNC_OWNERSHIP');
    }
  }
  if (!state.root) failSource('Template VisualTree is missing', method, 'SFSYNC_OWNERSHIP');
  return {targetType: state.targetType, root: state.root};
}

function templateDeclaration(state, declaration) {
  const creation = declaration.initializer;
  if (creation?.kind === 'New' && canonicalType(creation.type) === CONTROLS + 'ControlTemplate') {
    state.templateName = declaration.name;
    return;
  }
  if (creation?.kind !== 'New' || !isDesignControl(creation.type) || creation.args.length) {
    failSource('Custom template construction is protected', declaration, 'SFSYNC_OWNERSHIP');
  }
  const part = {id: designIdentifier(declaration.name), type: canonicalType(creation.type), properties: {}, bindings: {}, children: []};
  for (const initializer of creation.initializers ?? []) part.properties[initializer.name] = state.readValue(initializer.expression);
  state.parts.set(declaration.name, part);
}

function templateAssignment(state, expression) {
  if (expression?.kind !== 'Assignment' || expression.operator !== '=') return false;
  const receiver = sourcePath(expression.left.target);
  const part = state.parts.get(receiver);
  if (part) {
    const child = state.parts.get(sourcePath(expression.right));
    if (child && childSlot(part.type)?.property === expression.left.name) part.children.push(child);
    else part.properties[expression.left.name] = state.readValue(expression.right);
    return true;
  }
  if (receiver === state.templateName && expression.left.name === 'VisualTree') {
    state.root = state.parts.get(sourcePath(expression.right));
    return true;
  }
  return false;
}

function templateCall(state, expression) {
  if (expression?.kind !== 'Call') return false;
  if (sourcePath(expression.target) === state.templateName + '.Bind') {
    const part = state.parts.get(sourcePath(expression.args[0]));
    const property = state.readValue(expression.args[2]);
    if (!part || !property.dependencyProperty) failSource('Invalid template binding', expression, 'SFSYNC_OWNERSHIP');
    part.bindings[state.readValue(expression.args[1])] = property.dependencyProperty;
    state.targetType = property.owner;
    return true;
  }
  if (expression.target.name !== 'Add' || expression.target.target.kind !== 'Member') return false;
  const parent = state.parts.get(sourcePath(expression.target.target.target));
  const child = state.parts.get(sourcePath(expression.args[0]));
  if (!parent || !child) return false;
  parent.children.push(child);
  return true;
}
