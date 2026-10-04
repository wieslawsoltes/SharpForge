/** The immutable source published to workspace consumers; visual previews are never source input. */
export function documentSource(record, model = record?.model) {
  return model?.publishedSnapshot?.() ?? model?.snapshot?.() ?? record?.source;
}
