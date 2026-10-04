const structNames = new Set([
  'Microsoft.UI.Xaml.Thickness', 'Microsoft.UI.Xaml.CornerRadius', 'Microsoft.UI.Xaml.GridLength',
  'Windows.UI.Color', 'Windows.Foundation.Point', 'Windows.Foundation.Size', 'Windows.Foundation.Rect',
  'System.TimeSpan', 'System.DateTime', 'System.DateTimeOffset', 'Microsoft.UI.Xaml.Duration', 'Microsoft.UI.Xaml.Media.Animation.RepeatBehavior',
  'Microsoft.UI.Xaml.Media.Animation.KeyTime', 'Windows.UI.Text.FontWeight', 'System.Numerics.Vector2',
  'System.Numerics.Vector3', 'System.Numerics.Vector4', 'System.Numerics.Matrix3x2', 'System.Numerics.Matrix4x4'
]);

/** CLR-style scalar/struct equality; reference objects and brushes retain identity semantics. */
export function propertyValuesEqual(left, right, {typeDefinition, maxFields = 256, maxDepth = 16} = {}) {
  let remaining = maxFields;
  function equal(first, second, depth) {
    if (first === second || typeof first === 'number' && typeof second === 'number' && Number.isNaN(first) && Number.isNaN(second)) {
      return true;
    }
    if (!first || !second || typeof first !== 'object' || typeof second !== 'object' || depth > maxDepth) return false;
    if (Number.isSafeInteger(first.h) && Number.isSafeInteger(first.g)) return first.h === second.h && first.g === second.g;
    const type = first.valueType;
    if (!type || second.valueType !== type || !(structNames.has(type) || typeDefinition?.(type)?.kind === 'value')) return false;
    const fields = Object.keys(first);
    if (fields.length !== Object.keys(second).length || fields.length > remaining) return false;
    remaining -= fields.length;
    for (const field of fields) {
      if (!Object.hasOwn(second, field) || !equal(first[field], second[field], depth + 1)) return false;
    }
    return true;
  }
  return equal(left, right, 0);
}
