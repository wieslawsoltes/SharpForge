import {resourceContractHelpers} from './resource-contract-helpers.js';
import {registerVisualStateEventContracts} from './model-event-contracts.js';

export function registerStateContracts(registry) {
  const {XAML: x, CONTROLS: controls, MEDIA: media} = registry;
  const {type, method, property, constructor, collection} = resourceContractHelpers(registry);
  for (const name of ['VisualStateManager', 'VisualStateGroup', 'VisualState', 'VisualTransition',
    'StateTriggerBase', 'StateTrigger', 'AdaptiveTrigger']) {
    const base = name === 'StateTrigger' || name === 'AdaptiveTrigger' ? x + 'StateTriggerBase' : x + 'DependencyObject';
    type(x + name, {kind: 'object', base});
    if (name === 'StateTriggerBase') method(x + name, '.ctor', [], x + name, {kind: 'constructor', access: 'protected'});
    else constructor(x + name);
  }
  method(x + 'VisualStateManager', 'GoToState', [controls + 'Control', 'string', 'bool'], 'bool', {isStatic: true});
  collection(x + 'VisualStateGroupCollection', x + 'VisualStateGroup');
  collection(x + 'VisualStateCollection', x + 'VisualState');
  collection(x + 'VisualTransitionCollection', x + 'VisualTransition');
  collection(x + 'StateTriggerCollection', x + 'StateTriggerBase');
  method(x + 'VisualStateManager', 'GetVisualStateGroups', [x + 'FrameworkElement'], x + 'VisualStateGroupCollection', {isStatic: true});
  property(x + 'VisualStateGroup', 'Name', 'string', '');
  property(x + 'VisualStateGroup', 'States', x + 'VisualStateCollection', null, true);
  property(x + 'VisualStateGroup', 'Transitions', x + 'VisualTransitionCollection', null, true);
  property(x + 'VisualStateGroup', 'CurrentState', x + 'VisualState', null, true);
  registerVisualStateEventContracts(registry);
  property(x + 'VisualState', 'Name', 'string', '');
  property(x + 'VisualState', 'Setters', x + 'SetterBaseCollection', null, true);
  property(x + 'VisualState', 'Storyboard', media + 'Animation.Storyboard');
  property(x + 'VisualState', 'StateTriggers', x + 'StateTriggerCollection', null, true);
  property(x + 'VisualTransition', 'From', 'string');
  property(x + 'VisualTransition', 'To', 'string');
  property(x + 'VisualTransition', 'GeneratedDuration', x + 'Duration');
  property(x + 'VisualTransition', 'GeneratedEasingFunction', media + 'Animation.EasingFunctionBase');
  property(x + 'VisualTransition', 'Storyboard', media + 'Animation.Storyboard');
  property(x + 'StateTrigger', 'IsActive', 'bool', false);
  property(x + 'AdaptiveTrigger', 'MinWindowWidth', 'double', 0);
  property(x + 'AdaptiveTrigger', 'MinWindowHeight', 'double', 0);
  method(x + 'StateTriggerBase', 'SetActive', ['bool'], 'void', {access: 'protected'});
}
