import {validateControlStateChanges} from './visual-state.js';
import {controlVisualStates} from '../policy/default-templates.js';
import {read} from '../policy/adapter-helpers.js';

class ControlInputState {
  constructor() { this.values = {}; }
  snapshot() { return {...this.values}; }
  restore(snapshot) { this.values = validateControlStateChanges([{id: 'state', properties: snapshot}])[0].properties; }
}

/** Both managed engines and the JavaScript facade apply host state before the associated event dispatch. */
export function applyControlStateFeedback(context, changes) {
  const batch = validateControlStateChanges(changes).map(change => ({...change, owner: context.reference(change.id)}));
  for (const {owner, properties} of batch) {
    const definitions = context.propertiesFor(context.typeOf(owner));
    const state = context.state(owner, 'controlInputState', () => new ControlInputState());
    Object.assign(state.values, properties);
    for (const [name, value] of Object.entries(properties)) {
      if (definitions[name]?.readOnly) context.write(owner, name, value);
    }
    if (!definitions.Template) continue;
    const values = {...state.values};
    for (const name of ['IsEnabled', 'IsSelected']) {
      if (definitions[name]) values[name] = read(context, owner, name);
    }
    context.services.visualStates?.apply(owner, controlVisualStates(values));
  }
  return batch.length;
}
