import {beginPublicHost} from './public-host.js';
import {canvasReferencePacket, referenceCanvas} from '../references/canvas-primitives.js';

const rectangles = [
  {id: 'back', type: 'Rectangle', x: 16, y: 16, width: 96, height: 64, color: '#2040e0', z: 0},
  {id: 'native', type: 'TextBox', x: 48, y: 32, width: 96, height: 64, color: '#e03020', z: 1},
  {id: 'front', type: 'Rectangle', x: 80, y: 48, width: 96, height: 64, color: '#20c040', z: 2}
];

function reference(document, definition) {
  const {canvas, painter} = referenceCanvas(document, definition);
  try {
    for (const item of rectangles) {
      painter.fillStyle = item.color;
      painter.fillRect(item.x, item.y, item.width, item.height);
    }
    return canvasReferencePacket(canvas);
  } finally { canvas.width = canvas.height = 0; }
}

/** The native overlay uses the public renderer registration seam to make Z-order pixels independent of OS input chrome. */
export async function createMixedOrderFixture(definition, options) {
  const session = beginPublicHost(definition, options, {raw: true});
  try {
    const {host} = session;
    host.registry.register('TextBox', {
      create: context => context.document.createElement('input'),
      render(context, node, element) {
        element.type = 'text';
        element.value = '';
        element.setAttribute('aria-label', 'Native overlay in mixed rendering order');
        Object.assign(element.style, {appearance: 'none', padding: '0', margin: '0', border: '0', borderRadius: '0'});
      }
    }, {override: true});
    const nodes = [
      {id: 'window', type: 'Microsoft.UI.Xaml.Window', properties: {Content: {$ref: 'panel'}}, collections: {}, events: []},
      {id: 'panel', type: 'Microsoft.UI.Xaml.Controls.Canvas', properties: {Width: definition.width, Height: definition.height},
        collections: {Children: [{$ref: 'native'}, {$ref: 'front'}, {$ref: 'back'}]}, events: []},
      ...rectangles.map(item => ({id: item.id,
        type: 'Microsoft.UI.Xaml.' + (item.type === 'Rectangle' ? 'Shapes.' : 'Controls.') + item.type,
        properties: {Name: item.id, Width: item.width, Height: item.height, Left: item.x, Top: item.y,
          ZIndex: item.z, Fill: item.color, Background: item.color}, collections: {}, events: []}))
    ];
    host.load({windows: ['window'], nodes});
    await session.settle();
    return {...session, reference: () => reference(options.document, definition),
      verify() {
        const native = host.elements.get('native');
        const record = [...session.measured.values()].find(value => value.id === 'native' && value.backend === 'dom');
        if (native?.tagName !== 'INPUT' || record?.backend !== 'dom') throw new Error('Native DOM overlay fallback was not observed');
        for (const id of ['back', 'front']) {
          const entry = host.sceneRenderer.entries.get(id);
          if (entry?.surface?.backend !== options.backend) throw new Error('Requested shape backend did not coexist with native input');
        }
        const origin = session.mount.getBoundingClientRect();
        const hits = [[64, 48, 'native'], [96, 64, 'front'], [24, 24, 'back']].map(([x, y, expected]) => {
          const hit = options.document.elementFromPoint(origin.x + x, origin.y + y)?.closest('[data-sf-id]');
          if (hit?.dataset.sfId !== expected) throw new Error('Mixed DOM/GPU hit order differs from declared ZIndex: ' + expected);
          return {x, y, expected, actual: hit.dataset.sfId};
        });
        return {passed: true, nativeOverlay: record.reason, shapeBackend: options.backend,
          declaredZOrder: rectangles.map(value => value.id), insertionOrder: ['native', 'front', 'back'], hits};
      }};
  } catch (error) {
    session.dispose();
    throw error;
  }
}
