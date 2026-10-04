/** Inputs needed before the first project evaluation; source documents remain lazy until opened or compiled. */
export function isProjectEvaluationInput(path) {
  return /\.(?:[a-z]*proj|slnx?|slnf|props|targets|resx|resw|editorconfig)$/i.test(path)
    || /(?:^|\/)(?:\.editorconfig|global\.json|Properties\/launchSettings\.json)$/i.test(path)
    || /(?:^|\/)\.sharpforge\/workspace\.json$/.test(path);
}
