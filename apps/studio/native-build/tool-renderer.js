import {escapeHtml as escape} from '@sharpforge/editor';

/** Native tools register through the existing application renderer seam. */
export function renderNativeTool(panel, element, {nativeBuild, state}) {
  if (['msbuild', 'msbuild-inspector', 'project-source', 'tests'].includes(panel)) {
    nativeBuild.render(panel, element);
    return true;
  }
  if (panel !== 'project' || !state.nativeMode) return false;
  element.innerHTML = `<div class="tool-page"><h2>Native Project Properties</h2><p>${escape(state.nativeWorkspace?.root ?? '')}</p>
    <p>The MSBuild tool selects the project, configuration, framework and runtime. Load a project context for SDK-resolved sources and metadata.</p>
    <div class="tool-actions"><button class="button" data-command="nativeMSBuild">MSBuild settings</button>
      <button class="button" data-command="nativeEvaluate">Evaluate project</button>
      <button class="button" data-command="tool:project-source">Edit project / solution XML</button>
      <button class="button" data-command="tool:tests">Test Explorer</button></div>
    <p>Native builds compile projects separately. Browser language services and managed execution use their supported profiles.</p></div>`;
  return true;
}
