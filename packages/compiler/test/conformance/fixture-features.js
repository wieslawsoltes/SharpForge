/**
 * Catalog features that only binding can recognise, mapped to the differential features (fixture families of
 * ../differential/fixtures) whose output fixtures execute them (SF-A02-T12.2). Features the parser or the syntax
 * walker records need no entry: the report finds them in the fixture sources.
 *
 * An entry is a claim that every output fixture of the named family uses the feature. A family that does not exist
 * (yet) contributes nothing, so the feature stays `unsupported` until its fixtures land.
 */
export const semanticFixtureFeatures = Object.freeze({
  AsyncMain: ['entry-point'],
  InferredTupleNames: ['tuple-lowering'],
  TupleEquality: ['tuple-lowering'],
  OverloadResolutionPriority: ['overload-resolution-priority'],
});
