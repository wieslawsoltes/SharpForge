/** TEST ONLY: the available trimmed .NET 9 WASM runtime has no System.Runtime facade.
 * This standards-based type-forwarder exposes existing CoreLib types; it contains no
 * implementations of the tested code and is never included in application assemblies.
 * Do not deploy this fixture in place of a genuine framework assembly.
 */
import {MetadataBuilder,codedIndex} from '../../packages/cil/src/metadata.js';
import {Writer} from '../../packages/cil/src/binary.js';
import {writePE} from '../../packages/cil/src/pe.js';
export function runtimeFacade(){
 const md=new MetadataBuilder('System.Runtime');md.rows[32][0]=[0x8004,8,0,0,0,0,0,md.string('System.Runtime'),0];
 md.add(2,[0,md.string('<Module>'),0,0,1,1]);
 const asm=md.add(35,[9,0,0,0,0,md.blob(Uint8Array.from([0x7c,0xec,0x85,0xd7,0xbe,0xa7,0x79,0x8e])),md.string('System.Private.CoreLib'),0,0]);
 for(const name of ['Object','String','Int32','Int64','Double','Boolean','Exception','Array','Math','GC','Convert','Environment'])md.add(39,[0x00200000,0,md.string(name),md.string('System'),codedIndex('Implementation',asm)]);
 const section=new Writer().zero(72),metadata=md.finish(null,section.finish());section.bytes(metadata);return writePE(section.finish(),72,metadata.length,0);
}
