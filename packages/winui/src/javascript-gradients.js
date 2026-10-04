import {createGradientStopCollection, createMutableGradientValue} from './javascript-gradient-collection.js';
import {
  linearGradientType, gradientStopType, gradientCollectionType, pointType, gradientColor, gradientPoint,
  gradientNumber, gradientFailure, normalizeLinearGradientBrush
} from './gradient-data.js';

const transparent = () => Object.freeze({valueType: 'Windows.UI.Color', A: 0, R: 0, G: 0, B: 0});

/** Session-owned mutable values publish detached paint records; no host node or global observer is retained. */
export function createJavaScriptGradients({objects, send, alive}) {
  const owned = new WeakSet();
  const check = value => {
    if (!owned.has(value)) throw gradientFailure('A value from this application is required.');
    return value;
  };
  const exportBrush = brush => normalizeLinearGradientBrush({
    valueType: linearGradientType, StartPoint: brush.StartPoint, EndPoint: brush.EndPoint,
    Opacity: brush.Opacity, GradientStops: [...brush.GradientStops].map(stop => ({Color: stop.Color, Offset: stop.Offset}))
  });
  function refresh(changed) {
    const collections = new Map();
    const brushes = new Map();
    for (const object of objects.values()) {
      for (const [property, brush] of Object.entries(object.$values)) {
        if (brush?.valueType !== linearGradientType) continue;
        if (!brushes.has(brush)) {
          const stops = brush.GradientStops;
          if (!collections.has(stops)) collections.set(stops, stops === changed || [...stops].includes(changed));
          brushes.set(brush, brush === changed || collections.get(stops) ? exportBrush(brush) : null);
        }
        const value = brushes.get(brush);
        if (value) send({op: 'set', id: object.$node.id, property, value});
      }
    }
  }
  const context = {owned, alive, refresh};
  const mutable = (type, initial, validators) => createMutableGradientValue(type, initial, validators, context);
  const collection = () => createGradientStopCollection(context);
  const point = value => {
    if (value?.valueType !== pointType) throw gradientFailure('Windows.Foundation.Point is required.');
    return Object.freeze({valueType: pointType, ...gradientPoint(value)});
  };
  const factories = new Map([
    [pointType, args => {
      if (args.length !== 2 || args.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        throw gradientFailure('Point requires two finite coordinates.');
      }
      return Object.freeze({valueType: pointType, X: args[0], Y: args[1]});
    }],
    [gradientStopType, () => mutable(gradientStopType, {Color: transparent(), Offset: 0}, {
      Color: value => Object.freeze(gradientColor(value)), Offset: value => gradientNumber(value, 0, 1, 'Offset')
    })],
    [gradientCollectionType, collection],
    [linearGradientType, () => mutable(linearGradientType, {
      StartPoint: Object.freeze({valueType: pointType, X: 0, Y: 0}),
      EndPoint: Object.freeze({valueType: pointType, X: 1, Y: 1}), Opacity: 1, GradientStops: collection()
    }, {
      StartPoint: point, EndPoint: point,
      Opacity: value => gradientNumber(value, 0, 1, 'Opacity'),
      GradientStops: value => {
        check(value);
        if (value.valueType !== gradientCollectionType) throw gradientFailure('GradientStopCollection is required.');
        return value;
      }
    })]
  ]);
  return {
    supports: type => factories.has(type),
    construct(type, args) {
      alive();
      if (type !== pointType && args.length) throw gradientFailure('The registered constructor is parameterless.');
      return factories.get(type)(args);
    },
    export(value) { return value?.valueType === linearGradientType ? exportBrush(check(value)) : value; }
  };
}
