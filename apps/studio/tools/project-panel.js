import {escapeHtml as escape} from '@sharpforge/editor';

const openingMarkup = `<div class="tool-page"><h2>Project Properties</h2>
  <p>Open a .csproj, .sln or .slnx together with its source files, or open the containing folder.</p>
  <div class="tool-actions"><button class="button" data-command="openFolder">Open folder</button>
    <button class="button" data-command="open">Open files</button></div>
  <p>File selections grant access only to the selected files. Loading evaluates project metadata;
    build targets run only when you build. Package restore uses the native MSBuild host.</p></div>`;

function option(value, label, selected, disabled = false) {
  return `<option value="${escape(value)}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escape(label)}</option>`;
}

function diskAccess(state) {
  const attached = !!(state.disk?.rootHandle || state.disk?.handles?.size);
  if (state.recoveryReadOnly) return {canSave: false, message: 'Recovered read-only. Grant folder access before building or saving.'};
  if (state.readOnly) return {canSave: false, message: 'This workspace is read-only. Stop execution before saving sources.'};
  if (!attached) return {canSave: false, message: 'No disk handles are attached. Open the source files or folder to enable Save to Disk.'};
  return {canSave: true, message: 'Disk handles are attached. Save to Disk rechecks write permission and external changes.'};
}

function projectFields(state, snapshot, project) {
  const entries = [...state.projectSystem.files.keys()].filter(path => /\.(sln|slnx|csproj)$/i.test(path));
  const configurations = [...new Set(['Debug', 'Release', state.configuration].filter(Boolean))];
  return `<label class="tool-field">Solution / project <select id="project-entry">
    ${entries.map(path => option(path, path, path === snapshot.solution.path)).join('')}</select></label>
    <label class="tool-field">Startup project <select id="startup-project">
    ${snapshot.projects.map(value => option(value.path, value.name + ' · ' + (value.unloaded ? 'unloaded' : value.outputType),
      value.path === state.startupProject, value.unloaded)).join('')}</select></label>
    <label class="tool-field">Configuration <select id="project-configuration">
    ${configurations.map(value => option(value, value, value === state.configuration)).join('')}</select></label>
    <p>Selected framework: <code>${escape(project?.targetFramework || 'not specified')}</code>.</p>`;
}

function projectSource(system, project) {
  if (!project) return '<pre class="tool-source"></pre>';
  const record = system.files.get(project.path);
  if (project.unloaded && typeof record?.text !== 'string') {
    return `<p>${escape(project.reason ?? 'This project requires its native toolchain.')}</p>
      <p>Project source text is not loaded. Open the project file to inspect its source.</p>`;
  }
  return `<pre class="tool-source">${escape(system.text(project.path))}</pre>`;
}

function projectDetails(state, snapshot, project) {
  const diagnostics = snapshot.diagnostics ?? [];
  const diagnosticMarkup = diagnostics.map(value => `<div class="project-diagnostic ${escape(value.severity)}">
    <b>${escape(value.code)} · ${escape(value.path ?? value.file ?? '')}</b><p>${escape(value.message)}</p></div>`).join('');
  const properties = Object.entries(project?.properties ?? {}).map(([name, value]) =>
    `<tr><td>${escape(name)}</td><td>${escape(value)}</td></tr>`).join('');
  return `<h3>Build order</h3><ol>${(snapshot.solution.buildOrder ?? []).map(path => `<li>${escape(path)}</li>`).join('')}</ol>
    <h3>Loading diagnostics (${diagnostics.length})</h3>${diagnosticMarkup || '<p>No loading diagnostics.</p>'}
    <h3>Evaluated properties</h3><table class="data-table">${properties}</table>
    <h3>Project source (read-only)</h3>${projectSource(state.projectSystem, project)}`;
}

function bindProjectChoices(element, context, snapshot) {
  const {state, reloadDiskProject, setStartupProject, toast} = context;
  const system = state.projectSystem;
  const onChange = (selector, selectedValue, change) => {
    const control = element.querySelector(selector);
    control.onchange = async event => {
      try {
        if (state.projectSystem !== system || state.projectSnapshot !== snapshot || state.nativeMode) {
          throw new Error('Workspace changed. Reopen Project Properties before choosing a project or configuration.');
        }
        await change(event.target.value);
      } catch (error) {
        control.value = selectedValue;
        toast(error.message, 'error');
      }
    };
  };
  onChange('#startup-project', state.startupProject, value => setStartupProject(value));
  onChange('#project-entry', snapshot.solution.path, value => reloadDiskProject(value));
  onChange('#project-configuration', state.configuration, value => reloadDiskProject(snapshot.solution.path, {configuration: value}));
}

/** Render the portable project view without evaluating targets, compiling, or requesting disk permissions. */
export function renderProjectPanel(element, context) {
  const {state} = context;
  const snapshot = state.projectSnapshot;
  if (!snapshot) {
    element.innerHTML = openingMarkup;
    return true;
  }
  const project = state.projectSystem.projects.get(state.startupProject);
  const access = diskAccess(state);
  const canBuild = !state.recoveryReadOnly && project && !project.unloaded;
  element.innerHTML = `<div class="tool-page"><h2>${escape(snapshot.solution.name)}</h2>
    <div class="notice">Projects compile into separate assemblies in dependency order.
      ProjectReference assembly metadata feeds dependent compilations, and supported project references are linked for managed execution.
      Target frameworks select build inputs; execution uses SharpForge's supported managed profile.</div>
    <p>Portable builds run supported targets and tasks. Use native MSBuild for SDK workloads, package restore,
      or tasks outside the portable profile. Selecting a framework does not install a .NET runtime.</p>
    ${projectFields(state, snapshot, project)}
    <div class="tool-actions"><button class="button" data-command="build"${canBuild ? '' : ' disabled'}>Build projects</button>
      <button class="button" data-command="saveDisk"${access.canSave ? '' : ' disabled'}>Save sources to disk</button>
      <button class="button" data-command="nativeMSBuild">Open native MSBuild</button></div>
    <p>${escape(access.message)}</p>${projectDetails(state, snapshot, project)}</div>`;
  bindProjectChoices(element, context, snapshot);
  return true;
}
