/** Reference command aliases share handlers; known host commands remain discoverable even without a provider. */
export function registerExtendedCommands(add, commands, context, feature, viewCommand) {
  const aliases = {
    'Edit.DeleteBackwards': 'Edit.Backspace', 'Edit.GotoBrace': 'Edit.GoToMatchingBrace',
    'Edit.GotoBraceExtend': 'Edit.GoToMatchingBraceExtend', 'Edit.CollapseAllOutlining': 'Edit.CollapseAllRegions',
    'Edit.ExpandAllOutlining': 'Edit.UncollapseAllRegions', 'Edit.ExpandCurrentRegion': 'Edit.UncollapseCurrentRegion',
    'Edit.ContractSelection': 'Edit.ShrinkSelection', 'Edit.GotoAll': 'Edit.NavigateTo',
    'Edit.InsertCaretsatAllMatching': 'Edit.SelectAllOccurrences', 'Edit.InsertNextMatchingCaret': 'Edit.AddNextOccurrence',
    'Edit.LineTranspose': 'Edit.TransposeLine', 'Edit.WordTranspose': 'Edit.TransposeWord',
    'Edit.ScrollLineDown': 'View.ScrollLineDown', 'Edit.ScrollLineUp': 'View.ScrollLineUp',
    'Edit.ToggleWordWrap': 'Edit.WordWrap'
  };
  for (const [id, target] of Object.entries(aliases)) add(id, args => {
    const command = commands.get(target);
    return command.enabled() ? command.handler(args) : false;
  });
  add('Edit.NextHighlightedReference', () => feature(context, 'nextReference', [1]));
  add('Edit.PreviousHighlightedReference', () => feature(context, 'nextReference', [-1]));
  add('Edit.GotoNextIssueinFile', () => feature(context, 'nextDiagnostic', [1]));
  add('Edit.GotoPreviousIssueinFile', () => feature(context, 'nextDiagnostic', [-1]));
  add('Edit.ToggleBlockComment', () => viewCommand(context, 'Edit.ToggleBlockComment'), {edit: true});
  add('Edit.SwapAnchor', () => context.select(context.selections.map(({ anchor, head }) => ({ anchor: head, head: anchor }))));
  for (const [id, method] of Object.entries({
    'Edit.CopyParameterTip': 'copyParameterTip', 'Edit.PasteParameterTip': 'pasteParameterTip',
    'Edit.PeekBackward': 'peekBackward', 'Edit.PeekForward': 'peekForward',
    'Edit.ShowCodeLensMenu': 'showCodeLensMenu', 'Edit.ShowNavigateMenu': 'focusNavigation'
  })) add(id, () => feature(context, method));
  add('Edit.DecreaseFilterLevel', () => feature(context, 'changeCompletionFilterLevel', [-1]));
  add('Edit.IncreaseFilterLevel', () => feature(context, 'changeCompletionFilterLevel', [1]));
  for (const id of [
    'Edit.LineStartExtendColumn', 'Edit.LineEndExtendColumn', 'Edit.WordPreviousExtendColumn', 'Edit.WordNextExtendColumn',
    'Edit.ViewTop', 'Edit.ViewTopExtend', 'Edit.ViewBottom', 'Edit.ViewBottomExtend', 'Edit.HideSelection',
    'Edit.CollapseTag', 'Edit.ExpandSelectiontoContainingBlock'
  ]) add(id, args => viewCommand(context, id, args));
  for (const [id, host] of Object.entries({
    'Edit.GotoRecent': 'recentDocuments', 'Edit.SelectToLastGoBack': 'selectToLastGoBack',
    'Edit.ToggleTaskListShortcut': 'toggleTaskShortcut', 'Build.Cancel': 'cancelBuild',
    'Build.Compile': 'buildFile', 'Build.RunCodeAnalysisonSolution': 'analyzeSolution',
    'Tools.CodeSnippetsManager': 'snippets', 'Edit.OpenFile': 'openDocumentPrompt',
    'EditorContextMenus.CodeWindow.ExecuteInInteractive': 'executeSelection',
    'EditorContextMenus.CodeWindow.ExecuteLineInInteractive': 'executeLine'
  })) add(id, args => context.host(host, args));
}
