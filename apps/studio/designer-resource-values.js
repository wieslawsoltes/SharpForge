import {DesignerAuthoringError, formatDesignerProperty} from '@sharpforge/designer';
import {MEDIA, XAML, canonicalType} from '@sharpforge/framework';
import {brushPropertyEditor} from './designer-property-brush.js';
import {propertyElement, propertyInput, propertySelect, runPropertyAction} from './designer-property-dom.js';

const brushTypes = new Set([MEDIA + 'Brush', MEDIA + 'SolidColorBrush', MEDIA + 'LinearGradientBrush']);
const compoundTypes = new Set([XAML + 'Thickness', XAML + 'CornerRadius', XAML + 'GridLength']);

/** Public entry kinds predate typed resources; only the declared value type determines brush editing. */
export function isDesignerBrushResource(entry) {
  return brushTypes.has(canonicalType(entry.value.type));
}

export function designerResourceValue(entry, theme = 'default') {
  return entry.value.kind === 'theme' ? entry.value.variants[theme] ?? entry.value.variants.default : entry.value.value;
}

export function designerResourceLabel(entry) {
  if (['style', 'template'].includes(entry.kind)) return entry.kind;
  const kind = isDesignerBrushResource(entry) ? 'brush' : canonicalType(entry.value.type).split('.').at(-1);
  return entry.kind === 'theme' ? 'theme ' + kind : kind;
}

function scalarEditor(document, type, value, commit, run) {
  const input = propertyInput(document, {value: formatDesignerProperty(value), label: 'Resource value',
    type: type === 'bool' ? 'checkbox' : ['int', 'double'].includes(type) ? 'number' : 'text'});
  if (type === 'bool') input.checked = value;
  if (type === 'double') input.step = 'any';
  if (type === 'int') { input.min = '-2147483648'; input.max = '2147483647'; input.step = '1'; }
  input.addEventListener('change', () => run(() => {
    if (type === 'bool') return commit(input.checked);
    if (['int', 'double'].includes(type)) {
      if (input.value.trim() === '') throw new DesignerAuthoringError('SFD1822', 'Enter a resource value.');
      return commit(Number(input.value));
    }
    return commit(input.value);
  }));
  return input;
}

/** A typed value or theme variant commits through the document validator as one undoable edit. */
export function renderDesignerResourceValue(controller, parent, selected) {
  const document = parent.ownerDocument;
  const model = controller.view.document;
  const type = canonicalType(selected.value.type);
  const theme = propertySelect(document, ['default', 'light', 'dark', 'highContrast'],
    controller.resourceThemes.get(selected.key) ?? 'default', 'Resource theme');
  const editor = propertyElement(document, 'div', '', 'design-resource-value-editor');
  const error = propertyElement(document, 'p', '', 'design-editor-error');
  error.hidden = true;
  const commit = value => model.change('Edit resource ' + selected.key, design => {
    const resource = design.resources[selected.key];
    if (!resource || resource.type !== type) throw new DesignerAuthoringError('SFD1822', 'Resource changed while its editor was open.');
    if (resource.kind === 'theme') resource.variants[theme.value] = value;
    else resource.value = value;
  });
  const run = action => runPropertyAction(action, error);
  const render = () => {
    const entry = {...selected, value: model.value.resources[selected.key]};
    const value = designerResourceValue(entry, theme.value);
    editor.replaceChildren();
    if (isDesignerBrushResource(entry)) {
      editor.append(brushPropertyEditor({document, name: selected.key, value, mixed: false, commit, run,
        openReference: () => { throw new DesignerAuthoringError('SFD1821', 'Set resource references on a control property.'); }}));
    } else if (['string', 'bool', 'int', 'double'].includes(type) || compoundTypes.has(type)) {
      editor.append(scalarEditor(document, type, value, commit, run));
    } else {
      editor.append(propertyElement(document, 'pre', formatDesignerProperty(value)));
      const diagnostic = propertyElement(document, 'p',
        'SFD1822: ' + type + ' is read-only in this editor. Edit its declaration in Code view.');
      diagnostic.setAttribute('role', 'status');
      editor.append(diagnostic);
    }
  };
  parent.append(propertyElement(document, 'p', 'Type: ' + type));
  if (selected.kind === 'theme') parent.append(theme);
  theme.addEventListener('change', () => {
    controller.resourceThemes.set(selected.key, theme.value);
    render();
  });
  parent.append(editor, error);
  render();
}
