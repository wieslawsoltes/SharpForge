import {registerPropertyContracts, registerResourceContracts, registerObjectModelContracts} from '@sharpforge/winui-properties';
import {registerLayoutContracts, registerControlFamilyContracts, registerAutomationContracts,
  registerInputStateContracts} from '@sharpforge/winui-controls';
import {registerDrawingContracts, registerCompositionContracts, ensureNumericsContracts,
  registerDrawingPropertyIdentifiers} from '@sharpforge/rendering';

/** Independent reserved areas compose after released contracts without changing their IDs. */
export const uiContributions = Object.freeze([
  Object.freeze({name: 'A15', register(registry) {
    registerPropertyContracts(registry);
    registerResourceContracts(registry);
    registerObjectModelContracts(registry);
    registerUIRuntimeContracts(registry);
    registerUIBaseConstructors(registry);
  }}),
  Object.freeze({name: 'A16', register(registry) {
    registerLayoutContracts(registry);
    registerControlFamilyContracts(registry);
    registerAutomationContracts(registry);
    registerInputStateContracts(registry);
  }}),
  Object.freeze({name: 'A17', register(registry) {
    ensureNumericsContracts(registry);
    registerDrawingContracts(registry);
    registerCompositionContracts(registry);
    registerDrawingPropertyIdentifiers(registry);
  }})
]);

function registerUIBaseConstructors({types, memberIndex, member, XAML, CONTROLS}) {
  for (const owner of [XAML + 'DependencyObject', XAML + 'UIElement', XAML + 'FrameworkElement', CONTROLS + 'Control']) {
    if (!types.has(owner) || memberIndex.has(owner + '::.ctor')) continue;
    member(owner, '.ctor', [], owner, {kind: 'constructor',
      accessibility: owner === XAML + 'DependencyObject' ? 'public' : 'protected'});
  }
}

function registerUIRuntimeContracts({define, member}) {
  const owner = 'SharpForge.UI.Runtime';
  define(owner, {kind: 'static'});
  for (const [name, parameters, result] of [
    ['TypeOf', ['string'], 'System.Type'],
    ['IsInstance', ['object', 'string'], 'bool'], ['Cast', ['object', 'string'], 'object'],
    ['InvokeVirtual', ['object', 'string', 'object[]'], 'object'],
    ['InitializeFrameworkBase', ['object', 'string', 'object[]'], 'void'],
    ['Box', ['object', 'string'], 'object'],
    ['RequireNullableValue', ['object'], 'void'],
    ['ConvertNumeric', ['double', 'string', 'string', 'bool'], 'object']
  ]) member(owner, name, parameters, result, {isStatic: true});
}
