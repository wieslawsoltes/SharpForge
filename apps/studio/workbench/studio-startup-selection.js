/** Keep the startup toolbar and Studio's selected compiler project on the same explicit selection. */
export function connectStudioStartupSelection({ services, state, onChanged = () => {}, save = () => {} }) {
  const selected = () => {
    const workspace = state();
    const target = services.startup.mode === 'single' ? services.startup.entries[0]?.projectId : null;
    if (target && workspace.projectSystem?.projects.has(target)) {
      const changed = workspace.startupProject !== target || services.builds.activeId !== target;
      workspace.startupProject = target;
      services.builds.setActive(target);
      if (changed) { workspace.ilDump = null; onChanged(target); }
    }
    save();
  };
  const disposeStartup = services.startup.subscribe(selected);
  const disposeProfiles = services.profiles.subscribe(save);
  return () => { disposeStartup(); disposeProfiles(); };
}
