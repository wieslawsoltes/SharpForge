import {bindingsFromRows, commonBindings} from './common.js';

// ReSharper 2026.2 IntelliJ scheme, mapped to the editor's existing command contracts.
// Browser-reserved gestures retain explicit chord alternatives in the same table.
const definitions = [
  ['Alt+Enter', 'View.ShowSmartTag'], ['Mod+Alt+L', 'Edit.FormatDocument'],
  ['Mod+Space', 'Edit.CompleteWord'], ['Mod+P', 'Edit.ParameterInfo'], ['Mod+Q', 'Edit.QuickInfo'],
  ['Mod+J', 'Edit.InsertSnippet'], ['Mod+Alt+J', 'Edit.SurroundWith'],
  ['Mod+W', 'Edit.ExpandSelection'], ['Mod+Shift+W', 'Edit.ShrinkSelection'],
  ['Mod+D', 'Edit.Duplicate'], ['Mod+Shift+J', 'Edit.JoinLines'],
  ['Mod+/', 'Edit.ToggleLineComment'], ['Mod+Shift+/', 'Edit.ToggleBlockComment'],
  ['Mod+Alt+Shift+ArrowUp', 'Edit.MoveSelectedLinesUp'], ['Mod+Alt+Shift+ArrowDown', 'Edit.MoveSelectedLinesDown'],
  ['Mod+N', 'Edit.NavigateTo'], ['Mod+Shift+N', 'Edit.NavigateTo', Object.freeze({query: 'f '})],
  ['Mod+Alt+Shift+N', 'Edit.NavigateTo', Object.freeze({query: '# '})],
  ['Mod+F12', 'Edit.NavigateTo', Object.freeze({query: 'm '})],
  ['Mod+E', 'Edit.NavigateTo', Object.freeze({query: 'recent '})],
  ['Mod+B', 'Edit.GoToDefinition'], ['Alt+F7', 'Edit.FindAllReferences'],
  ['F12', 'Edit.GotoNextIssueinFile'], ['Shift+F12', 'Edit.GotoPreviousIssueinFile'],
  ['Mod+Shift+A', 'View.CommandPalette'], ['Mod+Shift+R', 'View.ShowSmartTag'],
  ['F2', 'Refactor.Rename'], ['Mod+Alt+M', 'Refactor.ExtractMethod'],
  ['Mod+K Mod+N', 'Edit.NavigateTo'], ['Mod+K Mod+F', 'Edit.NavigateTo', Object.freeze({query: 'f '})],
  ['Mod+K Mod+S', 'Edit.NavigateTo', Object.freeze({query: '# '})],
  ['Mod+K Mod+M', 'Edit.NavigateTo', Object.freeze({query: 'm '})],
  ['Mod+K Mod+E', 'Edit.NavigateTo', Object.freeze({query: 'recent '})],
  ['Mod+K Mod+P', 'Edit.ParameterInfo'], ['Mod+K Mod+I', 'Edit.QuickInfo'],
  ['Mod+K Mod+W', 'Edit.ExpandSelection'], ['Mod+K Mod+Shift+W', 'Edit.ShrinkSelection'],
  ['Mod+K Mod+,', 'View.Settings'], ['Mod+K Mod+B', 'Edit.GoToDefinition']
];

export const resharperBindings = Object.freeze([...commonBindings, ...bindingsFromRows('resharper', definitions, {priority: 10})]);
