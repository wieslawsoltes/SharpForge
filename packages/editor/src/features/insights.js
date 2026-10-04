import {createInsightContext} from './context.js';
import {CompletionWidget} from '../widgets/completion.js';
import {SignatureHelpWidget} from '../widgets/signature-help.js';
import {QuickInfoWidget} from '../widgets/quick-info.js';
import {CodeActionsWidget} from '../widgets/code-actions.js';
import {InlineRenameWidget} from '../widgets/rename.js';
import {PeekDefinitionWidget} from '../widgets/peek-definition.js';
import {NavigationBar} from '../widgets/navigation-bar.js';
import {FindReplaceWidget} from '../widgets/find-replace.js';
import {IncrementalSearchWidget} from '../widgets/incremental-search.js';
import {SnippetSession} from '../snippets/session.js';
import {AnalysisDecorations} from './analysis-decorations.js';
import {SmartTyping} from './smart-typing.js';
import {EditorFormatting} from './formatting.js';

/** A disposable editor contribution; providers supply language intelligence, widgets own interaction and presentation. */
export function createEditorInsights(editor, options = {}) {
  const context = createInsightContext(editor, options);
  const completion = new CompletionWidget(context);
  const signatures = new SignatureHelpWidget(context);
  const hover = new QuickInfoWidget(context);
  const snippets = new SnippetSession(context);
  const actions = new CodeActionsWidget(context);
  const rename = new InlineRenameWidget(context);
  const peek = new PeekDefinitionWidget(context);
  const navigation = new NavigationBar(context);
  const find = new FindReplaceWidget(context);
  const incremental = new IncrementalSearchWidget(context);
  const decorations = new AnalysisDecorations(context);
  const typing = new SmartTyping(context);
  const formatting = new EditorFormatting(context);
  Object.assign(context, {snippets, actions, formatting});
  let disposed = false;
  let revision = editor.uri;
  const safe = callback => context.safe(callback);
  const refresh = () => safe(async () => {
    await Promise.all([decorations.refresh(), navigation.refresh(), actions.refresh()]);
  });
  const controller = {
    services: context.services, workspace: context.workspace,
    get completionVisible() { return completion.popup.visible; },
    get completionItems() { return completion.ranked.map(item => item.item); },
    get completionIndex() { return completion.index; },
    toggleCompletionMode: () => completion.toggleSuggestion(),
    changeCompletionFilterLevel: direction => completion.changeFilterLevel(direction),
    decreaseCompletionFilterLevel: () => completion.changeFilterLevel(-1),
    increaseCompletionFilterLevel: () => completion.changeFilterLevel(1),
    complete: trigger => safe(() => completion.open(trigger)),
    acceptCompletion: character => completion.accept(character),
    closeCompletion: () => completion.close(),
    paintCompletion: () => completion.render(),
    quickInfo: (offset = editor.offset) => safe(() => hover.open(offset, true)),
    signatureHelp: trigger => safe(() => signatures.open(trigger)),
    codeActions: () => safe(() => actions.open()),
    peekDefinition: () => safe(() => peek.open()),
    peekBackward: () => safe(() => peek.next(-1)),
    peekForward: () => safe(() => peek.next(1)),
    showCodeLensMenu: () => decorations.showCodeLensMenu(),
    rename: () => safe(() => rename.open()),
    insertSnippet: template => template ? snippets.insert(template) : snippets.picker(),
    surroundWith: () => snippets.picker(true),
    openFind: replace => find.open(replace),
    findNext: (reset, direction) => find.next(reset, direction),
    async findSelected(direction = 1) {
      const start = editor.offset;
      const end = editor.input.selectionEnd;
      const source = editor.sourceSnapshot();
      if (start === end) {
        const read = (from, to) => source.getText?.(from, to) ?? source.text.slice(from, to);
        const left = read(Math.max(0, start - 1024), start).match(/[\p{L}\p{N}_]+$/u)?.[0] ?? '';
        const right = read(start, Math.min(source.length, start + 1024)).match(/^[\p{L}\p{N}_]+/u)?.[0] ?? '';
        find.find.input.value = left + right;
      }
      await find.open(false);
      if (editor.uri !== source.uri || editor.sourceSnapshot().version !== source.version) return;
      find.index = find.session.matches.findIndex(match => match.uri === editor.uri && match.start <= start && match.end >= end);
      await find.next(false, direction);
      editor.focus();
    },
    copyParameterTip: () => safe(async () => {
      const signature = signatures.signatures[signatures.index];
      if (!signature) throw new Error('Open Parameter Info before copying a signature.');
      const clipboard = options.clipboard ?? context.document.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard writing is unavailable in this host.');
      await clipboard.writeText(signature.label);
    }),
    pasteParameterTip: () => safe(async () => {
      const clipboard = options.clipboard ?? context.document.defaultView?.navigator.clipboard;
      if (!clipboard?.readText) throw new Error('Clipboard reading is unavailable in this host.');
      const result = await context.guard.run('clipboard', () => clipboard.readText());
      if (result && !editor.input.readOnly) editor.insert(result.value);
    }),
    replaceCurrent: all => safe(() => find.replace(all)),
    incrementalSearch: direction => incremental.open(direction),
    format: options => safe(() => formatting.format(options)),
    focusNavigation: () => navigation.focus(),
    nextReference: direction => decorations.nextReference(direction),
    nextDiagnostic: direction => decorations.nextDiagnostic(direction),
    setDiagnostics: (items, version) => decorations.setDiagnostics(items, version),
    refresh,
    beforeEdit: () => snippets.beforeEdit(),
    afterEdit: () => snippets.afterEdit(),
    beforeinput(event) {
      if (rename.origin) { event.preventDefault(); return true; }
      formatting.beforeinput(event);
      return false;
    },
    keydown(event) {
      if (disposed || event.isComposing || editor.composing) return false;
      if (rename.origin) {
        if (event.key === 'Escape') rename.cancel();
        else if (event.key === 'Enter') safe(() => rename.commit());
        return true;
      }
      if (completion.keydown(event) || snippets.keydown(event) || signatures.keydown(event) || decorations.keydown(event)) return true;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.code === 'Space') {
        if (event.shiftKey) safe(() => signatures.open());
        else safe(() => completion.open());
        return true;
      }
      if (event.altKey && event.key === 'F12') { safe(() => peek.open()); return true; }
      if (mod && event.key === 'F2') { navigation.focus(); return true; }
      if (mod && event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        decorations.nextReference(event.key === 'ArrowUp' ? -1 : 1);
        return true;
      }
      if (event.key === 'Escape') {
        peek.close();
        hover.close();
        actions.close();
        return false;
      }
      return typing.keydown(event);
    },
    changed(change) {
      if (disposed) return;
      context.guard.cancelAll();
      if (revision !== editor.uri) {
        revision = editor.uri;
        snippets.stop();
        completion.close();
        peek.close();
      }
      hover.close();
      actions.changed();
      decorations.changed();
      snippets.changed(change);
      typing.changed(change);
      formatting.changed(change);
      find.changed();
      completion.changed(change);
      const edits = change?.changes ?? change?.edits ?? [];
      const text = edits.at(-1)?.text ?? edits.at(-1)?.insertText ?? edits.at(-1)?.newText ?? '';
      if ((options.completionTriggerCharacters ?? ['.']).includes(text)) {
        context.lifetime.delay('completion-trigger', () => safe(() => completion.open(text)), 0);
      }
      if (text === '(' || text === ',' || signatures.popup.visible) {
        context.lifetime.delay('signature-update', () => safe(() => signatures.open(text)), 40);
      }
      context.lifetime.delay('analysis', refresh, options.analysisDelay ?? 180);
    },
    cursor() {
      if (disposed) return;
      navigation.cursor();
      actions.position();
      context.lifetime.delay('references', () => safe(() => decorations.highlights()), 120);
      context.lifetime.delay('actions', () => safe(() => actions.refresh()), 200);
      if (signatures.popup.visible) context.lifetime.delay('signature-cursor', () => safe(() => signatures.open()), 80);
    },
    render() {
      if (disposed) return;
      completion.popup.position();
      signatures.popup.position();
      hover.popup.position();
      actions.position();
      decorations.resolveVisibleLenses();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      context.guard.dispose();
      context.lifetime.dispose();
      for (const widget of [completion, signatures, hover, snippets, actions, rename, peek, navigation, find, incremental, decorations]) widget.dispose();
      context.statusElement.remove();
      if (!options.services) context.services.dispose();
    }
  };
  context.lifetime.delay('initial-analysis', refresh, 0);
  return controller;
}
