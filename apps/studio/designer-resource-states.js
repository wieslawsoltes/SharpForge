import {
  addDesignerVisualState, designerPropertySchema, formatDesignerProperty, recordDesignerStateProperty, setDesignerStateTransition
} from '../../packages/designer/src/index.js';
import {
  parseDesignerPropertyText, propertyButton, propertyDialog, propertyElement, propertyField, propertyInput, propertySelect
} from './designer-property-dom.js';

function stateTargetNodes(controller, target) {
  if (!target.template) return controller.view.document.value.nodes;
  const result = [];
  const visit = node => { result.push(node); (node.children ?? []).forEach(visit); };
  visit(controller.view.document.value.templates[target.template].root);
  return result;
}

export function renderDesignerStates(controller, parent, target) {
  const document = parent.ownerDocument;
  const design = controller.view.document.value;
  const owner = target.template ? design.templates[target.template] : design.nodes.find(node => node.id === target.nodeId);
  const details = propertyElement(document, 'details', '', 'design-state-editor');
  details.append(propertyElement(document, 'summary', 'Visual states'));
  const groups = owner.states ?? [];
  for (const group of groups) {
    details.append(propertyElement(document, 'h4', group.name));
    for (const state of group.states) {
      const row = propertyElement(document, 'div', '', 'design-state-row');
      row.append(propertyElement(document, 'span', state.name + ` · ${state.setters.length} setters`),
        propertyButton(document, 'Record property…', () => openRecordState(controller, target, group.name, state.name)),
        propertyButton(document, 'Preview', () => controller.view.safe(() => controller.previewState(target, {[group.name]: state.name}))),
        propertyButton(document, 'Transition…', () => openTransition(controller, target, group, state.name)));
      for (const setter of state.setters) row.append(propertyElement(document, 'small',
        `${setter.target}.${setter.property} = ${formatDesignerProperty(setter.value)}`));
      details.append(row);
    }
  }
  details.append(propertyButton(document, 'Add state…', () => {
    const modal = propertyDialog(document, 'Add visual state');
    const group = propertyInput(document, {value: 'CommonStates', label: 'Group name'});
    const state = propertyInput(document, {value: 'PointerOver', label: 'State name'});
    modal.body.append(propertyField(document, 'Group', group), propertyField(document, 'State', state));
    modal.footer.append(propertyButton(document, 'Create state', () => modal.run(() => {
      addDesignerVisualState(controller.view.document, target, group.value, state.value);
      modal.close();
    })));
  }));
  parent.append(details);
}

function openRecordState(controller, target, group, state) {
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Record ' + state + ' property');
  const nodes = stateTargetNodes(controller, target);
  const node = propertySelect(document, nodes.map(item => ({value: item.id, label: item.properties?.Name || item.id})), nodes[0].id, 'Target part');
  const property = propertySelect(document, [], '', 'State property');
  const value = propertyInput(document, {label: 'State property value', value: '#0078d4'});
  const updateProperties = () => {
    property.replaceChildren();
    for (const [name, schema] of Object.entries(designerPropertySchema(nodes.find(item => item.id === node.value).type))) {
      if (schema.readOnly || schema.isStatic || name === 'Name') continue;
      const option = propertyElement(document, 'option', name);
      option.value = name;
      property.append(option);
    }
    property.value = [...property.options].some(option => option.value === 'Background') ? 'Background' : property.options[0]?.value;
  };
  node.addEventListener('change', updateProperties);
  updateProperties();
  modal.body.append(propertyField(document, 'Target', node), propertyField(document, 'Property', property), propertyField(document, 'Value', value));
  modal.footer.append(propertyButton(document, 'Record setter', () => modal.run(() => {
    const schema = designerPropertySchema(nodes.find(item => item.id === node.value).type)[property.value];
    const parsed = parseDesignerPropertyText(value.value, schema.type);
    recordDesignerStateProperty(controller.view.document, target, {group, state, nodeId: node.value, property: property.value, value: parsed});
    modal.close();
  })));
}

function openTransition(controller, target, group, stateName) {
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Edit transition');
  const choices = [{value: '', label: '(Any state)'}, ...group.states.map(state => ({value: state.name, label: state.name}))];
  const from = propertySelect(document, choices, '', 'From state');
  const to = propertySelect(document, choices, stateName, 'To state');
  const duration = propertyInput(document, {type: 'number', value: 150, label: 'Duration milliseconds'});
  duration.min = 0;
  duration.max = 60000;
  modal.body.append(propertyField(document, 'From', from), propertyField(document, 'To', to), propertyField(document, 'Duration (ms)', duration));
  modal.body.append(propertyElement(document, 'p', 'An empty endpoint previews the base values and matches any state in generated transitions.'));
  modal.footer.append(propertyButton(document, 'Apply transition', () => modal.run(() => {
    setDesignerStateTransition(controller.view.document, target, group.name, {from: from.value, to: to.value, duration: Number(duration.value)});
    modal.close();
  })));
  modal.footer.append(propertyButton(document, 'Save and preview', () => modal.run(() => {
    const transition = {from: from.value, to: to.value, duration: Number(duration.value)};
    setDesignerStateTransition(controller.view.document, target, group.name, transition);
    controller.previewTransition(target, group.name, transition);
    modal.close();
  })));
}
