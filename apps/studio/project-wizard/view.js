const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export { escape as escapeWizardHtml };

const option = (value, current, label = value) => `<option value="${escape(value)}" ${value === current ? 'selected' : ''}>${escape(label)}</option>`;
const input = (id, label, value, extra = '') => `<label>${label}<input id="${id}" value="${escape(value)}" ${extra}></label>`;
const checkbox = (id, label, value) => `<label class="wizard-check"><input id="${id}" type="checkbox" ${value ? 'checked' : ''}> ${label}</label>`;

function chooseTemplate(model) {
  const categories = [...new Set(model.templates.map(template => template.category))];
  const languages = [...new Set(model.templates.map(template => template.language))];
  return `<div class="wizard-filter"><input id="wizard-search" type="search" placeholder="Search templates (Alt+S)" ` +
    `aria-label="Search templates" value="${escape(model.query)}" autofocus>` +
    '<select id="wizard-language" aria-label="Template language"><option value="">All languages</option>' +
    languages.map(language => option(language, model.language)).join('') + '</select>' +
    '<select id="wizard-category" aria-label="Project type"><option value="">All project types</option>' +
    categories.map(category => option(category, model.category)).join('') + '</select></div>' +
    '<div class="wizard-template-layout"><div class="wizard-template-list" id="wizard-template-list" role="listbox" ' +
    'aria-label="Templates and target prerequisites" tabindex="0"></div><aside id="wizard-description" class="wizard-description"></aside></div>' +
    '<p class="wizard-boundary">Each template declares its targets. Native .NET and Windows App SDK templates require the listed tools; ' +
    'browser templates use the implemented managed or WinUI web profile.</p>';
}

function projectFields(model) {
  const values = model.values;
  const libraries = ['class-library', 'empty-project', 'winui-controls-library'];
  const frameworks = ['net10.0', 'net9.0', 'net8.0', ...(libraries.includes(model.selected) ? ['netstandard2.0'] : [])];
  return input('wizard-project-name', 'Project name', values.projectName, 'autofocus') +
    input('wizard-solution-name', 'Solution name', values.solutionName, values.solutionMode === 'existing' ? 'disabled' : '') +
    input('wizard-namespace', 'Namespace', values.namespace) +
    input('wizard-location', 'Location inside destination', values.location, 'placeholder="Destination root"') +
    '<div class="wizard-row"><label>Solution<select id="wizard-solution-mode">' +
    option('new', values.solutionMode, 'Create new solution') +
    (model.add && model.context.solutionPath ? option('existing', values.solutionMode, 'Add to current solution') : '') +
    option('none', values.solutionMode, 'Project only') + '</select></label><label>Target framework<select id="wizard-framework">' +
    frameworks.map(value => option(value, values.framework)).join('') + '</select></label></div>' +
    '<label>Solution format<select id="wizard-solution-format">' + option('slnx', values.solutionFormat, 'SLNX') +
    option('sln', values.solutionFormat, 'Classic SLN') + '</select></label>' +
    checkbox('wizard-same-directory', 'Place project and solution in the same directory', values.sameDirectory) +
    checkbox('wizard-checked', 'Check arithmetic overflow', values.checked) +
    '<details><summary>Code options</summary><label>Nullable<select id="wizard-nullable">' +
    ['disable', 'enable', 'warnings', 'annotations'].map(value => option(value, values.nullable)).join('') + '</select></label>' +
    checkbox('wizard-implicit-usings', 'Implicit using directives', values.implicitUsings) +
    checkbox('wizard-program-main', 'Use explicit Program.Main', values.useProgramMain) + '</details>';
}

function destination(model) {
  if (model.add) return '<p class="wizard-destination">Destination: ' +
    (model.context.native ? 'connected native workspace (disk files)' : 'current browser workspace') + '</p>';
  const selected = model.values.destination;
  return '<fieldset class="wizard-destination"><legend>Destination</legend><label>Create files in<select id="wizard-destination">' +
    option('browser', selected, 'New browser workspace') + option('directory', selected, 'Select a disk folder') +
    (model.context.native ? option('native', selected, 'Connected native workspace') : '') + '</select></label>' +
    `<button type="button" id="wizard-browse" ${selected !== 'directory' ? 'hidden' : ''}>Choose folder…</button>` +
    `<p id="wizard-destination-path" aria-live="polite">${escape(model.directoryHandle?.name ?? (selected === 'directory' ? 'No folder selected' :
      selected === 'native' ? model.context.name ?? 'Connected native root' : 'Browser workspace'))}</p>` +
    '<p id="wizard-destination-status" role="status"></p></fieldset>';
}

function configuration(model) {
  const itemFields = input('wizard-item-name', 'Item name', model.values.name, 'autofocus') +
    input('wizard-namespace', 'Namespace', model.values.namespace, ['C#', 'XAML'].includes(model.template.language) ? '' : 'disabled') +
    input('wizard-location', 'Location inside workspace', model.values.location, 'placeholder="Workspace root"') +
    '<p class="wizard-destination">' + (model.projectPath ? 'Project: ' + escape(model.projectPath) : 'Loose workspace item') + '</p>';
  return '<div class="wizard-config"><div class="wizard-fields"><h3>' + escape(model.template.name) + '</h3>' +
    (model.kind === 'project' ? projectFields(model) + destination(model) : itemFields) +
    '<div class="wizard-errors" id="wizard-errors" role="alert"></div><div class="wizard-warnings" id="wizard-warnings"></div></div>' +
    '<div class="wizard-preview"><div class="wizard-preview-head">Files to create <span id="wizard-file-count"></span></div>' +
    '<div class="wizard-preview-body"><div id="wizard-files" class="wizard-files" role="list" aria-label="Files to create"></div>' +
    '<pre id="wizard-code" tabindex="0" aria-label="Generated source preview"></pre></div></div></div>';
}

export function wizardView(model) {
  const title = model.kind === 'item' ? 'Add New Item' : model.add ? 'Add a new project' : 'Create a new project';
  const body = `<div class="project-wizard" data-wizard-kind="${model.kind}" data-wizard-step="${model.step}">` +
    `<div class="wizard-steps"><span class="${model.step === 0 ? 'current' : ''}">1&nbsp; Choose a template</span><span>›</span>` +
    `<span class="${model.step === 1 ? 'current' : ''}">2&nbsp; Configure, destination &amp; preview</span></div>` +
    (model.step === 0 ? chooseTemplate(model) : configuration(model)) + '</div>';
  const footer = '<button id="wizard-cancel">Cancel</button><span class="wizard-spacer"></span>' +
    (model.step ? '<button id="wizard-back">Back</button>' : '') +
    `<button id="wizard-next" class="primary">${model.step ? model.kind === 'item' ? 'Add' : 'Create' : 'Next'}</button>`;
  return { title, body, footer };
}
