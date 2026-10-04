import { controlEventRequester, requestControlEvent } from '../policy/event-requests.js';
import { interceptAcknowledgedEdit } from './acknowledged-input.js';
import { TextBuffer } from './text-buffer.js';
import { PasswordBuffer } from './passwordbox.js';
import { controlName, createPart, emitChange, registerFamily, stateFor, ControlError } from '../policy/events.js';
import { sourceItems, itemText, itemAt } from '../items/item-source.js';

export function getTextModel(context, node) {
  return stateFor(context, node, 'text-edit', () => {
    const password = controlName(node) === 'PasswordBox';
    const model = password ? new PasswordBuffer() : new TextBuffer({ text: node.properties.Text ?? '' });
    for (const name of password ? ['PasswordChanging', 'PasswordChanged']
      : ['BeforeTextChanging', 'TextChanging', 'TextChanged', 'SelectionChanged',
        'TextCompositionStarted', 'TextCompositionChanged', 'TextCompositionEnded']) {
      model.on(name, args => {
        if (name === 'PasswordChanged' && args.reason === 'user') context.privateInput(node, 'Password', model.read());
        if (name === 'TextChanged') {
          node.properties.Text = model.text;
          node.properties.CanUndo = model.canUndo;
          node.properties.CanRedo = model.canRedo;
          args.value = model.text;
          args.Reason = args.reason === 'programmatic' ? 1 : args.reason === 'suggestion' ? 2 : 0;
          args.SelectionStart = model.selectionStart;
          args.SelectionLength = model.selectionLength;
        }
        if (name === 'SelectionChanged') {
          node.properties.SelectionStart = model.selectionStart;
          node.properties.SelectionLength = model.selectionLength;
          node.properties.SelectedText = model.selectedText;
        }
        context.emit(node, name, args);
      });
    }
    return model;
  });
}

function ensureEditor(context, node, element) {
  const tag = node.properties.AcceptsReturn && controlName(node) !== 'PasswordBox' ? 'TEXTAREA' : 'INPUT';
  let editor = element.querySelector('[data-part="text-editor"]');
  if (editor?.tagName === tag) return editor;
  const active = editor === context.document.activeElement;
  const start = editor?.selectionStart ?? 0;
  const end = editor?.selectionEnd ?? 0;
  const replacement = createPart(context.document, tag.toLowerCase(), 'text-editor');
  replacement.value = editor?.value ?? '';
  if (editor) editor.replaceWith(replacement);
  else element.insertBefore(replacement, element.children[1] ?? null);
  editor = replacement;
  if (active) { editor.focus(); editor.setSelectionRange?.(start, end); }
  return editor;
}

function renderEditor(context, node, element) {
  const properties = node.properties;
  const model = getTextModel(context, node);
  const editor = ensureEditor(context, node, element);
  const password = controlName(node) === 'PasswordBox';
  const header = element.querySelector('[data-part="text-header"]');
  const description = element.querySelector('[data-part="text-description"]');
  header.textContent = String(properties.Header ?? '');
  header.hidden = properties.Header == null;
  description.textContent = String(properties.Description ?? '');
  description.hidden = !properties.Description;
  editor.id = 'sf-text-' + node.id.replace(/[^\w-]/g, '-');
  header.htmlFor = editor.id;
  model.maximumLength = properties.MaxLength ?? 0;
  if (password) {
    if (Object.hasOwn(properties, 'Password')) {
      model.set(String(properties.Password ?? ''));
      delete properties.Password;
    }
    editor.type = properties.PasswordRevealMode === 2 ? 'text' : 'password';
    editor.autocomplete = 'current-password';
    if (editor.value !== model.read()) editor.value = model.read();
  } else {
    model.readOnly = !!properties.IsReadOnly;
    model.characterCasing = properties.CharacterCasing ?? 0;
    if (!model.composition && String(properties.Text ?? '') !== model.text) {
      model.silence(() => model.replace(properties.Text ?? '', { record: false, force: true }));
    }
    if (!model.composition && editor.value !== model.text) editor.value = model.text;
    if (!model.composition) {
      const start = Math.max(0, Math.min(model.text.length, properties.SelectionStart ?? model.selectionStart));
      const length = Math.max(0, Math.min(model.text.length - start, properties.SelectionLength ?? model.selectionLength));
      model.silence(() => model.select(start, length));
      if (editor.selectionStart !== start || editor.selectionEnd !== start + length) editor.setSelectionRange?.(start, start + length);
    }
    editor.readOnly = model.readOnly;
    editor.spellcheck = properties.IsSpellCheckEnabled !== false;
    const inputScope = properties.InputScope?.NameValue ?? properties.InputScope;
    editor.inputMode = typeof inputScope === 'string' && ['text', 'none', 'decimal', 'numeric', 'tel', 'search', 'email', 'url'].includes(inputScope)
      ? inputScope : ({ 7: 'email', 20: 'numeric', 31: 'tel', 50: 'search', 1: 'url' }[inputScope] ?? 'text');
    editor.style.whiteSpace = properties.TextWrapping === 0 ? 'pre' : 'pre-wrap';
    editor.style.overflowWrap = properties.TextWrapping === 0 ? 'normal' : 'anywhere';
    editor.style.textAlign = ['left', 'center', 'right', 'justify', 'start'][properties.TextAlignment ?? 0];
  }
  editor.dir = properties.FlowDirection === 1 ? 'rtl' : 'ltr';
  editor.placeholder = properties.PlaceholderText ?? '';
  editor.disabled = properties.IsEnabled === false;
  if (properties.MaxLength > 0) editor.maxLength = properties.MaxLength;
  else editor.removeAttribute('maxlength');
  if (controlName(node) === 'AutoSuggestBox') renderSuggestions(context, node, element);
  const reveal = element.querySelector('[data-part="password-reveal"]');
  reveal.hidden = !password || (properties.PasswordRevealMode ?? 0) !== 0;
}

