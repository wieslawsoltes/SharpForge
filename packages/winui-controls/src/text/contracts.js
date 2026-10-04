import { registerTypographyContracts } from './typography.js';

export function registerTextContracts(b) {
  const { X, C } = b, D = X + 'Documents.', T = 'Microsoft.UI.Text.';
  for (const [name, values] of [['CharacterCasing', { Normal: 0, Lower: 1, Upper: 2 }],
    ['PasswordRevealMode', { Peek: 0, Hidden: 1, Visible: 2 }],
    ['AutoSuggestionBoxTextChangeReason', { UserInput: 0, ProgrammaticChange: 1, SuggestionChosen: 2 }]]) b.enumeration(C + name, values);
  b.enumeration(X + 'TextTrimming', { None: 0, CharacterEllipsis: 1, WordEllipsis: 2, Clip: 3 });
  b.enumeration(T + 'TextGetOptions', { None: 0, AdjustCrlf: 1, UseCrlf: 2, UseObjectText: 4, AllowFinalEop: 8, FormatRtf: 8192 });
  b.enumeration(T + 'TextSetOptions', { None: 0, UnicodeBidi: 1, Unhide: 2, CheckTextLimit: 4, FormatRtf: 8192 });
  b.enumeration(T + 'FormatEffect', { Off: 0, On: 1, Toggle: 2, Undefined: 3 });
  b.enumeration(T + 'UnderlineType', { None: 0, Single: 1, Words: 2, Double: 3, Dotted: 4, Dash: 5 });
  for (const name of ['TextBox', 'AutoSuggestBox']) {
    const type = C + name;
    b.props(type, { SelectionStart: ['int', 0], SelectionLength: ['int', 0], SelectedText: ['string', ''],
      CanUndo: ['bool', false, true], CanRedo: ['bool', false, true], CharacterCasing: [C + 'CharacterCasing', 0],
      IsSpellCheckEnabled: ['bool', true], IsTextPredictionEnabled: ['bool', true], Description: ['object', null],
      TextAlignment: [X + 'TextAlignment', 0], InputScope: 'object', SelectionHighlightColor: 'object' });
    for (const name of ['SelectAll', 'Undo', 'Redo', 'ClearUndoRedoHistory']) b.method(type, name);
    b.method(type, 'Select', ['int', 'int']);
    for (const name of ['CopySelectionToClipboardAsync', 'CutSelectionToClipboardAsync', 'PasteFromClipboardAsync']) {
      b.method(type, name, [], b.task('bool'));
    }
    b.event(type, 'BeforeTextChanging', { NewText: 'string', Cancel: ['bool', false] });
    b.event(type, 'TextChanged', { Text: 'string', OldText: 'string', Reason: [C + 'AutoSuggestionBoxTextChangeReason', 0] });
    b.event(type, 'TextChanging', { IsContentChanging: 'bool' });
    b.event(type, 'Paste', { Handled: 'bool', Cancel: 'bool' });
    b.event(type, 'SelectionChanged', { SelectionStart: 'int', SelectionLength: 'int' });
    for (const name of ['TextCompositionStarted', 'TextCompositionChanged', 'TextCompositionEnded']) {
      b.event(type, name, { Text: 'string', Cancelled: ['bool', false] });
    }
  }
  b.props(C + 'PasswordBox', { MaxLength: ['int', 0], PasswordChar: ['char', '●'],
    PasswordRevealMode: [C + 'PasswordRevealMode', 0], Description: 'object' });
  b.method(C + 'PasswordBox', 'SelectAll');
  b.event(C + 'PasswordBox', 'PasswordChanging', { Cancel: ['bool', false], Length: 'int' });
  b.props(C + 'AutoSuggestBox', { ItemsSource: 'object', TextMemberPath: ['string', ''], UpdateTextOnSelect: ['bool', true],
    IsSuggestionListOpen: ['bool', false], QueryIcon: 'object' });
  b.event(C + 'AutoSuggestBox', 'SuggestionChosen', { SelectedItem: 'object' });
  b.event(C + 'AutoSuggestBox', 'QuerySubmitted', { QueryText: 'string', ChosenSuggestion: 'object' });
  b.type(T + 'RichEditTextDocument', 'object', 'object', []);
  b.type(T + 'ITextRange', 'object', 'interface', []);
  b.type(T + 'ITextSelection', T + 'ITextRange', 'interface', []);
  b.type(T + 'ITextCharacterFormat', 'object', 'interface', []);
  b.props(T + 'ITextCharacterFormat', { Bold: [T + 'FormatEffect', 0], Italic: [T + 'FormatEffect', 0], Underline: [T + 'UnderlineType', 0],
    Size: ['float', 14], ForegroundColor: 'Windows.UI.Color', Name: ['string', 'Segoe UI'] });
  b.props(T + 'ITextRange', { StartPosition: ['int', 0], EndPosition: ['int', 0], Text: ['string', ''],
    CharacterFormat: T + 'ITextCharacterFormat' });
  b.method(T + 'ITextRange', 'SetRange', ['int', 'int']);
  b.method(T + 'ITextRange', 'SetText', ['string']);
  b.method(T + 'ITextRange', 'SetText', [T + 'TextSetOptions', 'string']);
  b.method(T + 'ITextRange', 'GetText', [T + 'TextGetOptions', 'string&']);
  b.property(T + 'RichEditTextDocument', 'Selection', T + 'ITextSelection', null, true);
  b.method(T + 'RichEditTextDocument', 'SetText', [T + 'TextSetOptions', 'string']);
  b.method(T + 'RichEditTextDocument', 'GetText', [T + 'TextGetOptions'], 'string');
  b.method(T + 'RichEditTextDocument', 'GetText', [], 'string');
  b.method(T + 'RichEditTextDocument', 'GetText', [T + 'TextGetOptions', 'string&']);
  b.control('RichEditBox', C + 'Control', { Document: [T + 'RichEditTextDocument', null, true], IsReadOnly: ['bool', false],
    Header: 'object', Description: 'object', Text: ['string', ''], RtfText: ['string', ''], PlaceholderText: ['string', ''], AcceptsReturn: ['bool', true],
    IsSpellCheckEnabled: ['bool', true] }, ['TextChanged', 'SelectionChanged']);
  b.property(C + 'RichEditBox', 'TextDocument', T + 'RichEditTextDocument', null, true);
  // Existing flyout controls retain their released Control ancestry; the profile's reference property stays compatible.
  for (const name of ['TextBox', 'RichEditBox']) b.property(C + name, 'SelectionFlyout', 'object');
  b.collection(D + 'InlineCollection', D + 'Inline'); b.collection(D + 'BlockCollection', D + 'Block');
  b.type(D + 'TextElement', X + 'DependencyObject', 'abstract', []);
  b.props(D + 'TextElement', { FontSize: ['double', 14], FontFamily: ['string', 'Segoe UI'], FontWeight: 'Windows.UI.Text.FontWeight',
    FontStyle: ['Windows.UI.Text.FontStyle', 0], Foreground: X + 'Media.Brush', Language: ['string', 'en-US'] });
  b.type(D + 'Inline', D + 'TextElement', 'abstract', []);
  b.type(D + 'Block', D + 'TextElement', 'abstract', []);
  b.type(D + 'Run', D + 'Inline'); b.property(D + 'Run', 'Text', 'string', '');
  b.type(D + 'LineBreak', D + 'Inline');
  b.type(D + 'Span', D + 'Inline'); b.property(D + 'Span', 'Inlines', D + 'InlineCollection', null, true);
  for (const name of ['Bold', 'Italic', 'Underline', 'Hyperlink']) b.type(D + name, D + 'Span');
  b.property(D + 'Hyperlink', 'NavigateUri', 'string', ''); b.event(D + 'Hyperlink', 'Click');
  b.type(D + 'InlineUIContainer', D + 'Inline'); b.property(D + 'InlineUIContainer', 'Child', X + 'UIElement');
  b.type(D + 'Paragraph', D + 'Block'); b.property(D + 'Paragraph', 'Inlines', D + 'InlineCollection', null, true);
  b.property(C + 'TextBlock', 'Inlines', D + 'InlineCollection', null, true);
  for (const name of ['RichTextBlock', 'RichTextBlockOverflow']) b.control(name, X + 'FrameworkElement', {
    Blocks: [D + 'BlockCollection', null, true], OverflowContentTarget: C + 'RichTextBlockOverflow',
    HasOverflowContent: ['bool', false, true], IsTextSelectionEnabled: ['bool', true], Text: ['string', ''] });
  for (const name of ['TextBlock', 'RichTextBlock', 'RichTextBlockOverflow']) b.props(C + name, {
    FontFamily: ['string', 'Segoe UI'], FontSize: ['double', 14], FontWeight: 'Windows.UI.Text.FontWeight', FontStyle: ['Windows.UI.Text.FontStyle', 0],
    TextTrimming: [X + 'TextTrimming', 0], MaxLines: ['int', 0], LineHeight: ['double', 0],
    CharacterSpacing: ['int', 0], IsTextTrimmed: ['bool', false, true], SelectedText: ['string', '', true] });
  for (const name of ['TextBlock', 'RichTextBlock', 'RichTextBlockOverflow']) {
    b.event(C + name, 'IsTextTrimmedChanged', { IsTextTrimmed: 'bool' });
    b.event(C + name, 'SelectionChanged', { SelectedText: 'string' });
  }
  b.type(D + 'Typography', 'object', 'static', []);
  for (const property of ['StandardLigatures', 'ContextualLigatures', 'DiscretionaryLigatures', 'HistoricalLigatures',
    'Kerning', 'CaseSensitiveForms', 'CapitalSpacing', 'SlashedZero', 'StylisticSet1', 'StylisticSet2']) {
    b.method(D + 'Typography', 'Set' + property, [X + 'DependencyObject', 'bool'], 'void',
      { kind: 'attachedSet', isStatic: true, property: 'Typography.' + property });
    b.method(D + 'Typography', 'Get' + property, [X + 'DependencyObject'], 'bool',
      { kind: 'attachedGet', isStatic: true, property: 'Typography.' + property });
  }
  b.props(D + 'Paragraph', { Margin: X + 'Thickness', TextIndent: ['double', 0], TextAlignment: [X + 'TextAlignment', 0] });
  registerTypographyContracts(b);
  for (const owner of [D + 'TextElement', C + 'Control', C + 'TextBlock', C + 'RichTextBlock', C + 'RichTextBlockOverflow']) {
    const type = b.registry.types.get(owner);
    for (const name of ['FontFamily', 'FontFamilyObject', 'FontWeight', 'FontStyle', 'Language', 'FontSize', 'Foreground']) {
      const property = type.properties?.[name];
      if (property && !property.isStatic) property.metadata = { ...property.metadata, inherits: true, inheritanceKey: name };
    }
  }
}
