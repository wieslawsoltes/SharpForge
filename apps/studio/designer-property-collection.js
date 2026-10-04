import {DesignerCollectionDraft, designerMetadata, designerPropertySchema, formatDesignerProperty} from '../../packages/designer/src/index.js';
import {propertyButton, propertyDialog, propertyElement, propertyField, propertyInput, propertySelect} from './designer-property-dom.js';

export function openDesignerCollectionEditor(context) {
  const draft = new DesignerCollectionDraft(context.modelDocument, context.ids[0], context.name);
  const modal = propertyDialog(context.document, 'Edit ' + context.name, {onCancel: () => draft.cancel()});
  let selected = draft.items.length ? 0 : -1;
  const edit = action => modal.run(() => { action(); render(); });
  const render = () => {
    modal.body.replaceChildren();
    const list = propertyElement(context.document, 'div', '', 'design-collection-items');
    list.setAttribute('role', 'listbox');
    for (let index = 0; index < draft.items.length; index++) {
      const value = draft.items[index];
      const label = value?.type ? value.type.split('.').at(-1) : formatDesignerProperty(value);
      const row = propertyButton(context.document, `${index + 1}. ${label}`, () => { selected = index; render(); });
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === selected));
      list.append(row);
    }
    modal.body.append(list);
    if (selected >= 0) renderItem(draft, selected, modal.body, {...context, run: modal.run});
    const actions = propertyElement(context.document, 'div', '', 'design-collection-actions');
    actions.append(propertyButton(context.document, draft.axis ? 'Add track' : 'Add text', () => edit(() => {
      draft.add(draft.axis ? '*' : 'New item');
      selected = draft.items.length - 1;
    })),
      propertyButton(context.document, 'Remove', () => edit(() => { draft.remove(selected); selected = Math.min(selected, draft.items.length - 1); }),
        {disabled: selected < 0}),
      propertyButton(context.document, 'Move up', () => edit(() => { draft.move(selected, selected - 1); selected--; }), {disabled: selected <= 0}),
      propertyButton(context.document, 'Move down', () => edit(() => { draft.move(selected, selected + 1); selected++; }),
        {disabled: selected < 0 || selected >= draft.items.length - 1}));
    if (!draft.axis) {
      const types = propertySelect(context.document, designerMetadata.filter(item => item.type.endsWith('Item'))
        .map(item => ({value: item.type, label: item.name})), undefined, 'Collection item type');
      actions.append(types, propertyButton(context.document, 'Add object', () => edit(() => {
        const schema = designerPropertySchema(types.value);
        const property = schema.Content ? 'Content' : schema.Text ? 'Text' : null;
        draft.add({type: types.value, properties: property ? {[property]: 'New item'} : {}});
        selected = draft.items.length - 1;
      })));
    }
    modal.body.append(actions);
  };
  modal.footer.append(propertyButton(context.document, 'Apply collection', () => modal.run(() => { draft.apply(); modal.close(); })));
  render();
  return modal;
}

function renderItem(draft, index, root, context) {
  const item = draft.items[index];
  if (!item || typeof item !== 'object' || draft.axis) {
    const type = typeof item === 'boolean' ? 'checkbox' : typeof item === 'number' ? 'number' : 'text';
    const input = propertyInput(context.document, {value: formatDesignerProperty(item), type, label: 'Item value'});
    input.checked = item === true;
    input.addEventListener('change', () => context.run(() =>
      draft.set(index, type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value)));
    root.append(propertyField(context.document, 'Value', input));
    return;
  }
  const schema = designerPropertySchema(item.type);
  for (const [name, property] of Object.entries(schema)) {
    if (property.readOnly || property.isStatic || !['string', 'double', 'int', 'bool', 'object'].includes(property.type)) continue;
    const input = propertyInput(context.document, {value: formatDesignerProperty(item.properties[name]),
      type: property.type === 'bool' ? 'checkbox' : ['int', 'double'].includes(property.type) ? 'number' : 'text', label: name});
    input.checked = !!item.properties[name];
    input.addEventListener('change', () => context.run(() => {
      const updated = structuredClone(draft.items[index]);
      if (property.type === 'bool') updated.properties[name] = input.checked;
      else if (!input.value) delete updated.properties[name];
      else updated.properties[name] = ['double', 'int'].includes(property.type) ? Number(input.value) : input.value;
      draft.set(index, updated);
    }));
    root.append(propertyField(context.document, name, input));
  }
}
