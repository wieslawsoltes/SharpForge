import {normalizeProperty, propertySchema} from './model.js';
import {authoringError, boundedArray, finiteNumber, samePropertyValue} from './property-diagnostics.js';

function indexScene(scene) {
  if (scene?.version !== 1 || !Array.isArray(scene.windows)) authoringError('SFD1855', 'A transition requires valid preview scenes.');
  const nodes = boundedArray(scene.nodes, 10000, 'Transition nodes');
  const index = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.properties || index.has(node.id)) {
      authoringError('SFD1855', 'Transition node identities must be unique.');
    }
    index.set(node.id, node);
  }
  return index;
}

function transitionProperty(node, property, from, to) {
  if (property === 'Name') authoringError('SFD1855', 'A transition cannot change a control identity.');
  if (from !== undefined) from = normalizeProperty(node.type, property, from);
  if (to !== undefined) to = normalizeProperty(node.type, property, to);
  const command = {op: 'set', id: node.id, property, value: structuredClone(from)};
  const numeric = propertySchema(node.type)[property]?.type === 'double' && typeof from === 'number' && typeof to === 'number';
  const color = from?.Color && to?.Color ? structuredClone(from) : null;
  return {from, to, command, numeric, color};
}

/**
 * Precomputes a bounded property delta between two scenes. Sampling is O(changed properties), uses a borrowed command array,
 * and never mutates either caller scene. Elapsed time and duration are milliseconds. Undefined values restore preview defaults.
 */
export class DesignerStateTransition {
  constructor(fromScene, toScene, {duration = 150} = {}) {
    this.duration = finiteNumber(duration, {label: 'Transition duration (ms)', minimum: 0, maximum: 60000});
    this.initialScene = structuredClone(fromScene);
    const before = indexScene(this.initialScene);
    const after = indexScene(toScene);
    if (before.size !== after.size || !samePropertyValue(fromScene.windows, toScene.windows)) {
      authoringError('SFD1855', 'Transitions may only change properties on the same preview tree.');
    }
    this.properties = [];
    for (const [id, node] of before) {
      const target = after.get(id);
      if (!target || node.type !== target.type || node.templateRoot !== target.templateRoot ||
        !samePropertyValue(node.collections, target.collections)) {
        authoringError('SFD1855', 'Transitions may only change properties on the same preview tree.');
      }
      const names = new Set([...Object.keys(node.properties), ...Object.keys(target.properties)]);
      for (const property of names) {
        if (samePropertyValue(node.properties[property], target.properties[property])) continue;
        if (this.properties.length === 20000) authoringError('SFD1855', 'Transition property limit.');
        this.properties.push(transitionProperty(node, property, node.properties[property], target.properties[property]));
      }
    }
    this.commands = this.properties.map(item => item.command);
    this.closed = false;
  }

  commandsAt(elapsed) {
    if (this.closed) authoringError('SFD1855', 'The transition preview has closed.');
    elapsed = finiteNumber(elapsed, {label: 'Transition elapsed time (ms)', minimum: 0});
    const progress = this.duration === 0 ? 1 : Math.min(1, elapsed / this.duration);
    for (const item of this.properties) {
      if (progress === 0 || progress === 1) item.command.value = progress === 0 ? item.from : item.to;
      else if (item.numeric) item.command.value = item.from + (item.to - item.from) * progress;
      else if (item.color) {
        for (const channel of ['A', 'R', 'G', 'B']) {
          item.color.Color[channel] = Math.round(item.from.Color[channel] + (item.to.Color[channel] - item.from.Color[channel]) * progress);
        }
        item.color.Opacity = (item.from.Opacity ?? 1) + ((item.to.Opacity ?? 1) - (item.from.Opacity ?? 1)) * progress;
        item.command.value = item.color;
      } else item.command.value = item.from;
    }
    return this.commands;
  }

  dispose() {
    this.closed = true;
    this.initialScene = null;
    this.commands.length = 0;
    this.properties.length = 0;
  }
}
