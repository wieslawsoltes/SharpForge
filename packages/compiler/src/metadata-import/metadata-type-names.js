/** CLR metadata generic names formatted for C# diagnostics. */
export const formatMetadataTypeName = name => name.replace(/\+/g, '.')
  .replace(/`(\d+)/g, (_, count) => '<' + ','.repeat(Number(count) - 1) + '>');

/** CS0012 reports the unqualified type name, retaining containing type names for nested types. */
export function unqualifiedMetadataTypeName(metadataName) {
  const outer = metadataName.split('+')[0];
  return formatMetadataTypeName(metadataName.slice(outer.lastIndexOf('.') + 1));
}
