import {defaultDesignerOptions} from '../../packages/designer/src/index.js';
import {propertyButton, propertyDialog, propertyElement, propertyField, propertyInput, propertySelect, runPropertyAction} from './designer-property-dom.js';
import {applyDesignerOptions} from './designer-options-application.js';

/** Options are saved by the settings service and applied only when a document opens or the user requests it. */
export class DesignerOptionsController {
  constructor(view) { this.view = view; }

  render(parent) {
    const service = this.view.designerOptions;
    const document = parent.ownerDocument;
    const value = service?.value ?? defaultDesignerOptions;
    parent.replaceChildren();
    parent.append(propertyElement(document, 'h3', 'Designer options'));
    const fields = {
      defaultView: propertySelect(document, [{value: 'design', label: 'Design'}, {value: 'split', label: 'Split'},
        {value: 'code', label: 'Code'}], value.defaultView, 'Default view'),
      splitOrientation: propertySelect(document, ['vertical', 'horizontal'], value.splitOrientation, 'Split orientation'),
      snap: propertyInput(document, {type: 'number', value: value.snap, label: 'Snap distance'}),
      zoom: propertyInput(document, {type: 'number', value: value.zoom * 100, label: 'Default zoom percent'}),
      autoSync: propertyInput(document, {type: 'checkbox', label: 'Automatically synchronize source'}),
      naming: propertySelect(document, [{value: 'type', label: 'Button1'}, {value: 'camelCase', label: 'button1'},
        {value: 'none', label: 'No generated name'}], value.naming, 'New control names')
    };
    fields.autoSync.checked = value.autoSync;
    fields.snap.min = 1;
    fields.snap.max = 64;
    fields.zoom.min = 10;
    fields.zoom.max = 400;
    for (const [key, input] of Object.entries(fields)) parent.append(propertyField(document, input.getAttribute('aria-label') || key, input));
    const error = propertyElement(document, 'p', '', 'design-editor-error');
    error.hidden = true;
    const save = () => {
      if (!service) throw new Error('Designer settings service is unavailable.');
      return service.update({defaultView: fields.defaultView.value, splitOrientation: fields.splitOrientation.value,
        snap: Number(fields.snap.value), zoom: Number(fields.zoom.value) / 100, autoSync: fields.autoSync.checked, naming: fields.naming.value});
    };
    const status = propertyElement(document, 'p', '', 'design-settings-status');
    status.setAttribute('role', 'status');
    parent.append(propertyButton(document, 'Save defaults', () => runPropertyAction(() => {
      save();
      status.textContent = 'Saved. These defaults apply to new documents; existing guide settings are retained.';
    }, error)), propertyButton(document, 'Save and apply now', () => runPropertyAction(() => {
      save();
      applyDesignerOptions(this.view);
      status.textContent = 'Saved and applied to the active document.';
    }, error)), status, error);
  }

  open() {
    const document = this.view.panel('designer').ownerDocument;
    const modal = propertyDialog(document, 'Designer options');
    this.render(modal.body);
    return modal;
  }
}
