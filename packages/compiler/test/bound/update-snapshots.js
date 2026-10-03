#!/usr/bin/env node
/** Regenerates the pinned bound-tree dumps: node packages/compiler/test/bound/update-snapshots.js */
import {writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {boundFixtures,bindFixture} from './fixtures.js';
const snapshots={};
for(const [id,source,options] of boundFixtures){const {diagnostics,methods}=bindFixture(source,options);snapshots[id]={diagnostics,methods:Object.fromEntries(Object.entries(methods).map(([name,dump])=>[name,dump.split('\n')]))};}
writeFileSync(join(dirname(fileURLToPath(import.meta.url)),'snapshots.json'),JSON.stringify(snapshots,null,1)+'\n');
console.log(`Pinned ${Object.keys(snapshots).length} bound-tree snapshots.`);
