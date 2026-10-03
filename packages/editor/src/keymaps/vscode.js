import { bindingsFromRows, commonBindings } from './common.js';

const definitions = [
  ['Mod+D', 'Edit.AddNextOccurrence'], ['Mod+Shift+L', 'Edit.SelectAllOccurrences'],
  ['Mod+Shift+K', 'Edit.LineDelete'], ['Mod+L', 'Edit.SelectCurrentLine'],
  ['Mod+Enter', 'Edit.LineOpenBelow'], ['Mod+Shift+Enter', 'Edit.LineOpenAbove'],
  ['Alt+Shift+ArrowUp', 'Edit.CopyLineUp'], ['Alt+Shift+ArrowDown', 'Edit.CopyLineDown'],
  ['Mod+Alt+ArrowUp', 'Edit.AddCaretAbove'], ['Mod+Alt+ArrowDown', 'Edit.AddCaretBelow'],
  ['Mod+Shift+\\', 'Edit.GoToMatchingBrace'], ['Mod+]', 'Edit.InsertTab'], ['Mod+[', 'Edit.TabLeft'],
  ['Mod+ArrowUp', 'View.ScrollLineUp'], ['Mod+ArrowDown', 'View.ScrollLineDown'],
  ['Mod+Shift+[', 'Edit.CollapseCurrentRegion'], ['Mod+Shift+]', 'Edit.UncollapseCurrentRegion'],
  ['Mod+K Mod+0', 'Edit.CollapseAllRegions'], ['Mod+K Mod+J', 'Edit.UncollapseAllRegions'],
  ['Mod+K Mod+C', 'Edit.CommentSelection'], ['Mod+K Mod+U', 'Edit.UncommentSelection'],
  ['Mod+K Mod+F', 'Edit.FormatSelection'], ['Alt+Shift+F', 'Edit.FormatDocument'],
  ['Alt+Z', 'Edit.WordWrap'], ['Alt+Shift+ArrowRight', 'Edit.ExpandSelection'], ['Alt+Shift+ArrowLeft', 'Edit.ShrinkSelection'],
  ['F2', 'Refactor.Rename'], ['Mod+K Mod+I', 'Edit.QuickInfo'], ['Mod+K Mod+S', 'View.KeyboardSettings'],
  ['Mod+P', 'Edit.NavigateTo'], ['Mod+G', 'Edit.GoTo'], ['Mod+Shift+P', 'View.CommandPalette'], ['F1', 'View.CommandPalette'],
  ['Mod+,', 'View.Settings'], ['Mod+=', 'View.ZoomIn'], ['Mod+-', 'View.ZoomOut'], ['Mod+0', 'View.ZoomReset'],
  ['Mod+\\', 'Window.NewVerticalTabGroup'], ['Alt+ArrowLeft', 'View.NavigateBackward'], ['Alt+ArrowRight', 'View.NavigateForward']
];

export const vscodeBindings = Object.freeze([...commonBindings, ...bindingsFromRows('vscode', definitions, { priority: 10 })]);
