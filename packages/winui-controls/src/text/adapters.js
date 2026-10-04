import { TextBuffer } from './text-buffer.js';
import { RichTextDocument } from './rich-document.js';
import { DataPackage } from '../app/data-transfer.js';
import { ControlError } from '../policy/events.js';
import { registerTypographyAdapters } from './typography.js';
import { CONTROLS as C, TEXT as T, read, registerMethod, registerGet, registerSet, requireService, retain,
  unsupported } from '../policy/adapter-helpers.js';

export function managedTextModel(context, receiver) {
  const model = context.state(receiver, 'family.text', () => {
    const value = new TextBuffer({ text: read(context, receiver, 'Text', '') });
    for (const name of ['BeforeTextChanging', 'TextChanging', 'TextChanged', 'SelectionChanged',
      'TextCompositionStarted', 'TextCompositionChanged', 'TextCompositionEnded']) value.on(name, args => {
      if (name === 'TextChanged') {
        args.Reason = args.reason === 'programmatic' ? 1 : args.reason === 'suggestion' ? 2 : 0;
        context.write(receiver, 'Text', value.text); context.write(receiver, 'CanUndo', value.canUndo);
        context.write(receiver, 'CanRedo', value.canRedo);
      }
      if (name === 'SelectionChanged' || name === 'TextChanged') {
        context.write(receiver, 'SelectionStart', value.selectionStart); context.write(receiver, 'SelectionLength', value.selectionLength);
      }
      context.emit(receiver, name, args);
    });
    return value;
  });
  model.maximumLength = read(context, receiver, 'MaxLength', 0);
  model.readOnly = read(context, receiver, 'IsReadOnly', false);
  model.characterCasing = read(context, receiver, 'CharacterCasing', 0);
  const text = read(context, receiver, 'Text', '');
  if (text !== model.text && !model.composition) model.silence(() => model.replace(text, { force: true, record: false }));
  return model;
}

async function clipboardEdit(context, receiver, operation) {
  const model = managedTextModel(context, receiver), service = requireService(context, 'clipboard');
  if (operation === 'Paste') {
    if (model.readOnly) return false;
    const args = { Handled: false, Cancel: false };
    context.emit(receiver, 'Paste', args);
    if (args.Handled || args.Cancel) return false;
    const result = await service.getContent();
    return result.ok && result.data.contains('Text') ? model.insert(result.data.get('Text'), { reason: 'paste' }) : false;
  }
  if (!model.selectionLength || operation === 'Cut' && model.readOnly) return false;
  const data = new DataPackage(); data.setText(model.selectedText);
  const previous = { text: model.text, start: model.selectionStart, length: model.selectionLength };
  const result = await service.setContent(data);
  if (result.ok && operation === 'Cut' && model.text === previous.text && model.selectionStart === previous.start
    && model.selectionLength === previous.length) model.insert('', { reason: 'cut' });
  return result.ok;
}

export function registerTextAdapters(registry) {
  registerTypographyAdapters(registry);
  for (const owner of [C + 'TextBox', C + 'AutoSuggestBox']) {
    registerSet(registry, owner, 'Text', (c, r, value) => managedTextModel(c, r).replace(c.native(value), { force: true }));
    registerGet(registry, owner, 'Text', (c, r) => managedTextModel(c, r).text);
    registerGet(registry, owner, 'SelectedText', (c, r) => managedTextModel(c, r).selectedText);
    registerSet(registry, owner, 'SelectedText', (c, r, value) => managedTextModel(c, r).insert(c.native(value), { force: true }));
    for (const property of ['SelectionStart', 'SelectionLength']) {
      registerGet(registry, owner, property, (c, r) => managedTextModel(c, r)[property === 'SelectionStart' ? 'selectionStart' : 'selectionLength']);
      registerSet(registry, owner, property, (c, r, value) => {
        const model = managedTextModel(c, r), number = Number(c.native(value));
        model.select(property === 'SelectionStart' ? number : model.selectionStart,
          property === 'SelectionLength' ? number : Math.min(model.selectionLength, model.text.length - number));
      });
    }
    registerMethod(registry, owner, 'Select', (c, r, args) => managedTextModel(c, r).select(Number(c.native(args[0])), Number(c.native(args[1]))));
    for (const [name, method] of [['SelectAll', 'selectAll'], ['Undo', 'undo'], ['Redo', 'redo'], ['ClearUndoRedoHistory', 'clearUndoRedoHistory']]) {
      registerMethod(registry, owner, name, (c, r) => {
        const model = managedTextModel(c, r); model[method]();
        c.write(r, 'CanUndo', model.canUndo); c.write(r, 'CanRedo', model.canRedo);
      });
    }
    registerGet(registry, owner, 'CanUndo', (c, r) => managedTextModel(c, r).canUndo);
    registerGet(registry, owner, 'CanRedo', (c, r) => managedTextModel(c, r).canRedo);
    for (const [name, operation] of [['CopySelectionToClipboardAsync', 'Copy'], ['CutSelectionToClipboardAsync', 'Cut'],
      ['PasteFromClipboardAsync', 'Paste']]) registerMethod(registry, owner, name,
      (c, r) => c.task(clipboardEdit(c, r, operation), { resultType: 'bool' }));
  }
  registerRichDocumentAdapters(registry);
}

