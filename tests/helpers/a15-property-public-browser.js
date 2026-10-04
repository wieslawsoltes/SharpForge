/** Public JavaScript app assertions run against real DOM hosts, using the repository's CSP-safe module loader. */
async function installA15PropertyBrowserFixtures() {
  const {createWinUIApp} = await __sharpforgeTestImport('/packages/winui/src/index.js');
  const roots = new Set();
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(label + ': expected ' + expected + ', received ' + actual);
  };
  function begin() {
    const root = document.createElement('div');
    root.dataset.a15Properties = 'true';
    Object.assign(root.style, {position: 'relative', width: '480px', height: '320px'});
    document.body.append(root);
    const errors = [];
    const app = createWinUIApp(root, {backend: 'dom', onError: error => errors.push(String(error.message ?? error))});
    const record = {root, app, errors};
    roots.add(record);
    return record;
  }
  function dispose(record) {
    record.app.dispose();
    record.root.remove();
    roots.delete(record);
  }
  async function defaultStyleKey() {
    const record = begin();
    const {app, root, errors} = record;
    const X = app.Microsoft.UI.Xaml, C = X.Controls;
    const values = [];
    try {
      const control = new C.Button(), window = new X.Window();
      const sized = height => {
        const style = new X.Style(C.Button);
        style.Setters.Add(new X.Setter(X.FrameworkElement.MinHeightProperty, height));
        return style;
      };
      control.Name = 'keyed';
      control.Content = 'Default style key';
      control.Resources.Add('compact', sized(11));
      control.Resources.Add(C.CheckBox, sized(17));
      control.Resources.Add('invalid', new X.Style(C.TextBlock));
      window.Content = control;
      window.Activate();
      await app.settled();
      const observe = () => values.push(control.MinHeight);
      observe();
      control.DefaultStyleKey = 'compact'; observe();
      control.Style = sized(21); observe();
      control.MinHeight = 31;
      control.Resources.set_Item('compact', sized(13)); observe();
      control.ClearValue(X.FrameworkElement.MinHeightProperty); observe();
      control.ClearValue(X.FrameworkElement.StyleProperty); observe();
      control.DefaultStyleKey = 'absent'; observe();
      control.DefaultStyleKey = null; observe();
      control.ClearValue(C.Control.DefaultStyleKeyProperty); observe();
      control.DefaultStyleKey = C.CheckBox; observe();
      control.DefaultStyleKey = C.Button; observe();
      control.DefaultStyleKey = 'compact'; observe();
      equal(values.join(','), '32,11,21,31,21,13,0,0,32,17,32,13', 'default key precedence');
      let fault = null;
      try { control.DefaultStyleKey = 'invalid'; } catch (error) { fault = error; }
      equal(fault?.code, 'SFSTYLE014', 'incompatible-key diagnostic');
      equal(control.DefaultStyleKey, 'compact', 'key rollback');
      equal(control.MinHeight, 13, 'style rollback');
      equal(control.ReadLocalValue(C.Control.DefaultStyleKeyProperty), 'compact', 'local slot rollback');
      control.Resources.set_Item('compact', sized(14));
      equal(control.MinHeight, 14, 'previous subscription remains live after rollback');
      control.ClearValue(C.Control.DefaultStyleKeyProperty);
      await app.settled();
      equal(control.MinHeight, 32, 'clear restores registered recipe');
      equal(root.querySelectorAll('[data-sf-id]').length > 0, true, 'actual rendered scene');
      window.Content = null;
      await app.settled();
      equal(root.querySelector('[data-sf-id="' + control.$node.id + '"]'), null, 'detached control DOM');
      equal(errors.length, 0, 'host errors');
      return {values, invalidReplacement: fault.code, actualDOM: true, detached: true};
    } finally { dispose(record); }
  }
  window.a15Properties = {defaultStyleKey, dispose: () => { for (const record of [...roots]) dispose(record); }};
}
