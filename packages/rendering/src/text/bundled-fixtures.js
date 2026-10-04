const fixtureFonts = Object.freeze([
  {
    "file": "SharpForgeSans-Variable.ttf",
    "family": "SharpForge Sans Fixture",
    "weight": [
      100,
      900
    ],
    "style": "normal",
    "sha256": "d74c27145878d39fd619db868ac59c4414e1b59f83c6a124ca2f88e93ccc5c90"
  },
  {
    "file": "SharpForgeSans-Italic-Variable.ttf",
    "family": "SharpForge Sans Fixture",
    "weight": [
      100,
      900
    ],
    "style": "italic",
    "sha256": "49e1539bee4fdcbe2f5a7287815eaaa243c5f610f4d1c1852b59f226624006db"
  },
  {
    "file": "NotoSans-Regular.ttf",
    "family": "Noto Sans",
    "weight": 400,
    "style": "normal",
    "sha256": "4c8d67001d3c2977e5d6bf0a4f8add80cd564bd1df60b7569fd23751e7dda02a"
  }
].map(Object.freeze));

/** URLs and face metadata for the licensed multilingual fixtures, relative to the built application asset root.
 * The caller chooses the asset root and supplies an authorized binary loader to createPortableTextProvider.
 * These bounded fixtures are not a complete system-font collection; supply application fonts for other coverage.
 */
export function bundledTextFixtures(assetBase) {
  const base = new URL(assetBase);
  return {wasmURL: new URL('packages/rendering/vendor/harfbuzz/hb.wasm', base).href,
    fonts: fixtureFonts.map(({file, ...descriptor}) => ({...descriptor, id: descriptor.sha256, version: descriptor.sha256,
      url: new URL('packages/rendering/vendor/fonts/' + file, base).href}))};
}
