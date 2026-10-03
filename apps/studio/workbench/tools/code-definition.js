import {element} from '../ui.js';
import {cancellable} from '../events.js';

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
    try {
      const definition = await cancellable(request('definition', {uri: current.uri, offset: current.offset}), controller.signal);
      let target;
      if (definition?.uri) {
        target = documents.get(definition.uri) ?? await readDocument?.(definition.uri, {signal: controller.signal});
      } else {
        const hover = await cancellable(request('hover', {uri: current.uri, offset: current.offset}), controller.signal);
        let start = current.offset, end = current.offset;
        while (start > 0 && /[\w.]/u.test(file.text[start - 1])) start--;
        while (end < file.text.length && /[\w.]/u.test(file.text[end])) end++;
        target = await frameworkDefinition(hover?.symbol?.type ?? file.text.slice(start, end));
      }
      if (serial !== generation || controller.signal.aborted || documents.get(file.uri)?.version !== file.version) return;
      if (!target) { title.textContent = 'No bound source or framework metadata definition at the caret'; source.value = ''; return; }
      title.textContent = target.uri;
      source.value = target.text;
      if (definition) {
        source.setSelectionRange(definition.start, definition.end);
        source.scrollTop = Math.max(0, (target.text.slice(0, definition.start).split('\n').length - 3) * 20);
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
