import test from 'node:test';
import assert from 'node:assert/strict';
import {ValueSource} from '@sharpforge/winui-properties';
import {prepareValueAnimation, sampleValueAnimation} from '@sharpforge/rendering';
import {JavaScriptUIContext} from '../packages/winui/src/javascript/context.js';
import {createFacadeTypes, installFacadeMembers} from '../packages/winui/src/javascript/members.js';
import {createStyleSystem} from '../packages/winui/src/style-system.js';
import {javascriptTimelineDefinition} from '../packages/winui/src/animation/definition.js';

function fixture() {
  const context = new JavaScriptUIContext();
  context.host = {apply() {}, setPrivateValue() {}};
  context.styles = createStyleSystem({context, objects: context.objects, classes: context.classes,
    host: context.host, send: command => context.send(command), value: value => context.value(value)});
  context.propertyRegistry = context.styles.registry;
  createFacadeTypes(context);
  installFacadeMembers(context);
  const target = new context.namespaces.Microsoft.UI.Xaml.Controls.Button();
  const animation = new context.namespaces.Microsoft.UI.Xaml.Media.Animation.DoubleAnimation();
  target.Opacity = 0.7;
  animation.To = 1;
  animation.$target = target;
  animation.$targetProperty = 'Opacity';
  const definition = () => javascriptTimelineDefinition(animation, context.objects, context.styles);
  const from = context.propertyRegistry.lookup(animation.$node.type, 'From');
  return {context, target, animation, from, definition, dispose() {
    for (const states of context.models.values()) for (const model of states.values()) model?.dispose?.();
    context.styles.dispose();
    context.registry.clear();
    context.objects.clear();
  }};
}

test('JavaScript sparse timelines distinguish omitted From from an explicitly local zero through facade getters', () => {
  const value = fixture();
  const {context, target, animation, from, definition} = value;
  try {
    const store = context.styles.storeFor(animation);
    assert.equal(store.getValueSource(from), ValueSource.Default);
    const omitted = definition();
    assert.equal(Object.hasOwn(omitted, 'from'), false);
    assert.equal(sampleValueAnimation(prepareValueAnimation(omitted, target.Opacity), 0), 0.7);

    animation.From = 0;
    assert.equal(store.getValueSource(from), ValueSource.Local);
    assert.equal(animation.From, 0);
    assert.equal(definition().from, 0);
    const explicit = prepareValueAnimation(definition(), target.Opacity);
    assert.equal(sampleValueAnimation(explicit, 0), 0);
    assert.equal(sampleValueAnimation(explicit, 0.5), 0.5);

    context.styles.clear(animation, from);
    assert.equal(store.getValueSource(from), ValueSource.Default);
    assert.equal(Object.hasOwn(definition(), 'from'), false);
    assert.equal(target.Opacity, 0.7);
  } finally { value.dispose(); }
});

test('JavaScript timeline zero endpoints honor style precedence and clearing without inferring presence from truthiness', () => {
  const value = fixture();
  const {context, animation, from, definition} = value;
  try {
    const store = context.styles.storeFor(animation);
    store.setSource(from, ValueSource.StyleSetter, 0);
    assert.equal(store.getValueSource(from), ValueSource.StyleSetter);
    assert.equal(definition().from, 0);
    animation.From = 0.25;
    assert.equal(definition().from, 0.25);
    context.styles.clear(animation, from);
    assert.equal(definition().from, 0);
    store.clearSource(from, ValueSource.StyleSetter);
    assert.equal(Object.hasOwn(definition(), 'from'), false);
    animation.To = 0;
    assert.equal(definition().to, 0);
    assert.equal(Object.hasOwn(definition(), 'by'), false);
  } finally { value.dispose(); }
});
