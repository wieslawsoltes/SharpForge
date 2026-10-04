import { LayoutEngine, createLayoutRegistry, size } from '../../packages/winui-controls/src/layout/index.js';

export function layoutFixture(records, { width = 300, height = 200, root = 'root', ...options } = {}) {
  const nodes = new Map(records.map(node => [node.id, { properties: {}, collections: {}, ...node }]));
  const engine = new LayoutEngine({ registry: createLayoutRegistry(), measureProvider: {
    measure: node => size(node.properties.IntrinsicWidth ?? 0, node.properties.IntrinsicHeight ?? 0)
  }, ...options });
  engine.synchronize(nodes, [root]);
  const viewport = size(width, height);
  return { nodes, engine, viewport, update: () => engine.updateLayout(viewport), state: id => engine.states.get(id) };
}

export function element(id, properties = {}, type = 'Control') { return { id, type, properties, collections: {} }; }
export function panel(id, type, children, properties = {}) {
  return { id, type, properties, collections: { Children: children.map($ref => ({ $ref })) } };
}
