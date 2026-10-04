import {writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {frameworkManifest} from '@sharpforge/framework';
import {createRenderingCoverage, renderingCoverageMarkdown} from './coverage.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const inventory = createRenderingCoverage(frameworkManifest);
await mkdir(resolve(root, 'packages/rendering/inventory'), {recursive: true});
await writeFile(resolve(root, 'packages/rendering/inventory/drawing-surface.json'), JSON.stringify(inventory, null, 2) + '\n');
await writeFile(resolve(root, 'docs/rendering-coverage.md'), renderingCoverageMarkdown(inventory));
console.log(`Generated rendering inventory: ${inventory.types.length} types, ${inventory.members.length} members; qualification remains pending.`);
