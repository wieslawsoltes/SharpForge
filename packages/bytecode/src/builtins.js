import {createBuiltinTable} from './builtin-table.js';
import {createBuiltinRegistry as createRegistry} from './builtin-registry.js';
import {contracts,contributionManifest} from '@sharpforge/framework';
export const definitions = Object.freeze( [
 ['Console.WriteLine',0,1,'void',['any']],['Console.Write',1,1,'void',['any']],
 ['Math.Abs',1,1,'numeric',['number']],['Math.Min',2,2,'numeric',['number','number']],['Math.Max',2,2,'numeric',['number','number']],
 ['Math.Pow',2,2,'double',['number','number']],['Math.Sqrt',1,1,'double',['number']],['Math.Floor',1,1,'double',['number']],['Math.Ceiling',1,1,'double',['number']],['Math.Round',1,1,'double',['number']],
 ['GC.Collect',0,0,'void',[]],['GC.GetTotalMemory',0,1,'long',['bool']],['GC.CollectionCount',1,1,'int',['int']],
 ['int.Parse',1,1,'int',['string']],['double.Parse',1,1,'double',['string']],['Convert.ToInt32',1,1,'int',['any']],['Convert.ToDouble',1,1,'double',['any']],['Convert.ToString',1,1,'string',['any']],
 ['string.Concat',2,2,'string',['string','string']],['string.IsNullOrEmpty',1,1,'bool',['string']],
 ['Array.Reverse',1,1,'void',['array']],['Array.Sort',1,1,'void',['array']],
 ['string.Substring',2,3,'string',['string','int','int']],['string.Contains',2,2,'bool',['string','string']],['string.IndexOf',2,2,'int',['string','string']],
 ['string.StartsWith',2,2,'bool',['string','string']],['string.EndsWith',2,2,'bool',['string','string']],['string.ToUpper',1,1,'string',['string']],['string.ToLower',1,1,'string',['string']],['string.Trim',1,1,'string',['string']],['string.Replace',3,3,'string',['string','string','string']],
 ['object.ToString',1,1,'string',['any']],['Exception.Message',1,1,'string',['exception']],['Exception.new',1,1,'Exception',['string']],
 ['Debug.Assert',1,2,'void',['bool','string']],['Environment.TickCount',0,0,'int',[]],['$Math.Abs.Int32',1,1,'int',['int']]
].map(d=>Object.freeze([d[0],d[1],d[2],d[3],Object.freeze(d[4])])));
export const CONTRACT_BUILTIN_OFFSET=definitions.length;
// The released runtime table remains a frozen array on the VM's hot dispatch path.
export const Builtins=createBuiltinTable(definitions,contracts,contributionManifest);
export const frameworkBuiltin = contract=>contract?Builtins[CONTRACT_BUILTIN_OFFSET+contract.id]:null;
export const BuiltinMap = new Map(Builtins.filter(Boolean).map(b=>[b.name,b]));

/** Contributions append after the released table; its contract offset never moves. */
export function createBuiltinRegistry(base=Builtins){
  return createRegistry(base,base===Builtins);
}
