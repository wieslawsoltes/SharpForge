/** These identifiers extend the ABI in A18's reserved block; released setter/getter IDs stay fixed. */
export function registerDesignerLayout({prop, CONTROLS, XAML}) {
  const owners = [
    ['Canvas', ['Left', 'Top', 'ZIndex']],
    ['Grid', ['Row', 'Column', 'RowSpan', 'ColumnSpan']],
    ['VariableSizedWrapGrid', ['RowSpan', 'ColumnSpan']]
  ];
  for (const [owner, members] of owners) {
    for (const member of members) prop(CONTROLS + owner, member + 'Property', XAML + 'DependencyProperty', null, true, true);
  }
}
