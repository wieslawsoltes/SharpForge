import {WinUIHost} from '@sharpforge/winui';

const control = (id, type, properties, collections = {}) => ({id, type, properties, collections, events: ['Click']});
const transforms = {
  identity: null,
  translate: ['TranslateTransform', {X: 13.25, Y: -7.5}],
  rotate: ['RotateTransform', {Angle: 27, CenterX: 22, CenterY: 14}],
  scale: ['ScaleTransform', {ScaleX: 1.15, ScaleY: .8, CenterX: 24, CenterY: 12}],
  skew: ['SkewTransform', {AngleX: 18, AngleY: -9, CenterX: 22, CenterY: 14}],
  composite: ['CompositeTransform', {TranslateX: 6.25, TranslateY: -3.5, Rotation: 19,
    SkewX: 11, SkewY: -7, ScaleX: 1.12, ScaleY: .85, CenterX: 22, CenterY: 14}]
};

/** Bounded reference cases use actual WinUI transforms, native Buttons and a sibling above the moved control. */
export function designerCanvasTranslationScenes() {
  return [...Object.keys(transforms), 'parent-affine'].map(name => {
    const nodes = [
      control('window', 'Microsoft.UI.Xaml.Window', {Title: 'Canvas geometry reference', Content: {$ref: 'canvas'}}),
      control('canvas', 'Microsoft.UI.Xaml.Controls.Canvas', {Width: 520, Height: 360},
        {Children: [{$ref: 'target'}, {$ref: 'neighbor'}]}),
      control('target', 'Microsoft.UI.Xaml.Controls.Button',
        {Name: 'Target', Content: 'Native target', Left: 80, Top: 70, Width: 144, Height: 56}),
      control('neighbor', 'Microsoft.UI.Xaml.Controls.Button',
        {Name: 'Neighbor', Content: 'Above target', Left: 225, Top: 125, Width: 220, Height: 150, ZIndex: 1})
    ];
    const transform = transforms[name === 'parent-affine' ? 'composite' : name];
    if (transform) {
      nodes[2].properties.RenderTransform = {$ref: 'transform'};
      nodes.push(control('transform', `Microsoft.UI.Xaml.Media.${transform[0]}`, {...transform[1]}));
    }
    if (name === 'parent-affine') {
      nodes[1].properties.RenderTransform = {$ref: 'parentTransform'};
      nodes.push(control('parentTransform', 'Microsoft.UI.Xaml.Media.CompositeTransform',
        {TranslateX: 8, TranslateY: 5, Rotation: 7, ScaleX: .94, ScaleY: 1.03, CenterX: 70, CenterY: 40}));
    }
    return {name, scene: {version: 1, windows: ['window'], nodes}};
  });
}

function setProperties(node, properties) {
  for (const [name, value] of Object.entries(properties)) {
    if (value === undefined) delete node.properties[name];
    else node.properties[name] = structuredClone(value);
  }
}

