import test from 'node:test';
import assert from 'node:assert/strict';
import {EnvironmentState, validateEnvironmentSnapshot} from '@sharpforge/winui-controls';
import {initializeResourceContext, themeResource} from '@sharpforge/winui-properties';
import {createCompositionServices, ThemeTransition} from '@sharpforge/rendering';
import {AnimationClock} from '@sharpforge/framework';
import {registerRuntimeUIHandlers} from '../apps/studio/workers/ui-bridge.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';

function resources(environment) {
  const states = new Map();
  const context = {services: {environment}, getApplication: () => null,
    state(_owner, key, factory) {
      if (!states.has(key) && factory) states.set(key, factory());
      return states.get(key);
    }};
  initializeResourceContext(context, {children: () => []});
  return context.resourceScopeFor(null);
}

test('system palettes reach dynamic high-contrast resources and remain application-local', () => {
  const first = new EnvironmentState({DarkTheme: false}), second = new EnvironmentState({DarkTheme: true});
  const scope = resources(first), other = resources(second), values = [];
  assert.equal(scope.actualTheme, 'Light');
  assert.equal(other.actualTheme, 'Dark');
  const remove = scope.observe(themeResource('SystemColorWindowTextColor'), {changed: value => values.push(value)});
  first.update({HighContrast: true, SystemColors: {CanvasText: 'rgb(245, 246, 247)', Canvas: 'rgb(10, 11, 12)'}});
  assert.equal(scope.actualTheme, 'HighContrast');
  assert.equal(values.at(-1), 'rgb(245, 246, 247)');
  assert.equal(scope.find('TextFillColorPrimaryBrush').color, 'rgb(245, 246, 247)');
  assert.equal(other.actualTheme, 'Dark');
  first.update({SystemColors: {CanvasText: 'rgb(1, 2, 3)', Canvas: 'rgb(10, 11, 12)'}});
  assert.equal(values.at(-1), 'rgb(1, 2, 3)');
  const count = values.length;
  remove(); scope.dispose(); other.dispose();
  first.update({DarkTheme: true, HighContrast: false});
  assert.equal(values.length, count);
  assert.equal(first.listeners.size, 0);
  assert.throws(() => validateEnvironmentSnapshot({...first.snapshot(), SystemColors: {Canvas: 'url(https://example.invalid)'}}), /system color/);
});

test('environment palette snapshots are bounded, immutable and restore without notifications', () => {
  const palette = {Canvas: '#102030'}, environment = new EnvironmentState({SystemColors: palette});
  palette.Canvas = '#ffffff';
  assert.equal(environment.SystemColors.Canvas, '#102030');
  const snapshot = environment.snapshot();
  snapshot.SystemColors.Canvas = '#405060';
  let notifications = 0;
  environment.subscribe(() => notifications++);
  environment.restore(snapshot);
  assert.equal(environment.SystemColors.Canvas, '#405060');
  assert.equal(notifications, 0);
  assert.equal(environment.update({SystemColors: {}}), true);
  assert.equal(notifications, 1);
  assert.throws(() => environment.update({SystemColors: {Unknown: '#000000'}}), /system color/);
});

test('host motion changes cancel active transitions and allow new transitions after re-enabling', async () => {
  const environment = new EnvironmentState(), owner = {id: 'element'};
  const services = createCompositionServices({environment, clockFactory: adapter => new AnimationClock(adapter),
    preview: {isElement: value => value === owner, getLayout: () => ({width: 30, height: 20})}});
  const transition = new ThemeTransition('EntranceThemeTransition');
  assert(services.themeTransitions.start(owner, [transition]));
  assert.equal(services.themeTransitions.active.size, 1);
  environment.update({AnimationsEnabled: false});
  assert.equal(services.themeTransitions.active.size, 0);
  assert.equal(services.themeTransitions.start(owner, [transition]), null);
  assert.equal(services.implicitTransitions.reducedMotion(), true);
  assert.equal(services.connectedAnimations.reducedMotion(), true);
  environment.update({AnimationsEnabled: true});
  assert(services.themeTransitions.start(owner, [transition]));
  await services.dispose();
  assert.equal(environment.listeners.size, 0);
});

test('worker environment feedback updates one session, schedules work and respects debug pause', () => {
  const handlers = createWorkerProtocol('runtime'), environment = new EnvironmentState();
  let flushes = 0, schedules = 0;
  const vm = {state: 'running', platform: {ui: {services: {environment}}}};
  registerRuntimeUIHandlers(handlers, {current: () => ({vm}), interactive() {},
    flush: () => flushes++, schedule: () => schedules++});
  const snapshot = {...environment.snapshot(), TextScaleFactor: 1.75, RasterizationScale: 2};
  assert.equal(handlers.dispatch('uiEnvironmentSnapshot', {snapshot}), true);
  assert.equal(environment.TextScaleFactor, 1.75);
  assert.equal(flushes, 1); assert.equal(schedules, 1);
  vm.state = 'paused';
  assert.equal(handlers.dispatch('uiEnvironmentSnapshot', {snapshot: {...snapshot, TextScaleFactor: 2}}), false);
  assert.equal(environment.TextScaleFactor, 1.75);
  vm.state = 'running';
  assert.throws(() => handlers.dispatch('uiEnvironmentSnapshot', {snapshot: {...snapshot, RasterizationScale: 0}}), /environment/);
});
