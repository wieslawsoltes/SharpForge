const contentProperties = new Set([
  'Child', 'Content', 'Header', 'Footer', 'Pane', 'Pane1', 'Pane2', 'PaneHeader', 'PaneFooter', 'PaneCustomContent',
  'TitleBar', 'LeftHeader', 'TopHeader', 'TopLeftHeader', 'OverlayContent', 'NavigationViewItemPresenter'
]);
const contentCollections = new Set([
  'Children', 'Items', 'MenuItems', 'FooterMenuItems', 'TabItems', 'PrimaryCommands', 'SecondaryCommands'
]);

/** DataContext, selection and placement references retain objects without making them visual children. */
export function isVisualContentProperty(name, collection = false) {
  return (collection ? contentCollections : contentProperties).has(name);
}
