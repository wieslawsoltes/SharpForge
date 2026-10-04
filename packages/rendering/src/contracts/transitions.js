const X = 'Microsoft.UI.Xaml.';
const A = X + 'Media.Animation.';

export function registerTransitionContracts({define, ctor, prop, member, event, types, en}) {
  const defineIfMissing = (name, options) => { if (!types.has(name)) define(name, options); };
  const propertyIfMissing = (owner, name, type) => { if (!types.get(owner).properties[name]) prop(owner, name, type); };
  defineIfMissing(A + 'Transition', {kind: 'abstract', base: X + 'DependencyObject'});
  defineIfMissing(A + 'TransitionCollection', {kind: 'collection', element: A + 'Transition'});
  prop(A + 'TransitionCollection', 'Count', 'int', 0, true);
  member(A + 'TransitionCollection', 'Add', [A + 'Transition'], 'void');
  member(A + 'TransitionCollection', 'get_Item', ['int'], A + 'Transition');
  member(A + 'TransitionCollection', 'Remove', [A + 'Transition'], 'bool');
  member(A + 'TransitionCollection', 'Clear', [], 'void');
  for (const kind of ['Entrance', 'Content', 'Reposition', 'AddDelete', 'Popup']) {
    const type = A + kind + 'ThemeTransition';
    defineIfMissing(type, {kind: 'animation', base: A + 'Transition'});
    ctor(type);
    prop(type, 'FromHorizontalOffset', 'double', 0);
    prop(type, 'FromVerticalOffset', 'double', 0);
    prop(type, 'IsStaggeringEnabled', 'bool', true);
  }
  for (const kind of ['FadeIn', 'FadeOut']) {
    const type = A + kind + 'ThemeAnimation';
    defineIfMissing(type, {kind: 'animation', base: A + 'Timeline'});
    ctor(type);
  }
  propertyIfMissing(X + 'UIElement', 'Transitions', A + 'TransitionCollection');
  propertyIfMissing(X + 'Controls.Panel', 'ChildrenTransitions', A + 'TransitionCollection');
  for (const kind of ['Scalar', 'Vector3', 'Brush']) {
    const type = X + kind + 'Transition';
    defineIfMissing(type, {kind: 'animation', base: X + 'DependencyObject'});
    ctor(type);
    prop(type, 'Duration', 'System.TimeSpan');
  }
  propertyIfMissing(X + 'UIElement', 'OpacityTransition', X + 'ScalarTransition');
  propertyIfMissing(X + 'UIElement', 'TranslationTransition', X + 'Vector3Transition');
  propertyIfMissing(X + 'Controls.Border', 'BackgroundTransition', X + 'BrushTransition');
  propertyIfMissing(X + 'Controls.Panel', 'BackgroundTransition', X + 'BrushTransition');
  defineIfMissing(A + 'NavigationTransitionInfo', {kind: 'abstract', base: X + 'DependencyObject'});
  for (const kind of ['Entrance', 'DrillIn', 'Slide', 'Suppress']) {
    defineIfMissing(A + kind + 'NavigationTransitionInfo', {kind: 'animation', base: A + 'NavigationTransitionInfo'});
    ctor(A + kind + 'NavigationTransitionInfo');
  }
  en(A + 'SlideNavigationTransitionEffect', {FromBottom: 0, FromLeft: 1, FromRight: 2});
  prop(A + 'SlideNavigationTransitionInfo', 'Effect', A + 'SlideNavigationTransitionEffect', 0);
  define(A + 'ConnectedAnimationService', {kind: 'composition'});
  member(A + 'ConnectedAnimationService', 'GetForCurrentView', [], A + 'ConnectedAnimationService', {isStatic: true});
  member(A + 'ConnectedAnimationService', 'PrepareToAnimate', ['string', X + 'UIElement'], A + 'ConnectedAnimation');
  member(A + 'ConnectedAnimationService', 'GetAnimation', ['string'], A + 'ConnectedAnimation');
  define(A + 'ConnectedAnimation', {kind: 'composition'});
  member(A + 'ConnectedAnimation', 'TryStart', [X + 'UIElement'], 'bool');
  member(A + 'ConnectedAnimation', 'Cancel', [], 'void');
  event(A + 'ConnectedAnimation', 'Completed');
  for (const type of types.values()) {
    if (!type.name.startsWith(A) && !['ScalarTransition', 'Vector3Transition', 'BrushTransition'].some(name => type.name === X + name)) continue;
    for (const [name, property] of Object.entries({...type.properties})) {
      if (!property.isStatic && !property.readOnly && !type.properties[name + 'Property']) {
        prop(type.name, name + 'Property', X + 'DependencyProperty', null, true, true);
      }
    }
  }
}
