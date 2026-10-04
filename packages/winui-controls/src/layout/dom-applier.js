import { thickness } from './geometry.js';
import { identityMatrix, multiplyMatrix, renderTransform, transformBounds, elementClip } from './render-properties.js';

/** Publish the same affine geometry to DOM, compositor and hit testing. */
export function computeWorldLayout(engine, { resolveNode = id => engine.states.get(id)?.node, composition = null,
  transformResolver = null, rootTransform = () => null } = {}) {
  const result = new Map();
  const resolve = resolveNode;
  const visit = (id, parentMatrix, ancestorClips) => {
    const state = engine.states.get(id);
    const node = resolve(id) ?? state.node;
    const properties = node.properties ?? {};
    const position = composition?.position(state) ?? state.rect;
    let local = multiplyMatrix([1, 0, 0, 1, position.x, position.y], renderTransform(properties, state.renderSize, resolve, transformResolver));
    if (composition) local = multiplyMatrix(local, composition.matrix(id));
    const worldTransform = multiplyMatrix(parentMatrix, local);
    const localClip = elementClip(properties, resolve) ?? state.data.clip ?? null;
    const clips = localClip ? [...ancestorClips, { rect: localClip, transform: worldTransform }] : ancestorClips;
    const entry = {
      id, parentId: state.parent, rect: { ...state.rect }, slot: { ...state.slot },
      renderSize: { ...state.renderSize }, desiredSize: { ...state.desiredSize },
      bounds: transformBounds(worldTransform, { x: 0, y: 0, ...state.renderSize }),
      worldTransform, localTransform: local, clip: localClip, clips, version: state.version,
      children: [...state.children], node,
      participatesInLayout: !state.data.layoutSuppressed && properties.Visibility !== 1 && properties.Visibility !== 'Collapsed',
      isScrollPort: !!state.data.scroll && !!state.data.clip && !state.data.scrollPresenter,
      scrollPortClip: state.data.scroll && state.data.clip && !state.data.scrollPresenter ? {...state.data.clip} : null,
      scroll: state.data.scroll ? { ...state.data.scroll, extent: { ...state.data.scroll.extent }, viewport: { ...state.data.scroll.viewport },
        currentAnchor: state.data.currentAnchor ?? null } : null
    };
    result.set(id, entry);
    const childMatrix = multiplyMatrix(worldTransform, state.data.childTransform ?? identityMatrix);
    for (const child of state.children) visit(child, childMatrix, clips);
  };
  for (const id of engine.roots) visit(id, rootTransform(id) ?? identityMatrix, []);
  return result;
}

/** CSS is a geometry sink. ActualWidth/Height are returned from managed render sizes. */
export function applyLayoutToDom(engine, elements, world = computeWorldLayout(engine)) {
  const changes = [];
  for (const [id, entry] of world) {
    const element = elements.get(id);
    if (!element) continue;
    const state = engine.states.get(id);
    const parent = engine.states.get(state.parent);
    const border = thickness(parent?.node.properties?.BorderThickness);
    const transform = multiplyMatrix(parent?.data.childTransform ?? identityMatrix, entry.localTransform);
    transform[4] -= border.left;
    transform[5] -= border.top;
    const style = element.style;
    style.position = 'absolute';
    style.left = '0px';
    style.top = '0px';
    style.margin = '0px';
    style.minWidth = '0px';
    style.minHeight = '0px';
    style.maxWidth = 'none';
    style.maxHeight = 'none';
    style.width = entry.renderSize.width + 'px';
    style.height = entry.renderSize.height + 'px';
    style.transformOrigin = '0 0';
    style.transform = `matrix(${transform.join(',')})`;
    if (entry.clip) {
      const clip = entry.clip;
      style.clipPath = `inset(${clip.y}px ${entry.renderSize.width - clip.x - clip.width}px `
        + `${entry.renderSize.height - clip.y - clip.height}px ${clip.x}px)`;
    } else style.clipPath = '';
    style.overflow = entry.clip ? 'hidden' : '';
    if (state.node.type.endsWith('.Canvas')) style.overflow = entry.clip ? 'hidden' : 'visible';
    const previous = state.data.domSize;
    if (!previous || previous.width !== entry.renderSize.width || previous.height !== entry.renderSize.height) {
      state.data.domSize = { ...entry.renderSize };
      changes.push({ id, width: entry.renderSize.width, height: entry.renderSize.height });
    }
  }
  return changes;
}
