import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {encode} from './value-codec.js';
const root=new URL('../../../planning/contracts/fixtures/value-abi/',import.meta.url);
export function expandFixture(fixture){return fixture.expand?{abiVersion:1,epoch:1,slots:[{kind:'ref',value:{h:1,g:1}}],handles:[{h:1,g:1,kind:'array',type:'object[]',data:Array(fixture.expand.length).fill(fixture.expand.element)}]}:fixture.document;}
if(process.argv[1]===fileURLToPath(import.meta.url))for(const name of readdirSync(root).filter(n=>n.endsWith('.json'))){const path=new URL(name,root),fixture=JSON.parse(readFileSync(path));if(fixture.error||!fixture.document&&!fixture.expand)continue;const bytes=Buffer.from(encode(expandFixture(fixture))),expected=fixture.expand?createHash('sha256').update(bytes).digest('hex'):bytes.toString('hex'),key=fixture.expand?'encodedSha256':'encodedHex';if(process.argv.includes('--check')){if(fixture[key]!==expected)throw new Error('Value fixture byte drift '+name);}else{fixture[key]=expected;writeFileSync(path,JSON.stringify(fixture,null,2)+'\n');}}
