import { LayoutEngine, createLayoutRegistry, size, RealizationWindow, RoutedEventRouter } from '../src/index.js';

const nodes = new Map([
  ['root', { id: 'root', type: 'StackPanel', properties: { Spacing: 8 },
    collections: { Children: [{ $ref: 'first' }, { $ref: 'second' }] } }],
  ['first', { id: 'first', type: 'Button', properties: { Width: 120, Height: 32, HorizontalAlignment: 1 }, collections: {} }],
  ['second', { id: 'second', type: 'Button', properties: { Width: 80, Height: 24, HorizontalAlignment: 2 }, collections: {} }]
]);
const engine = new LayoutEngine({ registry: createLayoutRegistry(), measureProvider: { measure: () => size() } });
engine.synchronize(nodes, ['root']);
engine.updateLayout(size(300, 200));
console.log(JSON.stringify(engine.snapshot(), null, 2));

const million = new RealizationWindow({ count: 1000000, estimatedSize: 32 });
console.log('Realized window', million.update(10000000, 600));
const router = new RoutedEventRouter({ parentOf: id => engine.states.get(id)?.parent });
router.addHandler('root', 'PointerPressed', (sender, args) => console.log(sender, args.OriginalSource));
router.raise('first', 'PointerPressed', { Pointer: { PointerId: 1 } });
router.dispose();
engine.dispose();
