import { LayoutError } from './geometry.js';

/** Managed bridges must complete the callback within the layout transaction. Reentry is rejected. */
export function customLayout({ measureOverride, arrangeOverride, onDispose = () => {} }) {
  let active = false;
  let disposed = false;
  const invoke = (callback, context, value) => {
    if (disposed) throw new LayoutError('SFUI1650', 'Custom panel has been disposed', context.id);
    if (active) throw new LayoutError('SFUI1651', 'Custom panel layout callback reentry', context.id);
    active = true;
    try {
      const result = callback(context, value);
      if (result?.then) throw new LayoutError('SFUI1652', 'Asynchronous layout overrides require a synchronous managed bridge', context.id);
      return result;
    } finally { active = false; }
  };
  return {
    measure: (context, available) => invoke(measureOverride, context, available),
    arrange: (context, finalSize) => invoke(arrangeOverride, context, finalSize),
    dispose() { if (!disposed) { disposed = true; onDispose(); } }
  };
}
