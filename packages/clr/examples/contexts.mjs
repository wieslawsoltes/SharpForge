import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-contexts/native-contexts.json', import.meta.url)));
const session = new AssemblyLoadSession();
const contexts = [session.createContext({ name: 'Plugin v1', isCollectible: true }),
  session.createContext({ name: 'Plugin v2', isCollectible: true })];
for (let index = 0; index < contexts.length; index++) {
  const assembly = await contexts[index].loadFromStream(Buffer.from(fixture.images[index], 'base64'));
  console.log(`${contexts[index].name}: ${assembly.fullName}`);
  console.log(`Method bodies decoded: ${assembly.manifestModule.methodBodyReadCount}`);
  contexts[index].unload();
}