function richDocument(context, receiver) {
  return context.state(receiver, 'family.document', () => new RichTextDocument(read(context, receiver, 'Text', '')));
}

export function managedRichTextDocument(context, receiver) {
  if (!context.typeOf(receiver).endsWith('RichEditBox')) return richDocument(context, receiver);
  const document = documentPart(context, receiver, 'Document', T + 'RichEditTextDocument');
  const model = richDocument(context, document);
  if (!model.editorSubscribed) {
    model.editorSubscribed = true;
    for (const name of ['TextChanged', 'SelectionChanged', 'FormatChanged']) model.on(name, args => {
      context.write(receiver, 'Text', model.text);
      context.write(receiver, 'RtfText', model.getText('rtf'));
      context.emit(receiver, name === 'FormatChanged' ? 'TextChanged' : name, args);
    });
  }
  return model;
}

function documentPart(context, receiver, property, type) {
  let value = context.read(receiver, property);
  if (!context.native(value)) {
    value = context.allocate(type, {}); context.write(receiver, property, value);
    context.state(value, 'family.document', () => retain(richDocument(context, receiver), receiver));
  }
  return value;
}

function registerRichDocumentAdapters(registry) {
  registerGet(registry, C + 'RichEditBox', 'Document', (c, r) => {
    managedRichTextDocument(c, r);
    return c.read(r, 'Document');
  });
  registerGet(registry, C + 'RichEditBox', 'TextDocument', (c, r) => {
    managedRichTextDocument(c, r);
    return c.read(r, 'Document');
  });
  registerMethod(registry, T + 'RichEditTextDocument', 'SetText', (c, r, args) =>
    richDocument(c, r).setText(String(c.native(args[1])), textFormat(Number(c.native(args[0])), false)));
  registerMethod(registry, T + 'RichEditTextDocument', 'GetText', (c, r, args) => {
    const options = Number(c.native(args[0] ?? 0));
    let text = richDocument(c, r).getText(textFormat(options, true));
    if (options & 2) text = text.replace(/\r?\n/g, '\r\n');
    if (options & 8 && text && !text.endsWith('\n')) text += options & 2 ? '\r\n' : '\n';
    const value = c.managed(text, 'string');
    if (args.length > 1) { c.writeReference(args[1], value); return; }
    return value;
  });
  registerGet(registry, T + 'RichEditTextDocument', 'Selection', (c, r) => documentPart(c, r, 'Selection', T + 'ITextSelection'));
  registerGet(registry, T + 'ITextRange', 'StartPosition', (c, r) => richDocument(c, r).selection.start);
  registerSet(registry, T + 'ITextRange', 'StartPosition', (c, r, value) => {
    const model = richDocument(c, r);
    const end = model.selection.start + model.selection.length;
    const start = Number(c.native(value));
    model.select(Math.min(start, end), Math.abs(end - start));
  });
  registerGet(registry, T + 'ITextRange', 'EndPosition', (c, r) => {
    const model = richDocument(c, r); return model.selection.start + model.selection.length;
  });
  registerSet(registry, T + 'ITextRange', 'EndPosition', (c, r, value) => {
    const model = richDocument(c, r);
    const end = Number(c.native(value));
    const start = model.selection.start;
    model.select(Math.min(start, end), Math.abs(end - start));
  });
  registerMethod(registry, T + 'ITextRange', 'SetRange', (c, r, args) => {
    const start = Number(c.native(args[0])), end = Number(c.native(args[1]));
    richDocument(c, r).select(Math.min(start, end), Math.abs(end - start));
  });
  registerGet(registry, T + 'ITextRange', 'Text', (c, r) => {
    const model = richDocument(c, r); return model.text.slice(model.selection.start, model.selection.start + model.selection.length);
  });
  registerMethod(registry, T + 'ITextRange', 'GetText', (context, receiver, args) => {
    const model = richDocument(context, receiver);
    if (textFormat(Number(context.native(args[0])), true) !== 'text') unsupported('RTF extraction of a text range');
    const text = model.text.slice(model.selection.start, model.selection.start + model.selection.length);
    context.writeReference(args[1], context.managed(text, 'string'));
  });
  const replace = (c, r, value) => richDocument(c, r).replaceSelection(String(c.native(value)));
  registerSet(registry, T + 'ITextRange', 'Text', replace);
  registerMethod(registry, T + 'ITextRange', 'SetText', (c, r, args) => {
    if (args.length === 1) return replace(c, r, args[0]);
    if (textFormat(Number(c.native(args[0])), false) !== 'text') unsupported('RTF replacement of a rich-text selection');
    return replace(c, r, args[1]);
  });
  registerGet(registry, T + 'ITextRange', 'CharacterFormat', (c, r) => documentPart(c, r, 'CharacterFormat', T + 'ITextCharacterFormat'));
  registerSet(registry, T + 'ITextCharacterFormat', 'Name', () => unsupported('Rich-text font-family changes'));
  for (const [property, key] of [['Bold', 'bold'], ['Italic', 'italic'], ['Underline', 'underline'], ['Size', 'size'],
    ['ForegroundColor', 'foreground']]) registerSet(registry, T + 'ITextCharacterFormat', property, (c, r, value) => {
      let native = c.native(value);
      if (key === 'bold' || key === 'italic') {
        if (![0, 1, 2].includes(native)) throw new ControlError('SFUI1625', 'Formatting requires Off, On or Toggle');
        native = native === 2 ? !selectionFormat(richDocument(c, r), key) : native === 1;
      }
      if (key === 'underline') {
        if (![0, 1].includes(native)) throw new ControlError('SFUI1625', 'This text profile supports None and Single underline');
        native = native === 1;
      }
      if (key === 'foreground' && native && typeof native === 'object') {
        native = '#' + ['R', 'G', 'B'].map(channel => Number(native[channel]).toString(16).padStart(2, '0')).join('');
      }
      richDocument(c, r).formatSelection({ [key]: native }); c.write(r, property, value);
    });
  for (const [property, key] of [['Bold', 'bold'], ['Italic', 'italic'], ['Underline', 'underline'], ['Size', 'size']]) {
    registerGet(registry, T + 'ITextCharacterFormat', property, (c, r) => {
      const value = selectionFormat(richDocument(c, r), key);
      return key === 'size' ? value ?? 14 : value == null ? 3 : value ? 1 : 0;
    });
  }
}

function textFormat(options, reading) {
  const allowed = reading ? 8192 | 1 | 2 | 8 : 8192 | 4;
  if (!Number.isInteger(options) || options < 0 || (options & ~allowed)) {
    throw new ControlError('SFUI1629', 'Unsupported rich-text option flags', { options });
  }
  return options & 8192 ? 'rtf' : 'text';
}

function selectionFormat(model, key) {
  let offset = 0;
  const values = new Set();
  const { start, length } = model.selection;
  for (const run of model.runs) {
    const end = offset + run.text.length;
    if (end > start && offset < start + Math.max(1, length)) values.add(run.format[key] ?? (key === 'size' ? 14 : false));
    offset = end;
  }
  return values.size > 1 ? null : values.values().next().value;
}
