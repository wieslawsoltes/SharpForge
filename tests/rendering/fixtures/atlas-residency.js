import {DrawingContext, TextLayoutService, createPortableTextProvider, bundledTextFixtures} from '@sharpforge/rendering';
import {canvasFactory, fixtureLoader, canvasReference} from './numeric-text.js';
import {residentGlyphs, residentGrid, residentGlyphCount, glyphIdentity, pressureRun} from './atlas-residency-data.js';

const atlasByteBudget = 32 * 1024 * 1024;

function observedEntries(atlas, glyphs) {
  const expected = new Set(glyphs.map(glyphIdentity)), found = new Map();
  for (const entry of atlas.entries.values()) {
    if (!entry.key.startsWith('\u0001glyph:')) continue;
    const fields = JSON.parse(entry.key.slice(7));
    const key = JSON.stringify(fields.slice(0, 3));
    if (expected.has(key) && atlas.valid(entry)) found.set(key, entry);
  }
  if (found.size !== expected.size) throw new Error('GPU atlas is missing a visible real font-instance/glyph entry');
  return [...found.values()];
}

function glyphInstances(renderer) {
  return (renderer.plan?.root.commands ?? []).reduce((count, command) =>
    count + (command.kind === 'draw' && command.mesh?.kind === 'glyph' ? command.mesh.count : 0), 0);
}

function checkBackend(surface, count) {
  if (surface.backend !== 'webgpu') throw new Error('Atlas stress fell back from the numeric WebGPU pipeline: ' + surface.reason);
  if (glyphInstances(surface.renderer) !== count) throw new Error('GPU glyph instance count differs from the actual nonempty corpus');
  const atlas = surface.renderer.meshes.atlas;
  if (atlas.maxBytes !== atlasByteBudget || atlas.bytes > atlasByteBudget || atlas.entries.size > atlas.maxEntries) {
    throw new Error('Glyph residency exceeded the declared 32 MiB atlas or metadata budget');
  }
  return atlas;
}

function requireSamePixels(before, after) {
  if (before.width !== after.width || before.height !== after.height || before.alphaMode !== after.alphaMode ||
      before.data.length !== after.data.length) throw new Error('Glyph recovery changed the retained readback contract');
  for (let index = 0; index < before.data.length; index++) {
    if (before.data[index] !== after.data[index]) throw new Error('Atlas page recycling changed a recovered glyph pixel at byte ' + index);
  }
}

async function submission(surface) {
  await surface.device.queue.onSubmittedWorkDone();
  await surface.service.retirement.drain();
}

async function pressure(surface, state, originals) {
  const {resources, definition, glyphs, provider, clear} = state;
  let peakAtlasBytes = surface.renderer.meshes.atlas.bytes, pressurePasses = 0, pressureGlyphs = 0;
  const draw = list => surface.updateDisplayList(list, resources, definition.width, definition.height, 1);
  const releasePlan = async () => { draw(clear); await submission(surface); };
  for (; pressurePasses < 16; pressurePasses++) {
    state.signal?.throwIfAborted();
    await releasePlan();
    const prepared = pressureRun(glyphs, provider, pressurePasses, definition);
    const handle = resources.register('glyphRun', prepared.run);
    try {
      const list = new DrawingContext().DrawGlyphRun(handle, [0, 0], '#285880').finish();
      draw(list);
      await submission(surface);
      const atlas = checkBackend(surface, prepared.run.glyphs.length);
      observedEntries(atlas, prepared.run.glyphs);
      pressureGlyphs += prepared.run.glyphs.length;
      peakAtlasBytes = Math.max(peakAtlasBytes, atlas.bytes);
      if (originals.some(entry => !atlas.valid(entry))) {
        return {pressurePasses: pressurePasses + 1, pressureGlyphs, peakAtlasBytes,
          evictedOriginalEntries: originals.filter(entry => !atlas.valid(entry)).length};
      }
    } finally {
      await releasePlan();
      await resources.release(handle);
    }
  }
  throw new Error('Bounded real glyph pressure did not exercise atlas page recycling');
}

