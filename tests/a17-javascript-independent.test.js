import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameScheduler} from '@sharpforge/rendering';
import {createAnimationSystem} from '../packages/winui/src/animation/system.js';

test('JavaScript independent samples retain DP animation values without public scene writes', () => {
  const commands = [], samples = [], projections = new Map();
  const base = {Opacity: 1, Width: 30}, values = {};
  const target = {$node: {id: 'element', type: 'Microsoft.UI.Xaml.Controls.Button'}, $values: base};
  const objects = new Map([['element', target]]);
  const scheduler = new FrameScheduler({requestFrame: () => 1, cancelFrame() {}, now: () => 0});
  let bindings = 0;
  const host = {document: {defaultView: {performance: {now: () => 0}}}, services: {scheduler}, flush() {},
    applyCompositionProperty(id, property, value) {
      if (value === undefined) projections.delete(property);
      else projections.set(property, value);
    }};
  const sourceAccess = {
    read: (object, property) => values[property] ?? base[property], base: (object, property) => base[property],
    write(object, property, value, options) {
      values[property] = value;
      samples.push({property, value, independent: options.independent});
      if (!options.independent) commands.push({property, value});
    },
    clear(object, property, options) {
      delete values[property];
      if (!options.independent) commands.push({property, value: base[property]});
    }
  };
  const animations = createAnimationSystem({objects, host, sourceAccess, options: {animationManual: true},
    styles: {bindings() { bindings++; }}, send: command => commands.push(command)});
  animations.clock.begin('story', {id: 'story', target: 'element', property: 'Opacity', from: 1, to: 0, duration: 100});
  for (let frame = 0; frame < 5; frame++) animations.advance(10);
  assert.equal(values.Opacity, 0.5);
  assert.equal(projections.get('Opacity'), 0.5);
  assert.equal(commands.length, 0);
  assert.equal(bindings, 0);
  assert.ok(samples.every(sample => sample.independent));
  base.Opacity = 0.3;
  animations.clock.stop('story');
  assert.equal(values.Opacity, undefined);
  assert.equal(projections.has('Opacity'), false);
  assert.deepEqual(commands, [{property: 'Opacity', value: 0.3}]);
  commands.length = 0;
  samples.length = 0;
  animations.clock.begin('layout', {id: 'layout', target: 'element', property: 'Width', from: 30, to: 60, duration: 100});
  animations.advance(20);
  assert.ok(commands.length > 0);
  assert.equal(commands.length, samples.length);
  assert.ok(samples.every(sample => !sample.independent));
  assert.ok(bindings > 0);
  animations.dispose();
  assert.equal(projections.size, 0);
  scheduler.dispose();
});
