import { loadInput, validateDump } from './winui-measure/run.js';

/** Adopt all 20 measurements together; an individual control is never a complete capture. */
export async function loadWinuiExpectedFixture(sourceRoot) {
  const input = await loadInput(sourceRoot);
  return { id: 'winui-measurements', oracleId: 'winui', langVersion: null, inputHash: input.inputHash, input };
}

const fail = where => { throw new Error('Invalid native WinUI measurement: ' + where); };
const text = (value, where) => { if (typeof value !== 'string') fail(where); };
const nonempty = (value, where) => { text(value, where); if (!value) fail(where); };
const boolean = (value, where) => { if (typeof value !== 'boolean') fail(where); };
const number = (value, where) => {
  // Snapshot.Number deliberately encodes non-finite native doubles as strings.
  if (!Number.isFinite(value) && !['NaN', 'Infinity', '-Infinity'].includes(value)) fail(where);
};
function object(value, required, optional, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(where + '.' + key);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) fail(where + '.' + key);
}
function tuple(value, keys, where) {
  object(value, keys, [], where);
  for (const key of keys) number(value[key], where + '.' + key);
}
const thickness = (value, where) => tuple(value, ['left', 'top', 'right', 'bottom'], where);
function property(validate) {
  return (value, where) => {
    object(value, ['value', 'hasLocalValue'], [], where);
    validate(value.value, where + '.value'); boolean(value.hasLocalValue, where + '.hasLocalValue');
  };
}
const common = {
  width: property(number), height: property(number), minWidth: number, maxWidth: number,
  minHeight: number, maxHeight: number, margin: thickness, visibility: nonempty,
  horizontalAlignment: nonempty, verticalAlignment: nonempty, flowDirection: nonempty,
  opacity: number, isHitTestVisible: boolean, actualTheme: nonempty,
};
const control = {
  isEnabled: property(boolean), isTabStop: property(boolean), padding: thickness,
  fontFamily: text, fontSize: number,
  fontWeight: (value, where) => { if (!Number.isInteger(value) || value < 0 || value > 65535) fail(where); },
  horizontalContentAlignment: nonempty, verticalContentAlignment: nonempty,
};
const optional = {
  ...control, text, textAlignment: nonempty, textWrapping: nonempty,
  isChecked: (value, where) => { if (value !== null) boolean(value, where); },
  minimum: number, maximum: number, value: number, borderThickness: thickness,
};
function properties(value, type, where) {
  object(value, Object.keys(common), Object.keys(optional), where);
  for (const [key, item] of Object.entries(value)) (common[key] ?? optional[key])(item, where + '.' + key);
  const require = keys => { for (const key of keys) if (!Object.hasOwn(value, key)) fail(where + '.' + key); };
  // Preserve complete property groups for native subclasses, without guessing their ancestry.
  if (Object.hasOwn(value, 'isEnabled') || Object.hasOwn(value, 'isTabStop')) require(Object.keys(control));
  if (Object.hasOwn(value, 'textAlignment') || Object.hasOwn(value, 'textWrapping')) require(['text', 'fontSize', 'textAlignment', 'textWrapping']);
  if (['minimum', 'maximum', 'value'].some(key => Object.hasOwn(value, key))) require(['minimum', 'maximum', 'value']);
  if (Object.hasOwn(value, 'borderThickness')) require(['padding', 'borderThickness']);
  if (/^Microsoft\.UI\.Xaml\.Controls\.(?:Button|CheckBox|RadioButton|ToggleSwitch|TextBox|ComboBox|ListView|Slider|ProgressBar|ScrollViewer|Control)$/.test(type)) require(Object.keys(control));
  if (/^Microsoft\.UI\.Xaml\.Controls\.(?:CheckBox|RadioButton)$/.test(type)) require(['isChecked']);
  if (/^Microsoft\.UI\.Xaml\.Controls\.(?:Slider|ProgressBar)$/.test(type)) require(['minimum', 'maximum', 'value']);
  if (type === 'Microsoft.UI.Xaml.Controls.TextBlock') require(['text', 'fontSize', 'textAlignment', 'textWrapping']);
  if (type === 'Microsoft.UI.Xaml.Controls.TextBox') require(['text']);
  if (type === 'Microsoft.UI.Xaml.Controls.Border') require(['padding', 'borderThickness']);
}
function visual(root) {
  let count = 0;
  const visit = (node, expectedPath, depth) => {
    if (++count > 2048 || depth > 64) fail('visual tree bound');
    const element = Object.hasOwn(node ?? {}, 'properties');
    object(node, element ? ['path', 'type', 'name', 'layoutSlot', 'desiredSize', 'actualSize', 'properties', 'children'] : ['path', 'type', 'children'], [], expectedPath);
    if (node.path !== expectedPath || (depth === 0 && !element)) fail('visual path or root');
    nonempty(node.type, expectedPath + '.type');
    if (element) {
      text(node.name, expectedPath + '.name');
      tuple(node.layoutSlot, ['x', 'y', 'width', 'height'], expectedPath + '.layoutSlot');
      tuple(node.desiredSize, ['width', 'height'], expectedPath + '.desiredSize');
      tuple(node.actualSize, ['width', 'height'], expectedPath + '.actualSize');
      properties(node.properties, node.type, expectedPath + '.properties');
    }
    if (!Array.isArray(node.children) || node.children.length > 2048) fail('visual children');
    for (const [index, child] of node.children.entries()) visit(child, expectedPath + '/' + index, depth + 1);
  };
  visit(root, '0', 0);
}
function automation(roots) {
  let count = 0;
  const visit = (node, depth) => {
    if (++count > 2048 || depth > 64) fail('automation tree bound');
    object(node, ['type', 'className', 'controlType', 'name', 'automationId', 'isEnabled', 'isContentElement', 'isControlElement', 'children'], [], 'automation');
    nonempty(node.type, 'automation.type'); nonempty(node.controlType, 'automation.controlType');
    for (const key of ['className', 'name', 'automationId']) text(node[key], 'automation.' + key);
    for (const key of ['isEnabled', 'isContentElement', 'isControlElement']) boolean(node[key], 'automation.' + key);
    if (!Array.isArray(node.children) || node.children.length > 2048) fail('automation children');
    for (const child of node.children) visit(child, depth + 1);
  };
  if (!Array.isArray(roots) || roots.length > 2048) fail('automation roots');
  for (const node of roots) visit(node, 0);
}

/** Validate the exact native dump without normalizing DPI, numbers, trees or HRESULTs. */
export function validateWinuiExpectedResult(fixture, result) {
  if (fixture.id !== 'winui-measurements' || fixture.input?.fixtures.length !== 20 || fixture.inputHash !== fixture.input.inputHash) fail('fixture identity');
  validateDump(result, fixture.input);
  object(result, ['schemaVersion', 'inputHash', 'runtime', 'culture', 'theme', 'winuiAssemblyVersion', 'observations'], [], 'dump');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(result.winuiAssemblyVersion)) fail('WinUI assembly version');
  for (const observed of result.observations) {
    if (observed.status === 'load-error') {
      object(observed, ['id', 'status', 'exception', 'hresult'], [], observed.id);
      if (!Number.isInteger(observed.hresult) || observed.hresult < -2147483648 || observed.hresult > 2147483647) fail('native HRESULT');
    } else {
      object(observed, ['id', 'status', 'viewport', 'rasterizationScale', 'layout', 'automation'], [], observed.id);
      object(observed.viewport, ['width', 'height'], [], 'viewport');
      visual(observed.layout); automation(observed.automation);
    }
  }
  return result;
}