async function verifyResidentPixels(surface, state) {
  const atlas = checkBackend(surface, residentGlyphCount), originalPlan = surface.renderer.plan;
  if (surface.renderer.pixelWidth !== state.definition.width || surface.renderer.pixelHeight !== state.definition.height) {
    throw new Error('Atlas residency cannot qualify a silently downsampled physical viewport');
  }
  const originals = observedEntries(atlas, state.run.glyphs);
  const before = await surface.renderer.readPixels();
  for (let frame = 0; frame < 5; frame++) {
    state.signal?.throwIfAborted();
    surface.draw();
    if (surface.renderer.plan !== originalPlan || originals.some(entry => !atlas.valid(entry))) {
      throw new Error('Unchanged real glyph frames rebuilt their display plan or lost resident entries');
    }
  }
  await submission(surface);
  let observed;
  try { observed = await pressure(surface, state, originals); }
  finally {
    surface.updateDisplayList(state.clear, state.resources, state.definition.width, state.definition.height, 1);
    await submission(surface);
    surface.updateDisplayList(state.list, state.resources, state.definition.width, state.definition.height, 1);
    await submission(surface);
  }
  checkBackend(surface, residentGlyphCount);
  observedEntries(atlas, state.run.glyphs);
  const after = await surface.renderer.readPixels();
  requireSamePixels(before, after);
  return {...state.evidence, ...observed, passed: true, atlasStatus: 'resident-recycled-recovered',
    observedGlyphInstances: residentGlyphCount, recoveredGlyphInstances: residentGlyphCount,
    unchangedFrames: 5, beforeAfterPixels: 'identical', atlasByteBudget,
    finalAtlasBytes: atlas.bytes, finalAtlasEntries: atlas.entries.size, pageGenerations: atlas.pages.map(page => page.generation)};
}

async function verifyResidency(surface, state) {
  if (!surface) throw new Error('Atlas residency fixture requires a retained surface');
  if (surface.backend !== 'webgpu') return {...state.evidence, passed: true, atlasStatus: 'requires-webgpu', observedGlyphInstances: null};
  const device = surface.device;
  device.pushErrorScope('validation');
  try { return await verifyResidentPixels(surface, state); }
  finally {
    const error = await device.popErrorScope();
    if (error) throw new Error('Real glyph residency caused a GPU validation error: ' + error.message);
  }
}

/** 5000 real font-instance/glyph entries, bounded GPU residency and page recycling, plus a same-font Canvas outline comparison. */
export async function createAtlasResidencyFixture(definition, {document, resources, signal} = {}) {
  signal?.throwIfAborted();
  if (definition.width !== 2400 || definition.height !== 1400 || (definition.dpr ?? 1) !== 1 || definition.fontSize !== 16) {
    throw new RangeError('The reviewed atlas fixture is 2400×1400 DIP at DPR 1 and 16 DIP text');
  }
  const base = new URL('../../../', import.meta.url), createCanvas = canvasFactory(document);
  const assets = bundledTextFixtures(base);
  const provider = await createPortableTextProvider({...assets, loadBinary: fixtureLoader(base), createCanvas, signal});
  const textService = new TextLayoutService(provider);
  let handle;
  try {
    const glyphs = await residentGlyphs(textService, {signal,
      yieldFrame: () => new Promise(resolve => document.defaultView.requestAnimationFrame(resolve))});
    const run = residentGrid(glyphs, provider, definition);
    handle = resources.register('glyphRun', run);
    const list = new DrawingContext({elementId: definition.id, version: 1}).DrawGlyphRun(handle, [0, 0], '#285880')
      .finish([0, 0, definition.width, definition.height]);
    const clear = new DrawingContext().finish([0, 0, definition.width, definition.height]);
    const evidence = {provider: provider.kind, glyphAccess: 'numeric-glyphs', glyphCount: glyphs.length,
      distinctFontGlyphPairs: new Set(glyphs.map(glyphIdentity)).size, distinctFontInstances: new Set(glyphs.map(glyph => glyph.fontId)).size,
      identityPolicy: 'Actual pinned face/variation/glyph pairs; not 5000 unique Unicode characters',
      positioning: 'Explicit stress grid from real HarfBuzz output', harfBuzzJsVersion: '0.8.0',
      assetSha256: assets.fonts.map(font => font.sha256)};
    const state = {definition, resources, provider, glyphs, run, list, clear, signal, evidence};
    return {list, width: definition.width, height: definition.height, textService,
      verify: surface => verifyResidency(surface, state),
      reference: () => canvasReference(createCanvas, textService, list, resources, definition),
      async dispose() {
        if (!handle) return;
        const owned = handle;
        handle = null;
        try { await resources.release(owned); } finally { textService.dispose(); }
      }};
  } catch (error) {
    if (handle) await resources.release(handle);
    textService.dispose();
    throw error;
  }
}
