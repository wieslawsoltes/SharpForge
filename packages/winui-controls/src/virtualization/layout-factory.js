import { ItemsStackPanel } from './items-stack-panel.js';
import { ItemsWrapGrid } from './items-wrap-grid.js';
import { LinedFlowLayout } from './lined-flow-layout.js';
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

/** Shared scene-to-layout adapter for ItemsRepeater and control-family item presenters. */
export function createItemsLayout(source, descriptor, { fallbackType = 'StackLayout', aspectRatioAt = () => 1 } = {}) {
  const properties = descriptor?.properties ?? descriptor ?? {};
  const type = descriptor?.type?.split('.').at(-1) ?? fallbackType;
  if (type === 'UniformGridLayout' || type === 'ItemsWrapGrid') return new ItemsWrapGrid({ source,
    itemWidth: positive(properties.MinItemWidth ?? properties.ItemWidth, 100),
    itemHeight: positive(properties.MinItemHeight ?? properties.ItemHeight, 32),
    minimumColumnSpacing: properties.MinColumnSpacing ?? 0, minimumRowSpacing: properties.MinRowSpacing ?? 0 });
  if (type === 'LinedFlowLayout') return new LinedFlowLayout({ source, lineHeight: positive(properties.LineHeight, 160),
    minimumItemSpacing: properties.MinItemSpacing ?? 4, lineSpacing: properties.LineSpacing ?? 4, aspectRatioAt });
  if (!['StackLayout', 'ItemsRepeater', 'ItemsStackPanel', 'VirtualizingStackPanel'].includes(type)) {
    throw new TypeError('SFUI1608: Unsupported item layout: ' + type);
  }
  return new ItemsStackPanel({ source, estimatedSize: positive(properties.ItemHeight, 32), spacing: properties.Spacing ?? 0,
    orientation: properties.Orientation === 1 || properties.Orientation === 'Horizontal' ? 'Horizontal' : 'Vertical' });
}
