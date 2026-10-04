import {registerDesignerViewport} from './designer-viewport.js';
import {registerDesignerGradients} from './designer-gradients.js';

/** These identifiers extend the ABI in A18's reserved block; released setter/getter IDs stay fixed. */
export function registerDesignerLayout(registry) {
  const {prop, CONTROLS, XAML} = registry;
  const owners = [
    ['Canvas', ['Left', 'Top', 'ZIndex']],
    ['Grid', ['Row', 'Column', 'RowSpan', 'ColumnSpan']],
    ['VariableSizedWrapGrid', ['RowSpan', 'ColumnSpan']]
  ];
  for (const [owner, members] of owners) {
    for (const member of members) prop(CONTROLS + owner, member + 'Property', XAML + 'DependencyProperty', null, true, true);
  }
  registerDesignerViewport(registry);
  registerDesignerGradients(registry);
}
