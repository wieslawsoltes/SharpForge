import {normalizeProperty, propertySchema} from './model.js';
import {geometryInvariant} from './geometry-coordinates.js';

export const responsiveSourceMarker = '// SharpForge adaptive states v1: ';

/** Adaptive states select the highest matching minimum width; ranges are inclusive/exclusive. */
export function validateResponsiveDesign(document) {
  const responsive = structuredClone(document.responsive ?? {version: 1, states: []});
  geometryInvariant(responsive.version === 1 && Array.isArray(responsive.states) && responsive.states.length <= 64,
    'SFD_RESPONSIVE_LIMIT', 'Adaptive metadata requires version 1 and at most 64 states.');
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const ids = new Set();
  for (const state of responsive.states) {
    geometryInvariant(typeof state.id === 'string' && /^[A-Za-z_]\w{0,63}$/.test(state.id) && !ids.has(state.id),
      'SFD_RESPONSIVE_ID', 'Adaptive state identifiers must be unique C# identifiers.');
    geometryInvariant(Number.isFinite(state.minWidth) && state.minWidth >= 0 && state.minWidth <= 100000,
      'SFD_RESPONSIVE_WIDTH', 'Adaptive minimum width must be finite and nonnegative.');
    state.maxWidth ??= null;
    geometryInvariant(state.maxWidth === null || Number.isFinite(state.maxWidth) && state.maxWidth > state.minWidth,
      'SFD_RESPONSIVE_RANGE', 'Adaptive maximum width must exceed the minimum.');
    geometryInvariant(state.overrides && typeof state.overrides === 'object' && !Array.isArray(state.overrides),
      'SFD_RESPONSIVE_OVERRIDES', 'Adaptive overrides must be a map of node identifiers to properties.');
    geometryInvariant(Object.keys(state.overrides).length <= 5000, 'SFD_RESPONSIVE_OVERRIDES', 'Too many adaptive override targets.');
    for (const [id, properties] of Object.entries(state.overrides)) {
      geometryInvariant(nodes.has(id), 'SFD_RESPONSIVE_NODE', `Adaptive target '${id}' does not exist.`);
      geometryInvariant(properties && typeof properties === 'object' && !Array.isArray(properties),
        'SFD_RESPONSIVE_PROPERTIES', 'Adaptive properties must be an object.');
      for (const [name, value] of Object.entries(properties)) {
        geometryInvariant(name !== 'Name', 'SFD_RESPONSIVE_IDENTITY', 'A visual state cannot change a control identity.');
        properties[name] = normalizeProperty(nodes.get(id).type, name, value);
      }
    }
    ids.add(state.id);
  }
  responsive.states.sort((left, right) => left.minWidth - right.minWidth || left.id.localeCompare(right.id, 'en'));
  return responsive;
}

export function selectedResponsiveState(document, width, stateId = null) {
  geometryInvariant(Number.isFinite(width) && width >= 0, 'SFD_RESPONSIVE_WIDTH', 'Preview width must be finite and nonnegative.');
  const states = validateResponsiveDesign(document).states;
  if (stateId !== null) {
    const state = states.find(item => item.id === stateId);
    geometryInvariant(state, 'SFD_RESPONSIVE_STATE', 'Unknown adaptive state.');
    return state;
  }
  return states.findLast(state => width >= state.minWidth && (state.maxWidth === null || width < state.maxWidth)) ?? null;
}

/** Returns an independent preview document; the authoring document and its history are untouched. */
export function applyResponsivePreview(document, width, stateId = null) {
  const state = selectedResponsiveState(document, width, stateId);
  const preview = structuredClone(document);
  if (state) {
    const nodes = new Map(preview.nodes.map(node => [node.id, node]));
    for (const [id, properties] of Object.entries(state.overrides)) Object.assign(nodes.get(id).properties, properties);
  }
  return preview;
}

export function setResponsiveState(document, state) {
  return document.change('Edit adaptive state', candidate => {
    const responsive = validateResponsiveDesign(candidate);
    const index = responsive.states.findIndex(item => item.id === state.id);
    if (index < 0) responsive.states.push(structuredClone(state));
    else responsive.states[index] = structuredClone(state);
    candidate.responsive = responsive;
    candidate.responsive = validateResponsiveDesign(candidate);
  });
}

export function removeResponsiveState(document, id) {
  return document.change('Remove adaptive state', candidate => {
    const responsive = validateResponsiveDesign(candidate);
    responsive.states = responsive.states.filter(state => state.id !== id);
    candidate.responsive = responsive;
  });
}

function propertyStatement(node, name, value, options) {
  const schema = propertySchema(node.type)[name];
  const variable = options.symbol(node.id);
  const owner = schema.owner ?? node.type;
  const member = schema.member ?? name;
  if (value === undefined) return `${variable}.ClearValue(${owner}.${member}Property);`;
  const expression = options.csharpValue(value, schema.type);
  return schema.attached ? `${owner}.Set${member}(${variable}, ${expression});` : `${variable}.${name} = ${expression};`;
}

/** Emits real managed state changes. Optional parameters let owned source helpers address construction-local controls. */
export function generateResponsiveMethods(document, options) {
  const responsive = validateResponsiveDesign(document);
  if (!responsive.states.length) return {methods: [], initialize: [], diagnostics: []};
  geometryInvariant(typeof options.symbol === 'function' && typeof options.csharpValue === 'function',
    'SFD_RESPONSIVE_GENERATOR', 'Adaptive generation requires symbol and literal emitters.');
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const reset = new Map();
  for (const state of responsive.states) {
    for (const [id, properties] of Object.entries(state.overrides)) {
      if (!reset.has(id)) reset.set(id, new Set());
      for (const name of Object.keys(properties)) reset.get(id).add(name);
    }
  }
  const methodName = options.methodName ?? 'ApplyAdaptive';
  const widthName = options.widthName ?? 'width';
  const parameters = options.parameters ?? [];
  const signature = parameters.map(parameter => `, ${parameter.type} ${parameter.name}`).join('');
  const argumentsText = parameters.map(parameter => ', ' + parameter.argument).join('');
  const ordered = [...responsive.states].reverse();
  const methods = ['    // The application host calls this when the available viewport width changes.',
    `    public static void ${methodName}(double ${widthName}${signature})`, '    {',
    '        ' + responsiveSourceMarker + JSON.stringify(ordered.map(state => state.id))];
  for (const [id, properties] of reset) {
    const node = nodes.get(id);
    for (const name of properties) methods.push(`        ${propertyStatement(node, name, node.properties[name], options)}`);
  }
  for (const state of ordered) {
    const lower = options.csharpValue(state.minWidth, 'double');
    const upper = state.maxWidth === null ? '' : ` && ${widthName} < ${options.csharpValue(state.maxWidth, 'double')}`;
    methods.push(`        if (${widthName} >= ${lower}${upper})`, '        {');
    for (const [id, properties] of Object.entries(state.overrides)) {
      for (const [name, value] of Object.entries(properties)) methods.push(`            ${propertyStatement(nodes.get(id), name, value, options)}`);
    }
    methods.push('            return;', '        }');
  }
  methods.push('    }');
  const width = Number.isInteger(document.width) ? `${document.width}.0` : document.width;
  return {methods, initialize: [`        ${methodName}(${width}${argumentsText});`],
    diagnostics: [{code: 'SFD_RESPONSIVE_HOST_RESIZE', severity: 'info', span: {start: 0, length: 0},
      message: `Call ${methodName}(width) from the application viewport resize callback. Automatic native SizeChanged triggers are unavailable.`}]};
}
