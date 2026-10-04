/** VM snapshots remain scoped to their application; native model identity is retained. */
export function copyCompositionData(value, memo = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (value.Compositor || value.kind === 'Compositor' || value.owner?.Compositor
    || value.kind === 'Microsoft.UI.Xaml.Media.LoadedImageSurface') return value;
  if (memo.has(value)) return memo.get(value);
  if (ArrayBuffer.isView(value)) return value.slice();
  if (value instanceof Map) {
    const result = new Map();
    memo.set(value, result);
    for (const [key, item] of value) result.set(key, copyCompositionData(item, memo));
    return result;
  }
  const result = Array.isArray(value) ? [] : {};
  memo.set(value, result);
  for (const [name, item] of Object.entries(value)) result[name] = copyCompositionData(item, memo);
  return result;
}

export function snapshotCompositionObject(object) {
  return {
    baseValues: copyCompositionData(object.baseValues), animatedValues: copyCompositionData(object.animatedValues),
    implicit: object.ImplicitAnimations, properties: object.Properties.snapshot(),
    children: object.Children ? [...object.Children] : null, shapes: object.Shapes ? [...object.Shapes] : null,
    stops: object.ColorStops ? [...object.ColorStops] : null, dashArray: object.StrokeDashArray ? [...object.StrokeDashArray] : null,
    version: object.version, contentVersion: object.contentVersion
  };
}

export function restoreCompositionObject(object, snapshot) {
  object.closed = false;
  object.baseValues = copyCompositionData(snapshot.baseValues);
  object.animatedValues = copyCompositionData(snapshot.animatedValues);
  object.ImplicitAnimations = snapshot.implicit;
  object.Properties.restore(snapshot.properties);
  if (snapshot.children) {
    object.Children.items = [...snapshot.children];
    for (const child of object.Children) child.parent = object;
  }
  if (snapshot.shapes) object.Shapes.items = [...snapshot.shapes];
  if (snapshot.stops) object.ColorStops.items = [...snapshot.stops];
  if (snapshot.dashArray) object.StrokeDashArray.restoreValues(snapshot.dashArray);
  object.version = snapshot.version;
  if (snapshot.contentVersion !== undefined) {
    object.contentVersion = snapshot.contentVersion;
    object.encodedVersion = 0;
    object.matrixVersion = 0;
    object.content = null;
  }
}
