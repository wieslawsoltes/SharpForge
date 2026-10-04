import {DrawingContext} from '../drawing/context.js';
import {DrawingError, rectangle} from '../drawing/commands.js';
import {IDENTITY, inverse, multiply} from '../media/transforms.js';

/** Retain local content while ancestor clips and scroll placement change; layer handles prevent command-tree copies per scroll. */
export class RetainedPlacement {
  constructor(id, resources) {
    this.id = id;
    this.resources = resources;
    this.handle = null;
    this.content = null;
    this.key = null;
    this.list = null;
    this.version = 0;
  }

  update(content, layout, outset = [0, 0]) {
    const clips = layout.clips ?? [];
    if (clips.length > 128) throw new DrawingError('SFRENDER139', 'Ancestor clipping exceeds the drawing stack budget');
    if (!clips.length && !outset[0] && !outset[1]) return content;
    if (this.content !== content) {
      const layer = {displayList: content, cacheKey: `element:${this.id}`, contentVersion: content.version};
      if (this.handle) this.resources.update(this.handle, layer);
      else this.handle = this.resources.register('layer', layer);
      this.content = content;
    }
    const world = clips.length ? layout.worldTransform ?? IDENTITY : IDENTITY;
    const key = JSON.stringify([clips, world, outset]);
    if (key === this.key) return this.list;
    const drawing = new DrawingContext({elementId: this.id, version: ++this.version});
    drawing.PushTransform([1, 0, 0, 1, -outset[0], -outset[1]]);
    const local = inverse(world);
    if (!local) drawing.PushClip({kind: 'rectangle', rect: [0, 0, 0, 0]});
    else for (const clip of clips) {
      drawing.PushClip({kind: 'rectangle', rect: rectangle(clip.rect), transform: multiply(local, clip.transform ?? IDENTITY)});
    }
    drawing.DrawLayer(this.handle);
    for (let index = 0; index < (local ? clips.length : 1); index++) drawing.Pop();
    drawing.Pop();
    this.key = key;
    this.list = drawing.finish();
    return this.list;
  }

  dispose() {
    if (this.handle) this.resources.release(this.handle);
    this.handle = null;
    this.content = null;
    this.list = null;
    this.key = null;
  }
}
