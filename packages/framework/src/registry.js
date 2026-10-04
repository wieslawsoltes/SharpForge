import {registryAssignable} from './registry-assignability.js';
import {validateRegistry} from './registry-validation.js';
import {normalizeReadonlyFields} from './readonly-fields.js';
/** A closed, versioned ABI. Unlisted members never fall through to host JavaScript. */
export const ABI_VERSION = 1;
export const XAML = 'Microsoft.UI.Xaml.';
export const CONTROLS = XAML + 'Controls.';
export const MEDIA = XAML + 'Media.';
export const TASK = 'System.Threading.Tasks.Task';
export const THREAD = 'System.Threading.Thread';

/** Independent registries keep area registrations transactional and isolated. */
export function createRegistry({reservations=[]}={}) {
const types = new Map();
const aliases = new Map();
  const origins = new Map(), loaded = new Set(); let active = null;
function define(name, options = {}) {
  if (typeof name !== 'string' || !name) throw failure('Invalid type name');
  if (types.has(name)) throw failure('Duplicate type '+name);
  if (Object.hasOwn(options,'name')) throw failure('Type name cannot be overridden');
  const t = {name, base: 'object', properties: {}, events: {}, ...options};
  if (t.fields !== undefined) t.fields = normalizeReadonlyFields(name, t.fields);
  types.set(name, t); aliases.set(name, name);
  const short = name.slice(name.lastIndexOf('.') + 1);
  if (!aliases.has(short)) aliases.set(short, name);
  return t;
}
function canonicalType(type) {
  if (typeof type !== 'string') return type;
  // Compiler/metadata descriptors already contain canonical registered names.
  if (types.has(type)) return type;
  if (type.endsWith('[]')) return canonicalType(type.slice(0, -2)) + '[]';
  const collection = /^(?:System\.Collections\.Generic\.)?(List|Dictionary|HashSet|Queue|Stack|IComparer)(?:`[12])?\s*<(.+)>$/.exec(type);
  if(collection){const args=collection[2].split(',').map(x=>canonicalType(x.trim()));return 'System.Collections.Generic.'+collection[1]+'`'+args.length+'<'+args.join(', ')+'>';}
  const vector=/^(?:System\.Numerics\.)?Vector(?:`1)?\s*<(.+)>$/.exec(type);if(vector)return 'System.Numerics.Vector`1<'+canonicalType(vector[1].trim())+'>';
  const task = /^(?:System\.Threading\.Tasks\.)?Task(?:`1)?\s*<(.+)>$/.exec(type);
  if (task) return TASK + '`1<' + canonicalType(task[1].trim()) + '>';
  const action = /^(?:System\.)?(Action|Func)(?:`[12])?\s*<(.+)>$/.exec(type);
  if (action) { const args = action[2].split(',').map(x => canonicalType(x.trim())); return 'System.' + action[1] + '`' + args.length + '<' + args.join(', ') + '>'; }
  return aliases.get(type) ?? type;
}
function frameworkType(type) { return types.get(type) ?? types.get(canonicalType(type)) ?? null; }
function frameworkAssignable(target, source) {
  return registryAssignable(types, canonicalType, target, source);
}
function taskResult(type) {
  type = canonicalType(type);
  return type === TASK ? 'void' : type?.startsWith(TASK + '`1<') && type.endsWith('>') ? type.slice(TASK.length + 3, -1) : null;
}
const contracts = [];
const memberIndex = new Map();
function member(owner, name, parameters, result, {isStatic = false, kind = 'method', ...extra} = {}) {
  if (!Array.isArray(parameters) || parameters.some(t=>typeof t!=='string'||!t) || typeof name!=='string'||!name || typeof result!=='string'||!result) throw failure('Malformed member');
  if (['id','owner','name','parameters','result'].some(key=>Object.hasOwn(extra,key))) throw failure('Reserved member field override');
  owner = canonicalType(owner); parameters = Object.freeze(parameters.map(canonicalType)); result = canonicalType(result);
  if (!types.has(owner)) throw failure('Undefined owner '+owner);
  if ((memberIndex.get(owner+'::'+name)??[]).some(d=>JSON.stringify(d.parameters)===JSON.stringify(parameters))) throw failure('Duplicate member '+owner+'::'+name+'('+parameters.join(',')+')');
  if (!active) throw failure('Members require an ID reservation');
  if (active.next>=active.start+active.size) throw failure('Reserved ID block overflow');
  const d = Object.freeze({id: active.next++, owner, name, parameters, result, isStatic, kind, ...extra});
  contracts.push(d); origins.set(d.id,active.name);
  const key = owner + '::' + name;
  if (!memberIndex.has(key)) memberIndex.set(key, []);
  memberIndex.get(key).push(d); return d;
}
function ctor(type, parameters = []) { return member(type, '.ctor', parameters, type, {kind: 'constructor'}); }
function prop(type, name, valueType, value = null, readOnly = false, isStatic = false) {
  const t = types.get(canonicalType(type)); if(!t)throw failure('Property on undefined type '+type); if(Object.hasOwn(t.properties,name))throw failure('Duplicate property '+type+'::'+name); t.properties[name] = {type: canonicalType(valueType), value, readOnly, isStatic};
  const get = member(type, 'get_' + name, [], valueType, {kind: 'get', isStatic, property: name});
  const set = readOnly ? null : member(type, 'set_' + name, [valueType], 'void', {kind: 'set', isStatic, property: name});
  return {get, set};
}
function event(type, name, delegate = XAML + 'RoutedEventHandler') {
  if(!types.has(type))throw failure('Event on undefined type '+type);
  if(Object.hasOwn(types.get(type).events,name))throw failure('Duplicate event '+type+'::'+name);
  types.get(type).events[name] = delegate;
  member(type, 'add_' + name, [delegate], 'void', {kind: 'eventAdd', event: name});
  member(type, 'remove_' + name, [delegate], 'void', {kind: 'eventRemove', event: name});
}
function en(name, values) { return define(name, {kind: 'enum', values, base: 'System.Enum'}); }
function delegate(name, parameters, result = 'void') {
  define(name, {kind: 'delegate', parameters: parameters.map(canonicalType), result: canonicalType(result), base: 'System.MulticastDelegate'});
  ctor(name, ['object', 'nint']); member(name, 'Invoke', parameters, result);
}
function control(name, base = 'Control', props = {}, events = []) {
  name = CONTROLS + name; define(name, {base: base.includes('.') ? base : CONTROLS + base, kind: 'control'}); ctor(name);
  for (const [key, v] of Object.entries(props)) prop(name, key, ...(Array.isArray(v) ? v : [v]));
  for (const key of events) event(name, key); return name;
}

  function failure(message){return new Error(`[${active?.name??'registry'}] ${message}`);}
  const blocks = new Map();
  for(const block of reservations){
    if(!block||typeof block.name!=='string'||!block.name||blocks.has(block.name)||!Number.isSafeInteger(block.start)||block.start<0||!Number.isSafeInteger(block.size)||block.size<1||block.start+block.size>0x7fffffff)throw new TypeError('Invalid ID reservation');
    for(const other of blocks.values())if(block.start<other.start+other.size&&other.start<block.start+block.size)throw new Error('Overlapping ID reservations');
    blocks.set(block.name,Object.freeze({...block}));
  }
  function registerAll(contributions,{signal}={}){
    signal?.throwIfAborted();
    if(active)throw failure('Nested registration is not supported');
    const before={types:new Map([...types].map(([k,t])=>[k,{...t,properties:{...t.properties},events:{...t.events}}])),aliases:new Map(aliases),contracts:[...contracts],members:new Map([...memberIndex].map(([k,v])=>[k,[...v]])),origins:new Map(origins),loaded:new Set(loaded)};
    try{
      for(const contribution of contributions){
        signal?.throwIfAborted();
        const block=blocks.get(contribution?.name);active={...block,name:contribution?.name,next:block?.start};
        if(!block||typeof contribution.register!=='function')throw failure('Unknown reservation or malformed contribution');
        if(loaded.has(contribution.name))throw failure('Duplicate contribution');
        if(block.legacy&&contracts.length!==block.start)throw failure('Released contribution order changed at id '+contracts.length);
        const value=contribution.register(api);if(value?.then)throw failure('Contribution must be synchronous');
        loaded.add(contribution.name);
      }
      signal?.throwIfAborted();validateRegistry({types,contracts,origins});contracts.sort((a,b)=>a.id-b.id);
    }catch(error){
      for(const [target,source]of [[types,before.types],[aliases,before.aliases],[memberIndex,before.members],[origins,before.origins]]){target.clear();for(const [k,v]of source)target.set(k,v);}
      contracts.splice(0,contracts.length,...before.contracts);loaded.clear();for(const name of before.loaded)loaded.add(name);
      throw error;
    }finally{active=null;}
    return api;
  }
  const api={types,aliases,contracts,memberIndex,origins,canonicalType,frameworkType,frameworkAssignable,taskResult,define,member,ctor,prop,event,en,delegate,control,XAML,CONTROLS,MEDIA,TASK,THREAD,registerAll,register:contribution=>registerAll([contribution]),validate:()=>validateRegistry({types,contracts,origins})};
  return api;
}
