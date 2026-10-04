/** Application-specific motion settings remain effective even when the host allows animation. */
export function environmentMotionOptions(environment, options) {
  if (!environment) return options;
  return {...options, reducedMotion: () => !environment.AnimationsEnabled || options.reducedMotion?.() === true};
}

/** Disabling host animations clears in-flight convenience transitions without closing their reusable services. */
export function subscribeCompositionEnvironment(environment, composition) {
  return environment?.subscribe(change => {
    if (!change.changed.includes('AnimationsEnabled') || environment.AnimationsEnabled) return;
    composition.themeTransitions.dispose();
    composition.implicitTransitions.dispose();
    composition.connectedAnimations.cancelNavigation();
  });
}
