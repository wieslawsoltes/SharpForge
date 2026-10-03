// Small independently authored CIL library; no compiler or #SF stream.
import {mkdir,writeFile} from 'node:fs/promises';
import {arithmeticLibrary} from '../tests/managed-fixtures.js';
import {formatILDocument} from '../packages/cil/src/index.js';
const directory=new URL('../examples/managed/',import.meta.url);await mkdir(directory,{recursive:true});const bytes=arithmeticLibrary();
await writeFile(new URL('Arithmetic.dll',directory),bytes);await writeFile(new URL('Arithmetic.sf.il',directory),formatILDocument(bytes));console.log(`Wrote ${bytes.length} bytes of managed CIL and editable text`);
// Compiler-produced ordinary executable (no #SF), distinct from hand-authored Arithmetic.dll.
const {compileToIL}=await import('../packages/compiler/src/index.js');
const result=compileToIL('Console.WriteLine("Hello from an ordinary managed EXE");',{name:'Hello',includeDebug:false});
if(!result.success)throw new Error(JSON.stringify(result.diagnostics));
await writeFile(new URL('Hello.exe',directory),result.assembly);
await writeFile(new URL('Hello.sf.il',directory),formatILDocument(result.assembly));
// No #SF: primitive addresses and boxing, designed for instruction debugging.
const {managedFixture}=await import('../tests/managed-fixtures.js');
const pointers=managedFixture({name:'PrimitiveAddresses',methods:[{name:'Main',result:'int',locals:['object','int','int'],body:(w,c)=>w.op('ldc.i4',42).op('box',c.resolve('System.Int32')).op('stloc.0').op('ldloc.0').op('unbox',c.resolve('System.Int32')).op('call',c.member('System.GC','Collect','void')).op('ldc.i4',48).op('stind.i4').op('ldloc.0').op('unbox.any',c.resolve('System.Int32')).op('stloc.1').op('ldloca.s',2).op('ldloca.s',1).op('cpobj',c.resolve('System.Int32')).op('ldloc.2').op('sizeof',c.resolve('System.Int32')).op('add').op('ret')}]});
await writeFile(new URL('PrimitiveAddresses.exe',directory),pointers);await writeFile(new URL('PrimitiveAddresses.sf.il',directory),formatILDocument(pointers));
const {readFile}=await import('node:fs/promises');
const feature=compileToIL(await readFile(new URL('../examples/features-0.5/finally.cs',import.meta.url),'utf8'),{name:'Finally',includeDebug:false});if(!feature.success)throw new Error(JSON.stringify(feature.diagnostics));
await writeFile(new URL('Finally.exe',directory),feature.assembly);await writeFile(new URL('Finally.sf.il',directory),formatILDocument(feature.assembly));
// Independently hand-authored storage writes without #SF: step/watch/reverse this real EXE.
const storage=managedFixture({name:'StorageWrites',methods:[{name:'Main',result:'int',locals:['int[]','int'],body:(w,c)=>w.op('ldc.i4.2').op('newarr',c.resolve('System.Int32')).op('stloc.0').op('ldc.i4',40).op('stloc.1').op('ldloc.0').op('ldc.i4.0').op('ldloc.1').op('stelem.i4').op('call',c.member('System.GC','Collect','void')).op('ldloc.0').op('ldc.i4.1').op('ldloc.0').op('ldc.i4.0').op('ldelem.i4').op('ldc.i4.2').op('add').op('stelem.i4').op('ldloc.0').op('ldc.i4.1').op('ldelem.i4').op('ret')}]});
await writeFile(new URL('StorageWrites.exe',directory),storage);await writeFile(new URL('StorageWrites.sf.il',directory),formatILDocument(storage));
const using=compileToIL(await readFile(new URL('../examples/features-0.6/using-resources.cs',import.meta.url),'utf8'),{name:'UsingResources',includeDebug:false});if(!using.success)throw new Error(JSON.stringify(using.diagnostics));await writeFile(new URL('UsingResources.exe',directory),using.assembly);await writeFile(new URL('UsingResources.sf.il',directory),formatILDocument(using.assembly));
