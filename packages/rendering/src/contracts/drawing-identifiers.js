/**
 * Complete writable dependency-property identifiers after all A17 contracts have been registered.
 * Calling this at the end of the reserved contribution preserves the IDs of existing drawing and composition members.
 */
export function registerDrawingPropertyIdentifiers(registry) {
  const dependencyObject = registry.XAML + 'DependencyObject';
  const dependencyProperty = registry.XAML + 'DependencyProperty';
  for (const type of registry.types.values()) {
    if (!registry.frameworkAssignable(dependencyObject, type.name)) continue;
    const declared = Object.entries(type.properties);
    for (const [name, property] of declared) {
      if (property.isStatic || property.readOnly || type.properties[name + 'Property']) continue;
      registry.prop(type.name, name + 'Property', dependencyProperty, null, true, true);
    }
  }
}
