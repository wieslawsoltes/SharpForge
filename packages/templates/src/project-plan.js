import { portablePath } from '@sharpforge/archive';
import { xmlEscape, addSolutionProject, addSolutionFolder, relativeTo } from '@sharpforge/project-system';
import { getTemplate, templateAvailability } from './registry.js';
import { createItemPlan } from './item-plan.js';
import { validateFilePlan } from './file-plan.js';
import { normalizeTemplateOptions } from './options.js';
import { emitLegacyProject } from './project/legacy.js';
import { classicSolution } from './project/solution.js';
import { defaultNamespace, validateNamespace, validateProjectName, joinPath, directoryName, wrapNamespace, winuiUsings, TemplateError } from './common.js';

function applyOptions(project, id, namespace, options) {
  if (options.useProgramMain === false && ['console', 'console-async', 'test-console'].includes(id)) {
    if (options.outputType === 'Library') throw new TemplateError('SFTPL002', 'Top-level statements require an executable output type');
    const source = project.records.find(file => file.path.endsWith('/Program.cs') || file.path === 'Program.cs');
    const usings = options.implicitUsings ? '' : 'using System;\n' + (id === 'console-async' ? 'using System.Threading.Tasks;\n' : '') + '\n';
    source.text = usings + (id === 'console-async' ? 'await Task.Delay(1);\nConsole.WriteLine("Hello, async world!");\n' :
      id === 'test-console' ? 'if (20 + 22 != 42) throw new Exception("Expected 42");\nConsole.WriteLine("All self-tests passed.");\n' :
        'Console.WriteLine("Hello, world!");\n');
  }
  if (options.namespaceStyle === 'file-scoped') {
    const prefix = 'namespace ' + namespace + '\n{\n';
    for (const record of project.records) {
      if (!record.path.endsWith('.cs') || !record.text.includes(prefix)) continue;
      const index = record.text.indexOf(prefix);
      const body = record.text.slice(index + prefix.length).replace(/\n}\n$/, '').split('\n').map(line => line.replace(/^ {4}/, '')).join('\n');
      record.text = record.text.slice(0, index) + 'namespace ' + namespace + ';\n\n' + body + '\n';
    }
  }
  return project;
}

function linkProject(records, app, library, { ui, projectName, namespace }) {
  const project = records.find(record => record.path === app.projectPath);
  project.text = project.text.replace('</Project>', '  <ItemGroup>\n' +
    `    <ProjectReference Include="${xmlEscape(relativeTo(library.projectPath, directoryName(app.projectPath)))}" />\n` +
    '  </ItemGroup>\n</Project>');
  const program = records.find(record => record.path === joinPath(directoryName(app.projectPath), 'Program.cs'));
  if (ui) {
    program.text = wrapNamespace(namespace, `public class Program\n{\n    public static void Main()\n    {\n` +
      `        Window window = new Window();\n        window.Title = "${projectName}";\n` +
      '        CardControl card = new CardControl();\n        card.SetCaption("Control from the referenced library");\n' +
      '        window.Content = card.View;\n        window.Activate();\n    }\n}', winuiUsings + `using ${namespace}.Controls;\n`);
  } else program.text = wrapNamespace(namespace,
    'public class Program\n{\n    public static void Main()\n    {\n        Console.WriteLine(Calculator.Add(20, 22));\n    }\n}',
    `using System;\nusing ${namespace}.Core;\n`);
}

