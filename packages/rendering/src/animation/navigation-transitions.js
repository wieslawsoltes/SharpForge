import {ThemeTransition} from './theme-transitions.js';

/** Frame lifecycle callbacks apply the selected navigation policy after destination layout is available. */
export class NavigationTransitionCoordinator {
  constructor(themes, {getBounds, connectedAnimations} = {}) {
    this.themes = themes;
    this.getBounds = getBounds;
    this.connectedAnimations = connectedAnimations;
  }
  navigated({content, transition}) {
    if (!content || !transition || this.themes.reducedMotion()) return null;
    const kind = transition.kind?.split('.').at(-1);
    if (kind === 'SuppressNavigationTransitionInfo') { this.themes.cancel(content); return null; }
    const definition = new ThemeTransition('EntranceThemeTransition');
    if (kind === 'SlideNavigationTransitionInfo') {
      const bounds = this.getBounds?.(content);
      if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) throw new TypeError('Navigation slide requires layout bounds');
      definition.FromHorizontalOffset = transition.Effect === 1 ? -bounds.width : transition.Effect === 2 ? bounds.width : 0;
      definition.FromVerticalOffset = transition.Effect === 0 ? bounds.height : 0;
    } else if (kind === 'DrillInNavigationTransitionInfo') {
      definition.FromVerticalOffset = 0;
      return this.drillIn(content, definition);
    } else if (kind !== 'EntranceNavigationTransitionInfo') throw new TypeError('Unsupported navigation transition');
    return this.themes.start(content, [definition]);
  }
  drillIn(content, transition) {
    const visual = this.themes.getVisual(content);
    const compositor = this.themes.compositor;
    const outer = compositor.CreateScopedBatch();
    this.themes.start(content, [transition]);
    const animation = compositor.CreateVector3KeyFrameAnimation();
    animation.Duration = 250 * this.themes.durationScale;
    animation.InsertKeyFrame(0, [visual.Scale[0] * 0.9, visual.Scale[1] * 0.9, visual.Scale[2]]);
    animation.InsertKeyFrame(1, visual.Scale);
    visual.StartAnimation('Scale', animation);
    outer.add_Completed(() => {
      visual.StopAnimation('Scale');
      animation.dispose();
      outer.dispose();
    });
    outer.End();
    return outer;
  }
  cancelled() { this.connectedAnimations?.cancelNavigation(); }
  failed() { this.connectedAnimations?.cancelNavigation(); }
  dispose() { this.cancelled(); }
}
