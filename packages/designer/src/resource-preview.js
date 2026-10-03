import {MEDIA} from '@sharpforge/framework';
import {normalizeDesignerBrush} from './property-values.js';
import {applyDesignerSampleData} from './design-data.js';

function colorCss(color) { return `rgba(${color.R}, ${color.G}, ${color.B}, ${color.A / 255})`; }

/** All CSS tokens originate from validated numeric colors/points, never user supplied CSS. */
export function designerBrushCss(input) {
  const brush = normalizeDesignerBrush(input);
  if (brush.valueType === MEDIA + 'SolidColorBrush') {
    const color = {...brush.Color, A: brush.Color.A * (brush.Opacity ?? 1)};
    return colorCss(color);
  }
  const dx = brush.EndPoint.X - brush.StartPoint.X;
  const dy = brush.EndPoint.Y - brush.StartPoint.Y;
  const angle = 90 + Math.atan2(dy, dx) * 180 / Math.PI;
  const stops = brush.GradientStops.map(stop => colorCss({...stop.Color, A: stop.Color.A * brush.Opacity}) + ` ${stop.Offset * 100}%`);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

function addCollectionItems(scene, owner, property, items) {
  owner.collections[property] = items.map((item, index) => {
    if (item === null || typeof item !== 'object') return item;
    const id = `${owner.id}::collection:${property}:${index}`;
    scene.nodes.push({id, type: item.type, properties: structuredClone(item.properties), events: [], collections: {}, designId: owner.id});
    return {$ref: id};
  });
}

/** Low-level preview seam: no model imports, expression evaluation, live state changes, or network access. */
export function projectDesignerAuthoringScene(design, input, {theme = 'default', samples = true, resolveAsset} = {}) {
  let scene = structuredClone(input);
  const nodes = new Map(scene.nodes.map(node => [node.id, node]));
  for (const node of design.nodes) {
    const preview = nodes.get(node.id);
    if (!preview) continue;
    for (const [property, reference] of Object.entries(node.resourceReferences ?? {})) {
      const resource = design.resources?.[reference.key];
      if (!resource) continue;
      const value = resource.kind === 'theme' ? resource.variants[theme] ?? resource.variants.default : resource.value;
      preview.properties[property] = structuredClone(value);
    }
    for (const [property, items] of Object.entries(node.collections ?? {})) addCollectionItems(scene, preview, property, items);
    if (node.template) {
      const visit = part => {
        const instance = nodes.get(node.id + '::' + part.id);
        for (const [property, reference] of Object.entries(part.resourceReferences ?? {})) {
          const resource = design.resources?.[reference.key];
          if (!instance || !resource) continue;
          instance.properties[property] = structuredClone(resource.kind === 'theme' ?
            resource.variants[theme] ?? resource.variants.default : resource.value);
        }
        (part.children ?? []).forEach(visit);
      };
      visit(design.templates[node.template].root);
    }
  }
  scene = applyDesignerSampleData(scene, design, {enabled: samples});
  for (const node of scene.nodes.slice()) {
    const samples = node.collections.Items;
    if (samples?.some(item => item && typeof item === 'object' && item.type)) addCollectionItems(scene, node, 'Items', samples);
  }
  refreshDesignerTemplateBindings(scene);
  if (resolveAsset) {
    for (const node of scene.nodes) {
      if (node.properties.Source) node.properties.Source = resolveAsset(node.properties.Source) ?? node.properties.Source;
    }
  }
  return scene;
}

/** Refresh already instantiated template parts after a resource, sample or state changes an owner value. */
export function refreshDesignerTemplateBindings(scene, exclusions = new Set()) {
  const nodes = new Map(scene.nodes.map(node => [node.id, node]));
  for (const node of scene.nodes) {
    const owner = nodes.get(node.templateOwner);
    if (!owner) continue;
    for (const [property, source] of Object.entries(node.templateBindings ?? {})) {
      if (!exclusions.has(node.id + ':' + property)) node.properties[property] = structuredClone(owner.properties[source] ?? null);
    }
  }
  return scene;
}

/** Rendering adapters can apply these typed decorations after retained-control layout. */
export function designerPreviewDecorations(scene) {
  const result = [];
  for (const node of scene.nodes) {
    for (const [name, cssProperty] of [['Background', 'background'], ['Fill', 'background']]) {
      const brush = node.properties[name];
      if (brush?.valueType === MEDIA + 'LinearGradientBrush') result.push({id: node.id, property: cssProperty, value: designerBrushCss(brush)});
    }
  }
  return result;
}
