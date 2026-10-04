import {element} from '../ui.js';
import {cancellable} from '../events.js';
import {documentSize, readDocumentRange} from '../document-size.js';

export async function frameworkDefinition(name) {
  const {frameworkType, contracts, propertiesFor} = await import('@sharpforge/framework');
  const type = frameworkType(name);
  if (!type) return null;
  const lines = ['// SharpForge framework contract metadata; read-only', `${type.kind} ${type.name}${type.base ? ' : ' + type.base : ''}`, '{'];
  for (const [name, property] of Object.entries(propertiesFor(type.name))) {
    lines.push(`    ${property.type} ${name} { get; ${property.readOnly ? '' : 'set; '}}`);
  }
  for (const contract of contracts.filter(item => item.owner === type.name)) {
    lines.push(`    ${contract.isStatic ? 'static ' : ''}${contract.result} ${contract.name}(${contract.parameters.join(', ')});`);
  }
  lines.push('}');
  return {uri: 'metadata:' + type.name, text: lines.join('\n'), readOnly: true};
}

export function mountCodeDefinition(host, {request, documents, context, readDocument, onError}) {
  const document = host.ownerDocument;
  const title = element(document, 'p', {className: 'wb-tool-status'});
  const source = element(document, 'textarea', {className: 'wb-definition-editor', readonly: true,
    'aria-label': 'Read-only code definition', spellcheck: false});
  host.replaceChildren(title, source);
  let timer, controller, generation = 0, locationKey = '';
  const load = async () => {
    controller?.abort();
    controller = new AbortController();
    const serial = ++generation;
    const current = context();
    const file = documents.get(current.uri);
    if (!file) { title.textContent = 'No active source document'; source.value = ''; return; }
    const version = file.version;
    try {
      const definition = await cancellable(request('definition', {uri: current.uri, offset: current.offset}), controller.signal);
      let target;
      if (definition?.uri) {
        target = documents.get(definition.uri) ?? await readDocument?.(definition.uri, {signal: controller.signal});
      } else {
        const hover = await cancellable(request('hover', {uri: current.uri, offset: current.offset}), controller.signal);
        const offset = current.offset ?? 0;
        const around = readDocumentRange(documents, file, {start: Math.max(0, offset - 512),
          end: Math.min(documentSize(documents, file), offset + 512), limit: 1024});
        let start = offset - around.start, end = start;
        while (start > 0 && /[\w.]/u.test(around.text[start - 1])) start--;
        while (end < around.text.length && /[\w.]/u.test(around.text[end])) end++;
        target = await frameworkDefinition(hover?.symbol?.type ?? around.text.slice(start, end));
      }
      if (serial !== generation || controller.signal.aborted || documents.get(file.uri)?.version !== version) return;
      if (!target) { title.textContent = 'No bound source or framework metadata definition at the caret'; source.value = ''; return; }
      const offset = Number.isSafeInteger(definition?.start) ? definition.start : 0;
      const excerpt = readDocumentRange(documents, target, {start: Math.max(0, offset - 8192)});
      title.textContent = target.uri + (excerpt.truncated ? ` · excerpt ${excerpt.start + 1}–${excerpt.end} of ${excerpt.length} characters` : '');
      source.value = excerpt.text;
      if (definition) {
        const selectionStart = Math.max(0, offset - excerpt.start);
        const selectionEnd = Math.max(selectionStart, (definition.end ?? offset) - excerpt.start);
        source.setSelectionRange(selectionStart, selectionEnd);
        source.scrollTop = Math.max(0, (excerpt.text.slice(0, selectionStart).split('\n').length - 3) * 20);
      }
    } catch (error) { if (error.name !== 'AbortError') { title.textContent = error.message; onError(error); } }
  };
  const refresh = () => {
    const current = context();
    const key = current.uri + ':' + current.offset + ':' + documents.get(current.uri)?.version;
    if (key === locationKey) return;
    locationKey = key;
    clearTimeout(timer);
    timer = setTimeout(load, 120);
  };
  refresh();
  return {refresh, dispose: () => { clearTimeout(timer); controller?.abort(); generation++; }};
}
