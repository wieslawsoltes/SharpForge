import { bindingsFromRows, commonBindings } from './common.js';

export const sublimeBindings = Object.freeze([...commonBindings, ...bindingsFromRows('sublime', [
  ['Mod+D', 'Edit.AddNextOccurrence'], ['Mod+Shift+L', 'Edit.SplitSelectionIntoLines'], ['Mod+L', 'Edit.SelectCurrentLine'],
  ['Mod+Shift+D', 'Edit.Duplicate'], ['Mod+Shift+K', 'Edit.LineDelete'], ['Mod+J', 'Edit.JoinLines'],
  ['Mod+Enter', 'Edit.LineOpenBelow'], ['Mod+Shift+Enter', 'Edit.LineOpenAbove'],
  ['Mod+Shift+ArrowUp', 'Edit.MoveSelectedLinesUp'], ['Mod+Shift+ArrowDown', 'Edit.MoveSelectedLinesDown'],
  ['Alt+Shift+ArrowUp', 'Edit.AddCaretAbove'], ['Alt+Shift+ArrowDown', 'Edit.AddCaretBelow'],
  ['Mod+K Mod+U', 'Edit.MakeUppercase'], ['Mod+K Mod+L', 'Edit.MakeLowercase'],
  ['Mod+K Mod+J', 'Edit.UncollapseAllRegions'], ['Mod+K Mod+1', 'Edit.CollapseAllRegions'],
  ['Mod+Shift+[', 'Edit.CollapseCurrentRegion'], ['Mod+Shift+]', 'Edit.UncollapseCurrentRegion'],
  ['Mod+M', 'Edit.GoToMatchingBrace'], ['Mod+Shift+M', 'Edit.ExpandSelection'],
  ['Mod+P', 'Edit.NavigateTo'], ['Mod+Shift+P', 'View.CommandPalette'], ['Mod+G', 'Edit.GoTo'],
  ['F9', 'Edit.SortLines'], ['Mod+Shift+T', 'Window.ReopenClosedTab']
], { priority: 10 })]);
