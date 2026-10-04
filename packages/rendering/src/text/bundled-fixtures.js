const fixtureFonts = Object.freeze([
  Object.freeze({file: "SharpForgeSans-Variable.ttf", family: "SharpForge Sans Fixture",
    weight: [100, 900], style: "normal",
    sha256: "d74c27145878d39fd619db868ac59c4414e1b59f83c6a124ca2f88e93ccc5c90"}),
  Object.freeze({file: "SharpForgeSans-Italic-Variable.ttf", family: "SharpForge Sans Fixture",
    weight: [100, 900], style: "italic",
    sha256: "49e1539bee4fdcbe2f5a7287815eaaa243c5f610f4d1c1852b59f226624006db"}),
  Object.freeze({file: "NotoSansArabic-Variable.ttf", family: "Noto Sans Arabic",
    weight: [100, 900], style: "normal",
    sha256: "ee489b994b3e62def9874c918145e32b133b625abaf98cec60502bdb40102c56"}),
  Object.freeze({file: "NotoSansHebrew-Regular.ttf", family: "Noto Sans Hebrew",
    weight: 400, style: "normal",
    sha256: "a7fa16fffb27bedb060a0866267c29e9859aeb9c21cc33f5b3aaf6eb062eca85"}),
  Object.freeze({file: "NotoSansDevanagari-Regular.otf", family: "Noto Sans Devanagari",
    weight: 400, style: "normal",
    sha256: "4775b7eeee96cb61c42f66d9136d535a0aa728c2009ad0f4cd2bc970149d9ac7"}),
  Object.freeze({file: "SharpForgeEmojiFixture.ttf", family: "SharpForge Emoji Fixture",
    weight: 400, style: "normal",
    sha256: "77595a308482bcf13502d875cbaf9bd7cd812892a4263673ff57af86d409f6dd", color: true}),
]);

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
