import {ProjectSystem} from '@sharpforge/project-system';

/** Execute the precise portable phase named by a corpus fixture and retain all blocking diagnostics. */
export function evaluatePortableFixture(fixture) {
  const system = new ProjectSystem(fixture.files, {configuration: 'Debug', ...fixture.options});
  const snapshot = system.load(fixture.entry ?? 'Test.csproj');
  if (fixture.phase === 'build-plan') {
    try { system.buildPlan(fixture.entry); }
    catch (error) { snapshot.diagnostics.push({code: error.code, message: error.message, severity: 'error'}); }
  }
  return {project: snapshot.projects[0], diagnostics: snapshot.diagnostics};
}