/** Returns a complete file plan. Native prerequisites are diagnostics, and applying the plan is explicit. */
export function createProjectPlan(templateId, input = {}) {
  const template = getTemplate(templateId, input.catalog);
  if (!['project', 'solution'].includes(template.kind)) throw new TemplateError('SFTPL004', 'Unknown project template');
  const options = normalizeTemplateOptions(input);
  const projectName = input.projectName ?? 'Application';
  const solutionName = input.solutionName ?? projectName;
  const namespace = input.namespace ?? defaultNamespace(projectName);
  const location = input.location ?? '';
  const solutionMode = input.solutionMode ?? 'new';
  const solutionPath = input.solutionPath ?? null;
  const solutionText = input.solutionText ?? null;
  validateProjectName(projectName);
  validateProjectName(solutionName);
  validateNamespace(namespace);
  if (location) portablePath(location);
  if (!['new', 'existing', 'none'].includes(solutionMode)) throw new TemplateError('SFTPL002', 'Unknown solution mode');
  if (solutionMode === 'existing' && (!solutionPath || typeof solutionText !== 'string')) throw new Error('An existing .slnx solution is required');
  if (solutionPath && !/\.slnx$/i.test(solutionPath)) throw new Error('Convert a legacy .sln to .slnx before adding projects');
  const records = [];
  const folders = [];
  const projects = [];
  const modifications = [];
  let openFile = null;
  let startup = null;
  let entry = null;
  const generatedWarnings = [];
  const postActions = [];
  const primaryOutputs = [];
  const emit = (id, name, ns, folder) => {
    input.signal?.throwIfAborted();
    const definition = getTemplate(id, input.catalog);
    const settings = { name, ns, folder, framework: options.framework, checked: options.checked, options };
    const project = definition.generate ? definition.generate(definition, settings) :
      applyOptions(emitLegacyProject(id, settings, createItemPlan), id, ns, options);
    records.push(...project.records);
    folders.push(...project.folders);
    projects.push(project.projectPath);
    openFile ??= project.openFile;
    if (!project.library) startup ??= project.projectPath;
    generatedWarnings.push(...(project.warnings ?? []));
    postActions.push(...(project.postActions ?? []));
    primaryOutputs.push(...(project.primaryOutputs ?? []));
    return project;
  };
  if (templateId === 'blank-solution') {
    if (solutionMode === 'existing') throw new Error('A blank solution cannot be added inside a solution');
  } else if (templateId === 'console-library-solution' || templateId === 'winui-library-solution') {
    const ui = templateId.startsWith('winui');
    const app = emit(ui ? 'winui-blank' : 'console', projectName, namespace, joinPath(location, projectName));
    const libraryName = projectName + (ui ? '.Controls' : '.Core');
    const library = emit(ui ? 'winui-controls-library' : 'class-library', libraryName,
      namespace + (ui ? '.Controls' : '.Core'), joinPath(location, libraryName));
    linkProject(records, app, library, { ui, projectName, namespace });
  } else emit(templateId, projectName, namespace, input.sameDirectory ? location : joinPath(location, projectName));
  if (solutionMode === 'existing') {
    let text = solutionText;
    for (const projectPath of projects) text = addSolutionProject(text, { solutionPath, projectPath, folder: input.solutionFolder });
    modifications.push({ path: solutionPath, text, expectedText: solutionText });
    entry = solutionPath;
  } else if (solutionMode === 'new' || templateId === 'blank-solution') {
    entry = joinPath(location, solutionName + '.' + options.solutionFormat);
    let text;
    if (options.solutionFormat === 'sln') text = classicSolution(entry, projects);
    else {
      text = '<Solution>\n</Solution>\n';
      if (!projects.length) text = addSolutionFolder(text, 'src');
      for (const projectPath of projects) text = addSolutionProject(text, { solutionPath: entry, projectPath, folder: projects.length > 1 ? 'src' : null });
    }
    records.push({ path: entry, text });
  } else entry = projects[0] ?? null;
  const native = !!template.nativeOnly;
  const warnings = native ? generatedWarnings : template.winui ? [
    'WinUI web profile: native Windows App SDK/MSBuild execution is not provided by this template.',
    'Pages and controls use composition through .View, not WinUI base-class inheritance.'
  ] : [];
  const plan = {
    template: templateId, records, folders, projects, entry, startup: startup ?? projects[0] ?? null,
    openFile: openFile ?? entry, name: solutionName, profile: native ? 'native' : template.winui ? 'winui-web' : 'managed', modifications, warnings
  };
  if (native) {
    const availability = templateAvailability(template, input.environment);
    plan.diagnostics = availability.available ? [] : [{ code: availability.code, severity: 'warning', message: availability.reason }];
    plan.prerequisites = template.prerequisites ?? [];
  }
  if (primaryOutputs.length) plan.primaryOutputs = primaryOutputs;
  if (postActions.length) plan.postActions = postActions;
  if (!options.noRestore && !postActions.some(action => action.kind === 'restore')) plan.postActions = [...postActions, {
    kind: 'restore', manual: true, command: 'dotnet restore', description: 'Restore explicitly on the native host.'
  }];
  input.signal?.throwIfAborted();
  return validateFilePlan(plan, input.existing ?? []);
}
