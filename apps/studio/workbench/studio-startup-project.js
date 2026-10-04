/** The Explorer action and toolbar select the same per-project launch profile before the next build/start. */
export async function selectStudioStartupProject(path, {
  services, projects, state, renderWorkspace, renderPanel, save, build
}) {
  const project = state.projectSystem?.projects.get(path);
  if (!project) throw new Error('Unknown startup project');
  projects.sync();
  const profile = services.profiles.selected.get(path) ?? 'default';
  services.startup.select(path, { profile });
  state.startupProject = path;
  state.name = project.name;
  projects.sync();
  state.ilDump = null;
  renderWorkspace();
  renderPanel('project');
  save();
  return build();
}
