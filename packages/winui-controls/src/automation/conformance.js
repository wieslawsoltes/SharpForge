const namedRoles = new Set(['button', 'checkbox', 'combobox', 'dialog', 'link', 'listbox', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'radio', 'scrollbar', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'tree', 'treeitem']);
const supportedRoles = new Set(['alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox', 'columnheader',
  'combobox', 'complementary', 'contentinfo', 'definition', 'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'generic', 'grid',
  'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'paragraph', 'presentation', 'progressbar',
  'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
  'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem']);

/** Dependency-free structural rules; browser tests additionally inspect the actual accessibility tree and keyboard behavior. */
export function auditAutomationSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.roots)) throw new TypeError('SFAX016: Invalid automation snapshot');
  const violations = [];
  const ids = new Set();
  const pending = [...snapshot.roots];
  let count = 0;
  const add = (rule, node, message) => violations.push({ rule, impact: 'critical', id: node.id, message });
  while (pending.length) {
    if (++count > 20000) throw new RangeError('SFAX016: Accessibility audit node limit');
    const node = pending.pop();
    if (ids.has(node.id)) add('duplicate-id', node, 'Automation element identity is duplicated');
    ids.add(node.id);
    if (node.role && !supportedRoles.has(node.role)) add('aria-role', node, 'Unknown ARIA role: ' + node.role);
    if (!node.offscreen && namedRoles.has(node.role) && !node.name?.trim()) add('accessible-name', node, 'Interactive control requires an accessible name');
    if (node.focused && (!node.enabled || !node.focusable)) add('focus-state', node, 'Focused control is disabled or not keyboard focusable');
    if (node.password && node.patterns.some(pattern => ['Text', 'Value'].includes(pattern))) add('protected-value', node, 'Password exposes a text/value provider');
    if (![node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height].every(Number.isFinite)
      || node.bounds.width < 0 || node.bounds.height < 0) add('bounds', node, 'Accessible bounds must be finite and nonnegative in size');
    pending.push(...node.children);
  }
  return { version: 1, engine: 'sharpforge-structural-a11y', nodes: count, violations };
}

/** Inspect actual DOM relationships and state ranges without pretending to be axe-core or an assistive technology. */
export function auditAriaDom(root) {
  const violations = [];
  const elements = [root, ...root.querySelectorAll('[role], [aria-labelledby], [aria-describedby], [aria-valuenow], [aria-hidden]')];
  const ids = new Map();
  const add = (rule, element, message) => violations.push({ rule, impact: 'critical',
    id: element.id || element.dataset.sfId || element.dataset.sfProxyId || '', message });
  for (const element of [root, ...root.querySelectorAll('[id]')]) if (element.id) {
    if (ids.has(element.id)) add('duplicate-id', element, 'DOM id is duplicated');
    ids.set(element.id, element);
  }
  for (const element of elements) {
    const role = element.getAttribute('role');
    if (role && !supportedRoles.has(role)) add('aria-role', element, 'Unknown ARIA role: ' + role);
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      const value = element.getAttribute(attribute);
      for (const id of value?.split(/\s+/).filter(Boolean) ?? []) {
        if (!root.ownerDocument.getElementById(id)) add('aria-reference', element, attribute + ' target does not exist: ' + id);
      }
    }
    if (element.hasAttribute('aria-valuenow')) {
      const value = Number(element.getAttribute('aria-valuenow'));
      const minimum = Number(element.getAttribute('aria-valuemin') ?? 0);
      const maximum = Number(element.getAttribute('aria-valuemax') ?? 100);
      if (![value, minimum, maximum].every(Number.isFinite) || minimum > maximum || value < minimum || value > maximum) {
        add('aria-range', element, 'Range state is outside its declared bounds');
      }
    }
    if (element.getAttribute('aria-hidden') === 'true' && element.tabIndex >= 0 && !element.disabled) {
      const style = root.ownerDocument.defaultView.getComputedStyle(element);
      if (style.display !== 'none' && style.visibility !== 'hidden') add('hidden-focus', element, 'Hidden semantic element remains a tab stop');
    }
  }
  return { version: 1, engine: 'sharpforge-dom-a11y', nodes: elements.length, violations };
}
