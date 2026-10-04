import { AccessibilityView, AutomationHeadingLevel, AutomationLandmarkType, AutomationLiveSetting, enumValue } from './enums.js';

const strings = new Set(['Name', 'AutomationId', 'HelpText', 'ItemStatus', 'FullDescription', 'LocalizedLandmarkType']);
const references = new Set(['LabeledBy', 'DescribedBy']);
const enumerations = { AccessibilityView, HeadingLevel: AutomationHeadingLevel, LandmarkType: AutomationLandmarkType,
  LiveSetting: AutomationLiveSetting };

export const automationPropertyDefaults = Object.freeze({ Name: '', AutomationId: '', HelpText: '', LabeledBy: null,
  DescribedBy: null, LiveSetting: 0, HeadingLevel: 0, LandmarkType: 0, AccessibilityView: 2, ItemStatus: '',
  PositionInSet: -1, SizeOfSet: -1, IsRequiredForForm: false, FullDescription: '', LocalizedLandmarkType: '' });

/** Read attached properties without confusing FrameworkElement.Name with an accessible name. */
export function getAutomationProperty(node, name) {
  if (!Object.hasOwn(automationPropertyDefaults, name)) throw new TypeError('Unknown AutomationProperties member: ' + name);
  const properties = node?.properties ?? {};
  return properties['AutomationProperties.' + name] ?? properties['Microsoft.UI.Xaml.Automation.AutomationProperties.' + name]
    ?? properties['$AutomationProperties.' + name] ?? automationPropertyDefaults[name];
}

export function hasAutomationProperty(node, name) {
  const properties = node?.properties ?? {};
  return ['AutomationProperties.', 'Microsoft.UI.Xaml.Automation.AutomationProperties.', '$AutomationProperties.']
    .some(prefix => Object.hasOwn(properties, prefix + name));
}

/** Validate programmatic attached writes before making them visible to the bridge. */
export function setAutomationProperty(node, name, value, invalidate = () => {}) {
  if (!Object.hasOwn(automationPropertyDefaults, name)) throw new TypeError('Unknown AutomationProperties member: ' + name);
  if (strings.has(name)) value = value == null ? '' : String(value);
  else if (references.has(name)) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some(item => item != null && typeof item !== 'string' && typeof item.$ref !== 'string')) {
      throw new TypeError(name + ' requires element references');
    }
    if (name === 'LabeledBy' && Array.isArray(value)) throw new TypeError('LabeledBy requires one element');
    if (values.length > 256) throw new RangeError('Automation relationship limit');
  } else if (enumerations[name]) value = enumValue(enumerations[name], value, name);
  else if (name === 'IsRequiredForForm') value = !!value;
  else if (!Number.isInteger(value) || value < -1 || value > 2147483647) throw new RangeError(name + ' must be -1 or a nonnegative integer');
  node.properties['AutomationProperties.' + name] = value;
  invalidate(node.id);
}

export function automationReferences(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map(item => typeof item === 'string' ? item : item?.$ref).filter(id => typeof id === 'string').slice(0, 256);
}

export function automationText(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
}

/** Collision-free ids preserve labels across renderer recreation and backend changes. */
export function automationElementId(rootId, id) {
  const encode = value => [...String(value)].map(character => character.codePointAt(0).toString(16)).join('-');
  return 'sf-ax-' + encode(rootId) + '--' + encode(id);
}