function renderSuggestions(context, node, element) {
  const state = stateFor(context, node, 'suggestions', () => ({ active: -1, open: false }));
  const popup = element.querySelector('[data-part="suggestions"]');
  const items = sourceItems(context, node);
  if (items.length > 2048) throw new ControlError('SFUI1603', 'AutoSuggestBox exceeds its 2048-suggestion budget');
  popup.hidden = !state.open || !items.length;
  popup.setAttribute('role', 'listbox');
  popup.id = 'sf-suggestions-' + node.id.replace(/[^\w-]/g, '-');
  const editor = element.querySelector('[data-part="text-editor"]');
  editor.setAttribute('role', 'combobox');
  editor.setAttribute('aria-autocomplete', 'list');
  editor.setAttribute('aria-controls', popup.id);
  editor.setAttribute('aria-expanded', String(!popup.hidden));
  context.ordered(popup, Array.from({ length: items.length }, (_, index) => {
    const item = itemAt(items, index);
    const option = popup.children[index] ?? context.document.createElement('div');
    option.dataset.suggestionIndex = String(index);
    option.id = popup.id + '-' + index;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(state.active === index));
    option.textContent = itemText(context, item, node.properties.TextMemberPath);
    return option;
  }));
  if (state.active >= 0) editor.setAttribute('aria-activedescendant', popup.id + '-' + state.active);
  else editor.removeAttribute('aria-activedescendant');
}

function suggestEvent(context, node, element, event) {
  const state = stateFor(context, node, 'suggestions', () => ({ active: -1, open: false }));
  const items = sourceItems(context, node);
  const option = event.target.closest?.('[data-suggestion-index]');
  if (event.type === 'input') { state.open = true; state.active = -1; context.invalidate(node.id); return false; }
  if (event.type === 'keydown' && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    state.active = Math.max(0, Math.min(items.length - 1, state.active + (event.key === 'ArrowDown' ? 1 : -1)));
    state.open = true;
    context.invalidate(node.id);
    return true;
  }
  if (event.type === 'click' && option) state.active = Number(option.dataset.suggestionIndex);
  if (event.key === 'Enter' || event.type === 'click' && option) {
    const chosen = state.open ? itemAt(items, state.active) ?? null : null;
    if (chosen !== null) {
      context.emit(node, 'SuggestionChosen', { SelectedItem: chosen });
      if (node.properties.UpdateTextOnSelect !== false) getTextModel(context, node).replace(itemText(context, chosen,
        node.properties.TextMemberPath), { reason: 'suggestion' });
    }
    state.open = false;
    emitChange(context, node, 'QuerySubmitted', { QueryText: getTextModel(context, node).text, ChosenSuggestion: chosen });
    return true;
  }
  if (event.key === 'Escape') { state.open = false; context.invalidate(node.id); return true; }
  return false;
}

function editEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  if (event.target.dataset.part === 'password-reveal') {
    const editor = element.querySelector('[data-part="text-editor"]');
    if (event.type === 'pointerdown') {
      event.preventDefault();
      event.target.setPointerCapture?.(event.pointerId);
      editor.type = 'text';
    } else if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type)) editor.type = 'password';
    return true;
  }
  if (controlName(node) === 'AutoSuggestBox' && suggestEvent(context, node, element, event)) return true;
  const editor = element.querySelector('[data-part="text-editor"]');
  const model = getTextModel(context, node);
  if (event.type === 'input' && model instanceof PasswordBuffer) {
    if (controlEventRequester(context) && node.events?.includes('PasswordChanging')) {
      requestPasswordEdit(context, node, editor, model);
      return true;
    }
    model.set(editor.value, { reason: 'user' });
    return true;
  }
  if (model instanceof PasswordBuffer) return false;
  if (interceptAcknowledgedEdit(context, node, editor, model, event)) return true;
  if (event.type === 'compositionstart') model.beginComposition();
  else if (event.type === 'compositionupdate') model.updateComposition(event.data ?? '');
  else if (event.type === 'compositionend') model.endComposition(editor.value,
    { fullText: true, selectionStart: editor.selectionStart ?? editor.value.length });
  else if (event.type === 'input' && !model.composition && !event.isComposing) {
    if (!model.replace(editor.value, { reason: 'user', selectionStart: editor.selectionStart ?? 0,
      selectionLength: (editor.selectionEnd ?? 0) - (editor.selectionStart ?? 0) })) editor.value = model.text;
  } else if (event.type === 'select') model.select(editor.selectionStart ?? 0,
    (editor.selectionEnd ?? 0) - (editor.selectionStart ?? 0));
  else if (event.type === 'keydown' && (event.ctrlKey || event.metaKey)) {
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) model.redo();
      else model.undo();
      editor.value = model.text;
      editor.setSelectionRange?.(model.selectionStart, model.selectionStart + model.selectionLength);
      return true;
    }
  }
  return ['input', 'select', 'compositionstart', 'compositionupdate', 'compositionend'].includes(event.type);
}

export function registerEditRenderers(registry) {
  registerFamily(registry, ['TextBox', 'PasswordBox', 'AutoSuggestBox'], { create(context) {
    const root = context.document.createElement('div');
    const reveal = createPart(context.document, 'button', 'password-reveal');
    reveal.textContent = 'Show';
    reveal.setAttribute('aria-label', 'Reveal password while pressed');
    reveal.hidden = true;
    root.append(createPart(context.document, 'label', 'text-header'), createPart(context.document, 'div', 'text-description'),
      createPart(context.document, 'div', 'suggestions'), reveal);
    return root;
  }, render: renderEditor, getTextModel,
  invoke(context, node, element, method, args = []) {
    const model = getTextModel(context, node);
    const editor = element.querySelector('[data-part="text-editor"]');
    if (method === 'GetText') return model instanceof PasswordBuffer ? undefined : model.text;
    if (node.properties.IsEnabled === false) return false;
    if (method === 'SelectAll') { editor.select(); if (!(model instanceof PasswordBuffer)) model.selectAll(); return true; }
    if (method === 'SelectText' && !(model instanceof PasswordBuffer)) {
      model.select(Number(args[0]), Number(args[1])); editor.setSelectionRange?.(model.selectionStart, model.selectionStart + model.selectionLength);
    } else if (method === 'SetValue' && !(model instanceof PasswordBuffer)) {
      if (!model.replace(String(args[0]), { reason: 'automation' })) return false;
      editor.value = model.text;
    } else return undefined;
    context.invalidate(node.id); return true;
  },
  setPrivateValue(context, node, element, property, value) {
    if (property !== 'Password' || controlName(node) !== 'PasswordBox') return false;
    const model = getTextModel(context, node);
    model.silence(() => model.set(String(value ?? '')));
    renderEditor(context, node, element);
    return true;
  },
  getPrivateValue(context, node, element, property) {
    if (property !== 'Password' || controlName(node) !== 'PasswordBox') return undefined;
    return getTextModel(context, node).read();
  },
  events: { beforeinput: editEvent, paste: editEvent, input: editEvent, select: editEvent, keydown: editEvent, click: editEvent,
    compositionstart: editEvent, compositionupdate: editEvent, compositionend: editEvent,
    pointerdown: editEvent, pointerup: editEvent, pointercancel: editEvent, lostpointercapture: editEvent } });
}

function requestPasswordEdit(context, node, editor, model) {
  const state = stateFor(context, node, 'password-request', () => ({ revision: 0, controller: null,
    dispose() { this.revision++; this.controller?.abort(); } }));
  const revision = ++state.revision;
  state.controller?.abort();
  state.controller = new AbortController();
  let value = editor.value;
  const length = model.maximumLength > 0 ? Math.min(value.length, model.maximumLength) : value.length;
  requestControlEvent(context, node, 'PasswordChanging', { Cancel: false, Length: length },
    { signal: state.controller.signal }).then(payload => {
    if (!payload.Cancel && revision === state.revision) {
      model.set(value, { reason: 'user', approved: true });
      editor.value = model.read();
    } else if (revision === state.revision) editor.value = model.read();
  }).catch(error => { if (error?.name !== 'AbortError') context.host.options.onError?.(error); })
    .finally(() => { value = ''; });
}
