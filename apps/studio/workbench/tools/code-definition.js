import {element} from '../ui.js';
import {readDocumentRange} from '../document-size.js';
import {MetadataCatalog} from '../metadata/catalog.js';
import {resolveCodeDefinition} from './code-definition-provider.js';

export async function frameworkDefinition(name) {
  const metadata = new MetadataCatalog();
  try { return await metadata.definition({expression: name}); }
  finally { metadata.dispose(); }
}

function showDefinition({title, source, documents}, result) {
  if (!result) { title.textContent = 'No source or referenced metadata definition at the caret'; source.value = ''; return; }
  const {target, definition} = result, offset = Number.isSafeInteger(definition?.start) ? definition.start : 0;
  const excerpt = readDocumentRange(documents, target, {start: Math.max(0, offset - 8192)});
  title.textContent = (target.assemblyIdentity ?? target.uri) + (target.metadataSourceVersion !== undefined ?
    ' · metadata version ' + target.metadataSourceVersion : '') + (target.overloadCount > 1 ? ' · ' + target.overloadCount + ' matching overloads' : '') +
    (excerpt.truncated ? ` · excerpt ${excerpt.start + 1}–${excerpt.end} of ${excerpt.length} characters` : '');
  source.value = excerpt.text;
  const selectionStart = Math.max(0, offset - excerpt.start);
  const selectionEnd = Math.max(selectionStart, Math.min(excerpt.text.length, (definition?.end ?? offset) - excerpt.start));
  source.setSelectionRange(selectionStart, selectionEnd);
  source.scrollTop = Math.max(0, (excerpt.text.slice(0, selectionStart).split('\n').length - 3) * 20);
}

export function mountCodeDefinition(host, {request, documents, context, readDocument, metadata, onError}) {
  const catalog = metadata ?? new MetadataCatalog();
  const document = host.ownerDocument;
  const title = element(document, 'p', {className: 'wb-tool-status'});
  const source = element(document, 'textarea', {className: 'wb-definition-editor', readonly: true,
    'aria-label': 'Read-only code definition', spellcheck: false});
  host.replaceChildren(title, source);
  let timer, controller, generation = 0, locationKey = '';
  const load = async () => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal, serial = ++generation, current = {...context()};
    const file = documents.get(current.uri), version = file?.version;
    const fresh = () => {
      const next = context();
      return serial === generation && !signal.aborted && documents.get(current.uri) === file && file?.version === version &&
        next.uri === current.uri && next.offset === current.offset && next.projectId === current.projectId && next.workspaceEpoch === current.workspaceEpoch;
    };
    if (!file) { showDefinition({title, source, documents}, null); return; }
    try {
      const result = await resolveCodeDefinition({request, documents, readDocument, metadata: catalog}, current, {signal});
      if (fresh()) showDefinition({title, source, documents}, result);
    } catch (error) { if (fresh() && error.name !== 'AbortError') { title.textContent = error.message; source.value = ''; onError(error); } }
  };
  const refresh = () => {
    const current = context();
    const key = [current.projectId, current.workspaceEpoch, current.uri, current.offset, documents.get(current.uri)?.version].join(':');
    if (key === locationKey) return;
    locationKey = key;
    clearTimeout(timer);
    controller?.abort();
    timer = setTimeout(load, 120);
  };
  refresh();
  return {refresh, dispose: () => { clearTimeout(timer); controller?.abort(); generation++; if (!metadata) catalog.dispose(); }};
}
