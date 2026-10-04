function fileItems() {
  return [
    ['New Project / Solution…', 'newProject', 'Ctrl+Shift+N'],
    ['Open ZIP…', 'openZip', ''],
    ['Save Workspace as ZIP…', 'exportProject', ''],
    ['Save to Empty Folder…', 'saveFolder', ''],
    null,
    ['Open folder…', 'openFolder', ''],
    ['Open DLL / EXE in decompiler…', 'openAssemblyFile', ''],
    ['Save changed sources to disk', 'saveDisk', 'Ctrl+Alt+S'],
    ['Export .csproj', 'exportCsproj', ''],
    ['Export .slnx', 'exportSlnx', ''],
    null,
    ['New C# file', 'new', ''],
    ['Open project or source files…', 'open', ''],
    ['Save All', 'save', 'Ctrl+S'],
    ['Export workspace…', 'exportProject', ''],
    ['Export .NET IL assembly (.dll)', 'assemblyExport', ''],
    ['Export .NET runtime configuration', 'runtimeConfigExport', ''],
    ['Export IL inspection listing', 'ilExport', ''],
    ['Export legacy VM IR', 'bytecodeExport', ''],
    null,
    ['Load example…', 'examples', ''],
    ['Recover previous project', 'recoverPrevious', '']
  ];
}

function editItems() {
  return [
    ['Code actions', 'codeActions', 'Ctrl+.'],
    ['Format indentation', 'format', 'Shift+Alt+F'],
    null,
    ['Undo', 'undo', 'Ctrl+Z'],
    ['Redo', 'redo', 'Ctrl+Shift+Z'],
    null,
    ['Find in file', 'find', 'Ctrl+F'],
    ['Replace in file', 'replace', 'Ctrl+H'],
    ['Go to line', 'goToLine', 'Ctrl+G'],
    ['Go to definition', 'definition', 'F12'],
    ['Find all references', 'references', 'Shift+F12'],
    ['Rename symbol', 'rename', 'F2']
  ];
}

function windowItems(toolDefinitions) {
  return [
    ['Window layouts', 'windowLayouts', ''],
    ['Native build layout', 'nativeBuildLayout', ''],
    ['Reset coding layout', 'resetLayout', ''],
    ['Debugging layout', 'debugLayout', ''],
    ['WinUI development layout', 'winuiLayout', ''],
    ['Decompilation layout', 'decompileLayout', ''],
    ['Undo layout change', 'undoLayout', ''],
    ['Redo layout change', 'redoLayout', ''],
    null,
    ...toolDefinitions.map(tool => [tool.title, 'tool:' + tool.id, ''])
  ];
}

function viewItems() {
  return [
    ['Navigate back', 'navigateBack', 'Alt+Left'],
    ['Navigate forward', 'navigateForward', 'Alt+Right'],
    null,
    ['Call hierarchy', 'callHierarchy', 'Shift+Alt+H'],
    ['Find in files', 'findFiles', 'Ctrl+Shift+F'],
    ['Document outline', 'outline', ''],
    ['Project properties', 'projectProperties', ''],
    ['Assembly Explorer', 'assemblyExplorer', ''],
    ['Generated sources', 'generatedSources', ''],
    null,
    ['Solution Explorer', 'toggleExplorer', ''],
    ['Diagnostic Tools', 'toggleTools', ''],
    null,
    ['Output', 'output', ''],
    ['Error List', 'problems', ''],
    ['Locals & Watch', 'debugPanel', ''],
    ['Call Stack', 'stack', ''],
    ['Breakpoints', 'breakpoints', ''],
    ['Disassembly', 'disassembly', ''],
    null,
    ['Toggle theme', 'theme', '']
  ];
}

function projectItems() {
  return [
    ['Set Startup Projects…', 'solutionSetStartupProjects', '']
  ];
}

function buildItems() {
  return [
    ['Build active engine', 'build', 'Ctrl+Shift+B'],
    ['Native MSBuild workspace', 'nativeMSBuild', ''],
    ['Evaluate native project', 'nativeEvaluate', ''],
    ['Cancel native operation', 'nativeCancel', ''],
    null,
    ['Export .NET IL assembly (.dll)', 'assemblyExport', ''],
    ['Export .NET runtime configuration', 'runtimeConfigExport', ''],
    ['Export IL inspection listing', 'ilExport', ''],
    ['Export legacy VM IR', 'bytecodeExport', '']
  ];
}

function debugItems() {
  return [
    ['Start / Continue', 'debug', 'F5'],
    ['Start without debugging', 'run', 'Ctrl+F5'],
    ['Start New Instance', 'start-new-instance', ''],
    ['Break all', 'pause', 'F6'],
    ['Stop debugging', 'stop', 'Shift+F5'],
    ['Stop All Applications', 'stop-all', ''],
    ['Restart debugging', 'restart', ''],
    ['Run to cursor', 'runToCursor', 'Ctrl+F10'],
    null,
    ['Step over', 'next', 'F10'],
    ['Step into', 'stepIn', 'F11'],
    ['Step out', 'stepOut', 'Shift+F11'],
    ['Step back', 'stepBack', 'Alt+F10'],
    ['Reverse continue (recorded history)', 'reverseContinue', ''],
    ['Set Next Statement', 'setNext', 'Ctrl+Shift+F10'],
    ['Hot Reload', 'hotReload'],
    ['Threads', 'threads'],
    ['Parallel Stacks', 'parallelStacks'],
    ['Portable PDB Symbols', 'symbols'],
    ['WinUI Application', 'winui'],
    ['Show Next Statement', 'showNext'],
    ['New Function Breakpoint…', 'newFunctionBreakpoint'],
    ['Enable / Disable All Breakpoints', 'muteBreakpoints'],
    ['Debugger Settings / Exceptions', 'debugSettings'],
    ['Immediate', 'immediate']
  ];
}

function toolsItems() {
  return [
    ['Language, SIMD & networking', 'tool:runtime-settings', ''],
    ['WinUI visual designer', 'designer', ''],
    null,
    ['Native MSBuild', 'nativeMSBuild', ''],
    ['Project / Solution Source', 'tool:project-source', ''],
    ['MSBuild Evaluation', 'tool:msbuild-inspector', ''],
    null,
    ['Generators & analyzers', 'extensions', ''],
    ['Generated sources', 'generatedSources', ''],
    ['Assembly Explorer', 'assemblyExplorer', ''],
    null,
    ['Inspect managed heap', 'heap', ''],
    ['Collect managed garbage', 'collect', ''],
    ['Command palette', 'commands', 'Ctrl+Q'],
    null,
    ['Compiler architecture', 'architecture', ''],
    ['Language compatibility', 'profile', ''],
    null,
    ['Environment / Keyboard', 'settings']
  ];
}

function helpItems() {
  return [
    ['Examples', 'examples', ''],
    ['Keyboard shortcuts', 'shortcuts', ''],
    ['Compiler architecture', 'architecture', ''],
    ['Compatibility profile', 'profile', ''],
    null,
    ['About SharpForge Studio', 'about', '']
  ];
}

/** Register the legacy menu surface with the same startup commands as the workbench menus. */
export function registerStudioMenus(registry, { toolDefinitions }) {
  const menus = {
    file: fileItems(),
    edit: editItems(),
    window: windowItems(toolDefinitions),
    view: viewItems(),
    project: projectItems(),
    build: buildItems(),
    debug: debugItems(),
    tools: toolsItems(),
    help: helpItems()
  };
  for (const [id, items] of Object.entries(menus)) registry.registerMenu(id, items);
}
