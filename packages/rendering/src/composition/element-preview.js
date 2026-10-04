/** Owner-scoped state holds preview visuals without creating an application-to-UIElement GC edge. */
class PreviewLease {
  constructor(preview, key) { this.preview = preview; this.key = key; }
  *retainedValues() {
    const entry = this.preview.entries.get(this.key);
    if (entry) { yield entry.visual; yield entry.child; }
  }
  snapshot() {
    const entry = this.preview.entries.get(this.key);
    return entry ? {...entry} : null;
  }
  restore(entry) {
    if (entry) this.preview.restoreEntry(this.key, {...entry});
    else this.preview.removeKey(this.key);
  }
  dispose() { this.preview.removeKey(this.key); }
}

/** XAML owns layout; this app-scoped bridge owns hand-in and hand-out composition state. */
export class ElementCompositionPreview {
  constructor(compositor, {isElement, getLayout, getOpacity = () => 1, setComposition, owner, keyFor,
    ownerReference = value => new WeakRef(value), resolveAlive = reference => reference.deref(), registerOwner, onRemove} = {}) {
    this.compositor = compositor;
    this.isElement = isElement ?? (value => value?.owner === owner);
    this.getOpacity = getOpacity;
    this.getLayout = getLayout ?? (() => ({width: 0, height: 0}));
    this.setComposition = setComposition ?? (() => {});
    this.identities = new WeakMap();
    this.serial = 0;
    this.keyFor = keyFor ?? (value => {
      if (!this.identities.has(value)) this.identities.set(value, ++this.serial);
      return this.identities.get(value);
    });
    this.ownerReference = ownerReference;
    this.resolveAlive = resolveAlive;
    this.registerOwner = registerOwner;
    this.onRemove = onRemove;
    this.entries = new Map();
    this.closed = false;
  }

  notify(key, entry, owner = entry?.owner) {
    this.setComposition(owner ? this.resolveAlive(owner) ?? null : null, entry, {key});
  }
  entry(element) {
    if (this.closed || !this.isElement(element)) throw new TypeError('A live UIElement from this application is required');
    const key = this.keyFor(element);
    let entry = this.entries.get(key);
    if (!entry) {
      const visual = this.compositor.CreateContainerVisual();
      const layout = this.getLayout(element);
      visual.Opacity = this.getOpacity(element);
      visual.Size = [layout?.width ?? 0, layout?.height ?? 0];
      entry = {owner: this.ownerReference(element), visual, child: null, translationEnabled: false, lease: new PreviewLease(this, key)};
      this.entries.set(key, entry);
      this.registerOwner?.(element, entry.lease);
      this.notify(key, entry);
    }
    return entry;
  }
  lease(element) { return this.entry(element).lease; }
  GetElementVisual(element) { return this.entry(element).visual; }
  GetElementChildVisual(element) { return this.entry(element).child; }
  SetElementChildVisual(element, child) {
    const entry = this.entry(element);
    if (child !== null && (child?.Compositor !== this.compositor || child.parent || child.closed)) {
      throw new TypeError('Hand-in visual must be parentless and belong to this Compositor');
    }
    entry.child = child;
    this.notify(this.keyFor(element), entry);
    this.compositor.invalidate();
  }
  SetIsTranslationEnabled(element, enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Translation enabled requires a boolean');
    const entry = this.entry(element);
    entry.translationEnabled = enabled;
    if (enabled && !entry.visual.Properties.values.has('Translation')) entry.visual.Properties.InsertVector3('Translation', [0, 0, 0]);
    this.notify(this.keyFor(element), entry);
  }
  updateProperty(element, property, value) {
    const entry = this.entries.get(this.keyFor(element));
    if (!entry) return;
    if (property === 'Opacity') entry.visual.Opacity = value;
    if (property === 'Translation') entry.visual.Properties.InsertVector3('Translation', value);
  }
  updateLayout(element) {
    const entry = this.entries.get(this.keyFor(element));
    if (!entry) return;
    const layout = this.getLayout(element);
    entry.visual.Size = [layout?.width ?? 0, layout?.height ?? 0];
  }
  remove(element) { this.removeKey(this.keyFor(element)); }
  removeKey(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    const element = this.resolveAlive(entry.owner) ?? null;
    this.onRemove?.(element, {key});
    this.notify(key, null, entry.owner);
    entry.visual.dispose();
  }
  sweep() {
    for (const [key, entry] of this.entries) if (!this.resolveAlive(entry.owner)) this.removeKey(key);
  }
  snapshot() { return [...this.entries].map(([key, entry]) => [key, {...entry}]); }
  restoreEntry(key, entry) {
    this.closed = false;
    this.entries.set(key, entry);
    this.notify(key, entry);
  }
  restore(snapshot) {
    const retained = new Set(snapshot.map(([key]) => key));
    for (const key of this.entries.keys()) if (!retained.has(key)) this.removeKey(key);
    for (const [key, entry] of snapshot) this.restoreEntry(key, {...entry});
    this.closed = false;
  }
  dispose() {
    for (const key of this.entries.keys()) this.removeKey(key);
    this.closed = true;
  }
}