function visualState(host, initial) {
  const element = host.elements.get('target');
  const root = host.root.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  const center = {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
  const hit = host.document.elementFromPoint(center.x, center.y);
  return {
    bounds: {left: bounds.left - root.left, top: bounds.top - root.top, width: bounds.width, height: bounds.height},
    center, hit: hit?.closest('[data-sf-id]')?.dataset.sfId ?? null, hitOwned: !!hit && host.root.contains(hit),
    properties: structuredClone(host.nodes.get('target').properties), layout: host.layouts.get('target'),
    style: {left: element.style.left, top: element.style.top, width: element.style.width, height: element.style.height,
      transform: element.style.transform, origin: element.style.transformOrigin},
    targetRetained: element === initial.target, neighborRetained: host.elements.get('neighbor') === initial.neighbor,
    translated: host.geometryUpdates.translations.records.has('target')
  };
}

/** Standalone real-DOM reference. Each incremental host update is compared with an independent complete scene render. */
export class DesignerCanvasTranslationReference {
  constructor(root) {
    if (!root?.ownerDocument) throw new TypeError('Canvas translation references require a DOM root.');
    this.root = root;
    this.owner = root.ownerDocument;
    this.scene = null;
    this.name = null;
    this.hosts = {};
    this.initial = {};
    this.events = [];
    this.inputs = [];
    this.errors = [];
    this.inputListeners = [];
    Object.assign(root.style, {display: 'flex', gap: '24px', padding: '16px', background: '#ddd', color: '#111'});
    for (const name of ['retained', 'reference']) this.addHost(name);
  }

  addHost(name) {
    const region = this.owner.createElement('section');
    const title = this.owner.createElement('h2');
    title.textContent = name === 'retained' ? 'Retained Canvas positions' : 'Complete render reference';
    Object.assign(title.style, {font: '18px system-ui', height: '28px', margin: '0'});
    const container = this.owner.createElement('div');
    container.dataset.a18CanvasHost = name;
    Object.assign(container.style, {position: 'relative', width: '600px', height: '440px', overflow: 'visible'});
    region.append(title, container);
    this.root.append(region);
    this.hosts[name] = new WinUIHost(container, {backend: 'dom',
      onEvent: (id, event) => this.events.push({host: name, id, event}),
      onError: error => this.errors.push(error.message)});
    for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) {
      const listener = event => {
        if (this.inputs.length < 128) this.inputs.push({host: name, type, trusted: event.isTrusted,
          key: event.key ?? null, id: event.target.closest('[data-sf-id]')?.dataset.sfId ?? null});
      };
      container.addEventListener(type, listener, true);
      this.inputListeners.push({container, type, listener});
    }
  }

  async load(name, theme = 'dark') {
    const fixture = designerCanvasTranslationScenes().find(item => item.name === name);
    if (!fixture || !['light', 'dark'].includes(theme)) throw new TypeError('Unknown Canvas reference case or theme.');
    this.name = name;
    this.scene = fixture.scene;
    this.events.length = 0;
    this.inputs.length = 0;
    this.errors.length = 0;
    this.overrideTransform(null);
    for (const [kind, host] of Object.entries(this.hosts)) {
      host.root.dataset.theme = theme;
      host.load(this.scene);
      host.flush();
      this.initial[kind] = {target: host.elements.get('target'), neighbor: host.elements.get('neighbor')};
    }
    const clock = this.owner.defaultView;
    await new Promise(resolve => clock.requestAnimationFrame(() => clock.requestAnimationFrame(resolve)));
    for (const host of Object.values(this.hosts)) if (host.frame) host.flush();
    return this.read('initial');
  }

  patch(properties, {flush = true, label = 'position'} = {}) {
    if (!this.hosts.retained.tryPatchProperties([{id: 'target', properties}])) {
      throw new Error(`The ${this.name} geometry patch requires an unexpected scene fallback.`);
    }
    setProperties(this.scene.nodes.find(node => node.id === 'target'), properties);
    return flush ? this.flush(label) : null;
  }

  flush(label) {
    this.hosts.retained.flush();
    this.hosts.reference.load(this.scene);
    this.hosts.reference.flush();
    return this.read(label);
  }

  external(command, label = 'external scene') {
    if (command.op !== 'set' || !this.scene.nodes.some(node => node.id === command.id)) {
      throw new TypeError('Reference scene commands must set an existing node property.');
    }
    setProperties(this.scene.nodes.find(node => node.id === command.id), {[command.property]: command.value});
    this.hosts.retained.apply(command);
    return this.flush(label);
  }

  reload(label = 'complete reload') {
    this.hosts.retained.load(this.scene);
    return this.flush(label);
  }

  overrideTransform(mode) {
    if (![null, 'identity', 'rotate'].includes(mode)) throw new TypeError('Unknown reference stylesheet override.');
    for (const host of Object.values(this.hosts)) {
      if (mode === null) delete host.root.dataset.a18CanvasTransform;
      else host.root.dataset.a18CanvasTransform = mode;
    }
  }

  read(label) {
    return {scene: this.name, label, renderer: 'WinUIHost DOM',
      retained: visualState(this.hosts.retained, this.initial.retained),
      reference: visualState(this.hosts.reference, this.initial.reference),
      events: [...this.events], inputs: [...this.inputs], errors: [...this.errors]};
  }

  dispose() {
    for (const {container, type, listener} of this.inputListeners) container.removeEventListener(type, listener, true);
    this.inputListeners.length = 0;
    for (const host of Object.values(this.hosts)) host.dispose();
    this.root.replaceChildren();
    this.events.length = 0;
    this.inputs.length = 0;
    this.scene = null;
  }
}
