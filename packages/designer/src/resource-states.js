import {normalizeProperty} from './model.js';
import {authoringError, resourceKey} from './property-diagnostics.js';
import {refreshDesignerTemplateBindings} from './resource-preview.js';

function owner(design, target) {
  const result = target.template ? design.templates[target.template] : design.nodes.find(node => node.id === target.nodeId);
  if (!result) authoringError('SFD1853', 'Visual-state owner was not found.');
  return result;
}

function stateOwnerNodes(design, target) {
  if (!target.template) return new Map(design.nodes.map(node => [node.id, node]));
  const nodes = new Map();
  const visit = part => {
    nodes.set(part.id, part);
    (part.children ?? []).forEach(visit);
  };
  visit(owner(design, target).root);
  return nodes;
}

export function addDesignerVisualState(document, target, groupName, stateName) {
  resourceKey(groupName);
  resourceKey(stateName);
  return document.change('Add visual state ' + stateName, design => {
    const groups = owner(design, target).states ??= [];
    let group = groups.find(candidate => candidate.name === groupName);
    if (!group) groups.push(group = {name: groupName, states: [], transitions: []});
    if (group.states.some(state => state.name === stateName)) authoringError('SFD1853', 'Visual state already exists.');
    group.states.push({name: stateName, setters: []});
  });
}

export function recordDesignerStateProperty(document, target, {group: groupName, state: stateName, nodeId, property, value}) {
  return document.change('Record ' + stateName + '.' + property, design => {
    const node = stateOwnerNodes(design, target).get(nodeId);
    if (!node) authoringError('SFD1853', 'State property target was not found.');
    const state = owner(design, target).states?.find(group => group.name === groupName)?.states.find(item => item.name === stateName);
    if (!state) authoringError('SFD1853', 'Create a state before recording its properties.');
    const index = state.setters.findIndex(setter => setter.target === nodeId && setter.property === property);
    if (value === undefined) {
      if (index >= 0) state.setters.splice(index, 1);
      return;
    }
    const setter = {target: nodeId, property, value: normalizeProperty(node.type, property, value)};
    if (index >= 0) state.setters[index] = setter;
    else state.setters.push(setter);
  });
}

export function setDesignerStateTransition(document, target, groupName, {from = '', to = '', duration = 0}) {
  return document.change('Edit visual-state transition', design => {
    const group = owner(design, target).states?.find(candidate => candidate.name === groupName);
    if (!group) authoringError('SFD1853', 'Visual-state group was not found.');
    group.transitions ??= [];
    const index = group.transitions.findIndex(item => item.from === from && item.to === to);
    const transition = {from, to, duration};
    if (index >= 0) group.transitions[index] = transition;
    else group.transitions.push(transition);
  });
}

/** State projection operates on a clone; stored base values and undo history never change. */
export function projectDesignerState(scene, states, activeStates, {prefix = '', prefixes = [prefix]} = {}) {
  const result = structuredClone(scene);
  const nodes = new Map(result.nodes.map(node => [node.id, node]));
  const assigned = new Set();
  for (const group of states ?? []) {
    const state = group.states.find(candidate => candidate.name === (activeStates[group.name] ?? activeStates['*']));
    if (!state) continue;
    for (const instance of prefixes) {
      for (const setter of state.setters) {
        const node = nodes.get(instance + setter.target);
        if (node) {
          node.properties[setter.property] = structuredClone(setter.value);
          assigned.add(node.id + ':' + setter.property);
        }
      }
    }
  }
  return refreshDesignerTemplateBindings(result, assigned);
}

/** Deterministic interpolation for preview playback; unsupported compound values switch at completion. */
export function interpolateDesignerStateValue(from, to, progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) authoringError('SFD1853', 'Transition progress must be within 0–1.');
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * progress;
  if (from?.Color && to?.Color) {
    const result = structuredClone(to);
    for (const key of ['A', 'R', 'G', 'B']) result.Color[key] = Math.round(from.Color[key] + (to.Color[key] - from.Color[key]) * progress);
    return result;
  }
  return structuredClone(progress < 1 ? from : to);
}
