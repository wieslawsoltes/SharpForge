import {contracts} from '@sharpforge/framework';
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
const builtinEntries=definitions.map(([name,min,max,result,params],id)=>Object.freeze({id,name,min,max,result,params}));
for(const contract of contracts){const id=CONTRACT_BUILTIN_OFFSET+contract.id,count=contract.parameters.length+(!contract.isStatic&&contract.kind!=='constructor'?1:0);builtinEntries[id]=Object.freeze({id,name:'$framework:'+contract.id,min:count,max:count,result:contract.result,params:Object.freeze([...(!contract.isStatic&&contract.kind!=='constructor'?[contract.owner]:[]),...contract.parameters]),contract});}
// Runtime type intrinsics append after existing framework IDs.
const additions=[['string.Intern',1,1,'string',['string']],['string.IsInterned',1,1,'string',['string']],['string.get_Chars',2,2,'int',['string','int']],['object.ReferenceEquals',2,2,'bool',['object','object']],['Enum.HasFlag',2,2,'bool',['any','any']],['object.GetType',1,1,'System.Type',['any']],['Type.Name',1,1,'string',['System.Type']],['Type.FullName',1,1,'string',['System.Type']],...['int','double','bool','long'].map(type=>['$type.'+type+'.GetType',1,1,'System.Type',['any']])];
for(const [name,min,max,result,params] of additions)builtinEntries.push(Object.freeze({id:builtinEntries.length,name,min,max,result,params:Object.freeze(params)}));
// The released runtime table remains a frozen array on the VM's hot dispatch path.
export const Builtins=Object.freeze(builtinEntries);
export const frameworkBuiltin = contract=>contract?Builtins[CONTRACT_BUILTIN_OFFSET+contract.id]:null;
export const BuiltinMap = new Map(Builtins.filter(Boolean).map(b=>[b.name,b]));

/** Contributions append after the released table; its contract offset never moves. */
export function createBuiltinRegistry(base=Builtins){
  const entries=[...base],byName=new Map(entries.filter(Boolean).map(entry=>[entry.name,entry]));
  return {
    get entries(){return Object.freeze([...entries]);},
    get(name){return byName.get(name)??null;},
    register(contribution,{signal}={}){
      signal?.throwIfAborted();
      if(!contribution||typeof contribution.name!=='string'||!Array.isArray(contribution.definitions))throw new TypeError('Malformed builtin contribution');
      const staged=[],names=new Set();
      for(const row of contribution.definitions){
        if(!Array.isArray(row)||row.length!==5)throw new TypeError(`[${contribution.name}] Malformed builtin`);
        const [name,min,max,result,params]=row;
        if(typeof name!=='string'||!name||name.startsWith('$framework:')||byName.has(name)||names.has(name))throw new Error(`[${contribution.name}] Duplicate or reserved builtin ${name}`);
        if(!Number.isSafeInteger(min)||min<0||!Number.isSafeInteger(max)||max<min||typeof result!=='string'||!Array.isArray(params)||max!==params.length||params.some(p=>typeof p!=='string'))throw new TypeError(`[${contribution.name}] Invalid builtin signature`);
        names.add(name);staged.push(Object.freeze({id:entries.length+staged.length,name,min,max,result,params:Object.freeze([...params])}));
      }
      signal?.throwIfAborted();entries.push(...staged);for(const entry of staged)byName.set(entry.name,entry);
      return Object.freeze(staged);
    }
  };
}
