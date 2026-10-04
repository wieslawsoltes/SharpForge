import {CodeEditor, FoldingModel, FoldingStateStore, SyntaxHighlightIndex, BookmarkModel, ChangeTracking} from '@sharpforge/editor';

/** Production view lifecycle and model methods with inert paint/input surfaces; this fixture makes no browser-layout claim. */
export function ownershipView(model, session = {models: new Map(), views: new Set(), foldingState: new FoldingStateStore()}) {
  const cleanup = {dispose() {}};
  const view = Object.assign(Object.create(CodeEditor.prototype), {
    model, uri: model.uri, session, models: session.models, viewStates: new Map(), disposed: false,
    selections: model.selections.map(selection => ({...selection})), primaryIndex: model.primaryIndex,
    options: {endOfLine: model.metadata.dominantEol}, endOfLineExplicit: false,
    contributions: new Set(), decorationOwners: new Map(), element: {replaceChildren() {}},
    folding: new FoldingModel(), bookmarks: new BookmarkModel(model), changeTracking: new ChangeTracking(model),
    highlightIndex: new SyntaxHighlightIndex(model.snapshot()),
    view: {scrollTop: 0, viewport: {scrollLeft: 0}, layout: {reset() {}}, scroll: {reset() {}, update() {}},
      scrollTo({top, left}) { this.scrollTop = top; this.viewport.scrollLeft = left; }, dispose() {}},
    inputController: {composition: {cancel() {}}, dispose() {}},
    keymapAdapter: {setModel() {}, dispose() {}},
    presentation: {setReadOnly() {}, syncReadOnly() {}},
    largeFile: {update() {}, dispose() {}}, bracketColors: {update() {}, dispose() {}},
    foldingProvider: {refresh() {}, dispose() {}}, splitController: cleanup,
    accessibility: cleanup, zoomControl: cleanup, goToWidget: cleanup, cursor() {}
  });
  session.models.set(model.uri, model);
  session.views.add(view);
  return view;
}
