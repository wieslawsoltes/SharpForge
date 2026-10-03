/** Explicit closed BCL surface; registrations append, never renumber older ABI members. */
export function registerBcl({define, member, ctor, prop}) {
  const scalar = ['int', 'double', 'bool', 'string', 'object'];
  const sb = 'System.Text.StringBuilder';
  define(sb, {kind: 'bcl', family: 'builder'});
  for (const p of [[], ['int'], ['string'], ['string','int']]) ctor(sb,p);
  prop(sb,'Length','int',0); prop(sb,'Capacity','int',16); prop(sb,'MaxCapacity','int',1048576,true);
  for (const t of scalar) member(sb,'Append',[t],sb);
  for (const p of [[],['string']]) member(sb,'AppendLine',p,sb);
  for (const [name,p,r] of [['Clear',[],sb],['ToString',[],'string'],['ToString',['int','int'],'string'],['Insert',['int','string'],sb],['Remove',['int','int'],sb],['Replace',['string','string'],sb],['EnsureCapacity',['int'],'int']]) member(sb,name,p,r);
  for(let n=1;n<=3;n++) member(sb,'AppendFormat',['string',...Array(n).fill('object')],sb);

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
  define('System.String',{kind:'bcl',family:'string'});
  prop('System.String','Empty','string','',true,true);
  for(const [m,p,r,stat] of [
    ['IsNullOrEmpty',['string'],'bool',true],['IsNullOrWhiteSpace',['string'],'bool',true],
    ['Concat',['string','string'],'string',true],['Concat',['string[]'],'string',true],
    ['Join',['string','string[]'],'string',true],['Join',['string','int[]'],'string',true],
    ['Equals',['string','string'],'bool',true],['CompareOrdinal',['string','string'],'int',true],
    ['ToString',[],'string',false],['Substring',['int'],'string',false],['Substring',['int','int'],'string',false],
    ['Contains',['string'],'bool',false],['IndexOf',['string'],'int',false],['IndexOf',['string','int'],'int',false],
    ['LastIndexOf',['string'],'int',false],['StartsWith',['string'],'bool',false],['EndsWith',['string'],'bool',false],
    ['Trim',[],'string',false],['TrimStart',[],'string',false],['TrimEnd',[],'string',false],
    ['ToUpperInvariant',[],'string',false],['ToLowerInvariant',[],'string',false],
    ['ToUpper',[],'string',false],['ToLower',[],'string',false],['Replace',['string','string'],'string',false],
    ['Split',['string'],'string[]',false],['Split',['string','int'],'string[]',false],
    ['PadLeft',['int'],'string',false],['PadRight',['int'],'string',false],
    ['Remove',['int'],'string',false],['Remove',['int','int'],'string',false],['Insert',['int','string'],'string',false]
  ])member('System.String',m,p,r,{isStatic:stat});
  prop('System.String','Length','int',0,true);
  for(let n=1;n<=4;n++)member('System.String','Format',['string',...Array(n).fill('object')],'string',{isStatic:true});
  member('System.String','Format',['string','object[]'],'string',{isStatic:true});
  // Compiler-generated format call keeps the primitive type (boxing bool on both engines).
  define('SharpForge.Runtime.Formatting',{kind:'bcl',family:'format'});
  member('SharpForge.Runtime.Formatting','BoxValue',['object','string'],'object',{isStatic:true});
  member('SharpForge.Runtime.Formatting','FormatValue',['object','string','int','string'],'string',{isStatic:true});
  define('System.Math',{kind:'bcl',family:'math'});
  for(const m of ['Sin','Cos','Tan','Asin','Acos','Atan','Log','Log10','Exp','Truncate'])member('System.Math',m,['double'],'double',{isStatic:true});
  member('System.Math','Atan2',['double','double'],'double',{isStatic:true});
  for(const t of ['int','double'])member('System.Math','Clamp',[t,t,t],t,{isStatic:true});
  prop('System.Math','PI','double',Math.PI,true,true);prop('System.Math','E','double',Math.E,true,true);
}
