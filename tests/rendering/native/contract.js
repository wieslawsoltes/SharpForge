import { createHash } from 'node:crypto';

export const limits = Object.freeze({ fixtures: 128, xamlBytes: 256 * 1024, inputBytes: 4 * 1024 * 1024,
  dimension: 4096, pixels: 4 * 1024 * 1024, totalPixels: 16 * 1024 * 1024, reportBytes: 1024 * 1024 });
export const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (code, message) => { throw new Error(code + ': ' + message); };

/** Physical pixel dimensions use ceil(DIP size * requested render scale), with a fixed allocation budget. */
export function pixelDimensions(width, height, dpr) {
  if (![width, height].every(value => Number.isFinite(value) && value >= 1 && value <= 2048) ||
      !Number.isFinite(dpr) || dpr < 0.5 || dpr > 4) fail('SFNPIX001', 'Invalid DIP size or render scale');
  const dimensions = [Math.ceil(width * dpr), Math.ceil(height * dpr)];
  if (dimensions.some(value => value > limits.dimension) || dimensions[0] * dimensions[1] > limits.pixels) {
    fail('SFNPIX001', 'Native capture exceeds the physical pixel budget');
  }
  return dimensions;
}

/** Validate data-only fixture identity before reading paths, allocating pixels, or launching a native process. */
export function validateCatalog(value) {
  if (value?.schemaVersion !== 1 || value.captureProfile !== 'static-xaml' || !Array.isArray(value.fixtures) ||
      value.fixtures.length < 1 || value.fixtures.length > limits.fixtures) fail('SFNPIX002', 'Invalid native fixture catalog');
  const ids = new Set();
  let totalPixels = 0;
  for (const fixture of value.fixtures) {
    if (!fixture || !/^native-xaml-[a-z0-9-]{1,78}$/.test(fixture.id ?? '') || ids.has(fixture.id) ||
        !/^[a-z][a-z0-9-]{0,63}\.xaml$/.test(fixture.file ?? '') || !digest(fixture.xamlSha256) ||
        !['pixels', 'load-error'].includes(fixture.expected) || !['Light', 'Dark'].includes(fixture.theme) ||
        typeof fixture.description !== 'string' || !fixture.description.trim() || fixture.description.length > 512 ||
        fixture.focusTarget != null && !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(fixture.focusTarget)) {
      fail('SFNPIX002', 'Invalid or duplicate native fixture identity');
    }
    ids.add(fixture.id);
    const [width, height] = pixelDimensions(fixture.width, fixture.height, fixture.dpr);
    totalPixels += width * height;
    for (const [name, maximum] of [['maxChannel', 255], ['meanChannel', 255], ['differentPixelFraction', 1]]) {
      const tolerance = fixture.tolerance?.[name];
      if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > maximum) fail('SFNPIX002', 'Invalid native tolerance');
    }
  }
  if (totalPixels > limits.totalPixels) fail('SFNPIX002', 'Native fixture set exceeds the total pixel budget');
  return value;
}

/** Convert captured top-left BGRA8 bytes to premultiplied RGBA8; reject a mismatched alpha contract. */
export function bgraToRgba(bytes, dimensions) {
  const [width, height] = dimensions;
  if (!(bytes instanceof Uint8Array) || ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= limits.dimension) ||
      width * height > limits.pixels || bytes.length !== width * height * 4) fail('SFNPIX003', 'Invalid native pixel byte count');
  const result = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 4) {
    const alpha = bytes[index + 3];
    if (bytes[index] > alpha || bytes[index + 1] > alpha || bytes[index + 2] > alpha) {
      fail('SFNPIX003', 'Native pixels do not satisfy premultiplied BGRA8');
    }
    result[index] = bytes[index + 2];
    result[index + 1] = bytes[index + 1];
    result[index + 2] = bytes[index];
    result[index + 3] = alpha;
  }
  return result;
}

/** Validate a native observation without treating a load error or an empty capture as a pixel reference. */
export function validateObservation(value, fixture) {
  if (value?.id !== fixture.id || value.xamlSha256 !== fixture.xamlSha256 || value.status !== fixture.expected) {
    fail('SFNPIX004', 'Native fixture identity or outcome changed: ' + fixture.id);
  }
  if (value.status === 'load-error') {
    if (typeof value.exception !== 'string' || !value.exception || value.exception.length > 512 || !Number.isInteger(value.hresult) ||
        value.hresult < -2147483648 || value.hresult > 2147483647 ||
        value.file != null || value.dimensions != null) fail('SFNPIX004', 'Native XAML error has invalid diagnostics or pixel data');
    return value;
  }
  const dimensions = pixelDimensions(fixture.width, fixture.height, fixture.dpr);
  if (value.file !== fixture.id + '.bgra' || JSON.stringify(value.dimensions) !== JSON.stringify(dimensions) ||
      value.byteCount !== dimensions[0] * dimensions[1] * 4 || !digest(value.bgraSha256) ||
      value.pixelFormat !== 'BGRA8' || value.alphaMode !== 'premultiplied' || value.colorSpace !== 'srgb' ||
      value.origin !== 'top-left' || value.rasterScaleMode !== 'render-target-explicit-size' ||
      !Number.isFinite(value.rasterizationScale) || value.rasterizationScale <= 0 || value.rasterizationScale > 16 ||
      value.actualTheme !== fixture.theme || value.focusTarget !== (fixture.focusTarget ?? null)) {
    fail('SFNPIX004', 'Native capture dimensions, format, or environment changed: ' + fixture.id);
  }
  return value;
}

