/** Values follow Windows App SDK 1.8 WinUI metadata; they are not the native UIA numeric ids. */
export const AutomationControlType = Object.freeze({
  Button: 0, Calendar: 1, CheckBox: 2, ComboBox: 3, Edit: 4, Hyperlink: 5, Image: 6, ListItem: 7, List: 8,
  Menu: 9, MenuBar: 10, MenuItem: 11, ProgressBar: 12, RadioButton: 13, ScrollBar: 14, Slider: 15, Spinner: 16,
  StatusBar: 17, Tab: 18, TabItem: 19, Text: 20, ToolBar: 21, ToolTip: 22, Tree: 23, TreeItem: 24,
  Custom: 25, Group: 26, Thumb: 27, DataGrid: 28, DataItem: 29, Document: 30, SplitButton: 31, Window: 32,
  Pane: 33, Header: 34, HeaderItem: 35, Table: 36, TitleBar: 37, Separator: 38, SemanticZoom: 39, AppBar: 40, FlipView: 41
});

export const PatternInterface = Object.freeze({
  Invoke: 0, Selection: 1, Value: 2, RangeValue: 3, Scroll: 4, ScrollItem: 5, ExpandCollapse: 6, Grid: 7,
  GridItem: 8, MultipleView: 9, Window: 10, SelectionItem: 11, Dock: 12, Table: 13, TableItem: 14, Toggle: 15,
  Transform: 16, Text: 17, ItemContainer: 18, VirtualizedItem: 19, Text2: 20, TextChild: 21, TextRange: 22,
  Annotation: 23, Drag: 24, DropTarget: 25, ObjectModel: 26, Spreadsheet: 27, SpreadsheetItem: 28, Styles: 29,
  Transform2: 30, SynchronizedInput: 31, TextEdit: 32, CustomNavigation: 33
});

export const AutomationEvents = Object.freeze({
  ToolTipOpened: 0, ToolTipClosed: 1, MenuOpened: 2, MenuClosed: 3, AutomationFocusChanged: 4, InvokePatternOnInvoked: 5,
  SelectionItemPatternOnElementAddedToSelection: 6, SelectionItemPatternOnElementRemovedFromSelection: 7,
  SelectionItemPatternOnElementSelected: 8, SelectionPatternOnInvalidated: 9, TextPatternOnTextSelectionChanged: 10,
  TextPatternOnTextChanged: 11, AsyncContentLoaded: 12, PropertyChanged: 13, StructureChanged: 14, DragStart: 15,
  DragCancel: 16, DragComplete: 17, DragEnter: 18, DragLeave: 19, Dropped: 20, LiveRegionChanged: 21,
  InputReachedTarget: 22, InputReachedOtherElement: 23, InputDiscarded: 24, WindowClosed: 25, WindowOpened: 26,
  ConversionTargetChanged: 27, TextEditTextChanged: 28, LayoutInvalidated: 29, Notification: 30
});

export const AutomationLiveSetting = Object.freeze({ Off: 0, Polite: 1, Assertive: 2 });
export const AccessibilityView = Object.freeze({ Raw: 0, Control: 1, Content: 2 });
export const AutomationHeadingLevel = Object.freeze({ None: 0, Level1: 1, Level2: 2, Level3: 3, Level4: 4,
  Level5: 5, Level6: 6, Level7: 7, Level8: 8, Level9: 9 });
export const AutomationLandmarkType = Object.freeze({ None: 0, Custom: 1, Form: 2, Main: 3, Navigation: 4, Search: 5 });
export const ToggleState = Object.freeze({ Off: 0, On: 1, Indeterminate: 2 });
export const ExpandCollapseState = Object.freeze({ Collapsed: 0, Expanded: 1, PartiallyExpanded: 2, LeafNode: 3 });
export const ScrollAmount = Object.freeze({ LargeDecrement: 0, SmallDecrement: 1, NoAmount: 2, LargeIncrement: 3, SmallIncrement: 4 });
export const SupportedTextSelection = Object.freeze({ None: 0, Single: 1, Multiple: 2 });
export const TextUnit = Object.freeze({ Character: 0, Format: 1, Word: 2, Line: 3, Paragraph: 4, Page: 5, Document: 6 });
export const TextPatternRangeEndpoint = Object.freeze({ Start: 0, End: 1 });
export const AutomationNotificationKind = Object.freeze({ ItemAdded: 0, ItemRemoved: 1, ActionCompleted: 2,
  ActionAborted: 3, Other: 4 });
export const AutomationNotificationProcessing = Object.freeze({ ImportantAll: 0, ImportantMostRecent: 1,
  All: 2, MostRecent: 3, CurrentThenMostRecent: 4 });

export function enumValue(enumeration, value, name = 'enumeration') {
  const result = typeof value === 'string' ? enumeration[value] : value;
  if (!Object.values(enumeration).includes(result)) throw new RangeError('Invalid ' + name + ': ' + String(value));
  return result;
}

export function enumName(enumeration, value) {
  return Object.keys(enumeration).find(name => enumeration[name] === value) ?? null;
}
