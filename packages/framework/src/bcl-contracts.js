import {registerBclModules} from '@sharpforge/bcl-core';
/** Explicit closed BCL surface; registrations append, never renumber older ABI members. */
export function registerBcl(registry) {
  const {define, member, ctor, prop} = registry;
  const scalar = ['int', 'double', 'bool', 'string', 'object'];
  registerBclModules(registry, {group: 'bcl-prefix'});

  for (const t of scalar) {
    const enumerator=`SharpForge.Runtime.Enumerator\`1<${t}>`;
    define(enumerator,{kind:'bcl',family:'enumerator',element:t});
    member(enumerator,'MoveNext',[],'bool');prop(enumerator,'Current',t,null,true);member(enumerator,'Dispose',[],'void');
    for (const family of ['List','HashSet','Queue','Stack']) {
      const name=`System.Collections.Generic.${family}\`1<${t}>`;
      define(name,{kind:'bcl',family,element:t});
      for (const p of [[],['int'],[t+'[]']]) ctor(name,p);
      prop(name,'Count','int',0,true); if(family==='List')prop(name,'Capacity','int',0);
      for(const [m,p,r]of [['Clear',[],'void'],['Contains',[t],'bool'],['ToArray',[],t+'[]'],['GetEnumerator',[],enumerator]])member(name,m,p,r);
      if(family==='List')for(const [m,p,r]of [['Add',[t],'void'],['AddRange',[t+'[]'],'void'],['Insert',['int',t],'void'],['Remove',[t],'bool'],['RemoveAt',['int'],'void'],['RemoveRange',['int','int'],'void'],['IndexOf',[t],'int'],['get_Item',['int'],t],['set_Item',['int',t],'void'],['Reverse',[],'void'],['Sort',[],'void']])member(name,m,p,r);
      if(family==='HashSet')for(const [m,p,r]of [['Add',[t],'bool'],['Remove',[t],'bool'],['UnionWith',[t+'[]'],'void'],['IntersectWith',[t+'[]'],'void'],['ExceptWith',[t+'[]'],'void']])member(name,m,p,r);
      if(family==='Queue')for(const [m,p,r]of [['Enqueue',[t],'void'],['Dequeue',[],t],['Peek',[],t]])member(name,m,p,r);
      if(family==='Stack')for(const [m,p,r]of [['Push',[t],'void'],['Pop',[],t],['Peek',[],t]])member(name,m,p,r);
    }
    for(const key of ['string','int']){
      const name=`System.Collections.Generic.Dictionary\`2<${key}, ${t}>`;
      define(name,{kind:'bcl',family:'Dictionary',key,element:t});ctor(name);ctor(name,['int']);
      prop(name,'Count','int',0,true);prop(name,'Keys',key+'[]',null,true);prop(name,'Values',t+'[]',null,true);
      for(const [m,p,r]of [['Add',[key,t],'void'],['TryAdd',[key,t],'bool'],['ContainsKey',[key],'bool'],['ContainsValue',[t],'bool'],['Remove',[key],'bool'],['Clear',[],'void'],['get_Item',[key],t],['set_Item',[key,t],'void']])member(name,m,p,r);
    }
  }
  registerBclModules(registry, {group: 'bcl-suffix'});
  define('System.Math',{kind:'bcl',family:'math'});
  for(const m of ['Sin','Cos','Tan','Asin','Acos','Atan','Log','Log10','Exp','Truncate'])member('System.Math',m,['double'],'double',{isStatic:true});
  member('System.Math','Atan2',['double','double'],'double',{isStatic:true});
  for(const t of ['int','double'])member('System.Math','Clamp',[t,t,t],t,{isStatic:true});
  prop('System.Math','PI','double',Math.PI,true,true);prop('System.Math','E','double',Math.E,true,true);
}