export function validateDump(value, input, pin) {
  if (value?.schemaVersion !== 1 || value.inputHash !== input.inputHash || value.runtime !== pin.runtime ||
      value.culture !== 'en-US' || typeof value.toolVersion !== 'string' || !value.toolVersion ||
      typeof value.operatingSystem?.description !== 'string' || !value.operatingSystem.description ||
      value.operatingSystem.architecture !== 'X64' || typeof value.environment?.highContrast !== 'boolean' ||
      !Number.isFinite(value.environment.textScaleFactor) || value.environment.textScaleFactor <= 0 ||
      typeof value.environment.animationsEnabled !== 'boolean' || value.stabilityPolicy?.consecutiveCaptures !== 3 ||
      value.stabilityPolicy?.maximumRenderingTurns !== 120 || !Array.isArray(value.observations) ||
      value.observations.length !== input.fixtures.length) fail('SFNPIX005', 'Invalid native capture provenance');
  value.observations.forEach((observation, index) => validateObservation(observation, input.fixtures[index]));
  if (value.shapeDefaults != null) validateShapeDefaults(value.shapeDefaults);
  return value;
}

/** Preserve observed native defaults and local-value state without substituting expected framework values. */
export function validateShapeDefaults(values) {
  const required = new Set(['Rectangle', 'Ellipse', 'Line', 'Path', 'Polygon', 'Polyline']
    .map(name => 'Microsoft.UI.Xaml.Shapes.' + name));
  if (!Array.isArray(values) || values.length !== required.size) fail('SFNPIX025', 'Native shape default observations are incomplete');
  for (const value of values) {
    if (!required.delete(value?.type) || !Number.isFinite(value.strokeThickness) || value.strokeThickness < 0 ||
        !['None', 'Fill', 'Uniform', 'UniformToFill'].includes(value.stretch) ||
        typeof value.strokeHasLocalValue !== 'boolean' || typeof value.stretchHasLocalValue !== 'boolean') {
      fail('SFNPIX025', 'Invalid native shape default observation');
    }
  }
  return values;
}

/** Exported metadata binds provider-owned pixels to exact XAML, native toolchain, and source revision. */
export function referenceMetadata({ fixture, observation, dump, input, provenance, pin, pixelSha256 }) {
  validateObservation(observation, fixture);
  if (observation.status !== 'pixels' || !digest(pixelSha256) || !/^[a-f0-9]{40}$/.test(provenance?.sourceRevision ?? '') ||
      typeof provenance?.sourceDirty !== 'boolean' || !Array.isArray(provenance?.captureCommand) || !provenance.captureCommand.length ||
      provenance.captureCommand.length > 64 || provenance.captureCommand.some(value => typeof value !== 'string' || value.length > 4096)) {
    fail('SFNPIX006', 'A native reference requires actual pixels and capture provenance');
  }
  const identity = { id: fixture.id, width: fixture.width, height: fixture.height, dpr: fixture.dpr, theme: fixture.theme,
    focusTarget: fixture.focusTarget ?? null };
  return { schemaVersion: 1, referenceKind: 'native-winui', tool: 'WinUI', windowsAppSdkVersion: pin.windowsAppSDK,
    toolVersion: dump.toolVersion, captureCommand: provenance.captureCommand, operatingSystem: dump.operatingSystem,
    dimensions: observation.dimensions, alphaMode: 'premultiplied', colorSpace: 'srgb', origin: 'top-left',
    captureMode: 'native-render-target-bitmap', rasterScaleMode: 'render-target-explicit-size', fixture: identity,
    xamlSha256: fixture.xamlSha256, inputHash: input.inputHash, pixelSha256, bgraSha256: observation.bgraSha256,
    sourceRevision: provenance.sourceRevision, sourceDirty: provenance.sourceDirty, capturedAt: provenance.capturedAt,
    stabilityPolicy: { ...dump.stabilityPolicy, freshProcesses: 2 },
    nativeEnvironment: { ...dump.environment, rasterizationScale: observation.rasterizationScale, actualTheme: observation.actualTheme },
    nativeDefaults: { shapeDefaults: dump.shapeDefaults ?? null },
    pinnedToolchain: pin, materials: input.materials, tolerance: fixture.tolerance,
    referenceStatus: 'Native capture; browser parity requires a separate comparison',
    captureProfile: 'static-xaml; excludes popup/composition-only/media/SwapChainPanel content' };
}
