/** Metadata/resource references invalidate their consumer without becoming visual ownership edges. */
export function defaultLayoutDependencies(node) {
  const result = [];
  for (const collection of ['RowDefinitions', 'ColumnDefinitions', 'HorizontalSnapPoints', 'VerticalSnapPoints', 'ZoomSnapPoints', 'Labels']) {
    for (const value of node.collections?.[collection] ?? []) if (value?.$ref) result.push(value.$ref);
  }
  for (const name of ['Source', 'HorizontalScrollController', 'VerticalScrollController', 'Labels']) {
    if (node.properties?.[name]?.$ref) result.push(node.properties[name].$ref);
  }
  return result;
}

export function scrollGeometryChanged(previous, next) {
  if (previous === next) return false;
  if (!previous || !next) return true;
  return previous.horizontalOffset !== next.horizontalOffset || previous.verticalOffset !== next.verticalOffset
    || previous.zoomFactor !== next.zoomFactor || previous.extent.width !== next.extent.width
    || previous.extent.height !== next.extent.height || previous.viewport.width !== next.viewport.width
    || previous.viewport.height !== next.viewport.height;
}
