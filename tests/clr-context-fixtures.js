import { managedFixture } from './managed-fixtures.js';

export function contextFixture(name, { version = [1, 0, 0, 0], references = [] } = {}) {
  return managedFixture({ name, decorate({ md }) {
    md.rows[32][0].splice(1, 4, ...version);
    for (const reference of references) {
      md.add(35, [1, 0, 0, 0, 0, 0, md.string(reference), 0, 0]);
    }
  } });
}

export async function referenceIndex(assembly, name) {
  const references = await assembly.getReferencedAssemblies();
  const index = references.findIndex(reference => reference.name === name);
  if (index < 0) throw new Error(`Fixture missing reference ${name}`);
  return index + 1;
}
