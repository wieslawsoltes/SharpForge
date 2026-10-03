export function registerCoreSystem({define,member,ctor,prop,event,en,control,delegate,types,aliases,XAML,CONTROLS,MEDIA,TASK,THREAD}) {
define('SharpForge.Runtime.Async',{kind:'static'});
// Managed cooperative concurrency contracts. These are logical contexts, not OS threads.
delegate('System.Action',[]);
for(const r of ['int','double','bool','string','object'])delegate('System.Func`1<'+r+'>',[],r);
delegate('System.Threading.ThreadStart',[]);
define(THREAD,{kind:'thread'});ctor(THREAD,['System.Threading.ThreadStart']);prop(THREAD,'Name','string','');prop(THREAD,'ManagedThreadId','int',0,true);prop(THREAD,'IsAlive','bool',false,true);prop(THREAD,'CurrentThread',THREAD,null,true,true);member(THREAD,'Start',[],'void');member(THREAD,'Join',[],'void');member(THREAD,'Sleep',['int'],'void',{isStatic:true});member(THREAD,'Yield',[],'bool',{isStatic:true});
for(const r of ['void','int','double','bool','string','object']){
  const t=r==='void'?TASK:TASK+'`1<'+r+'>';define(t,{kind:'task',result:r,base:r==='void'?'object':TASK});
  prop(t,'Id','int',0,true);prop(t,'IsCompleted','bool',false,true);prop(t,'IsFaulted','bool',false,true);prop(t,'IsCanceled','bool',false,true);if(r!=='void')prop(t,'Result',r,null,true);
  member(t,'Wait',[],'void');
  // Await is a private ABI intrinsic emitted for the restricted async lowering.
  member('SharpForge.Runtime.Async','Await',[t],r,{isStatic:true,kind:'await'});
  member('SharpForge.Runtime.Async','Start',[r==='void'?'System.Action':'System.Func`1<'+r+'>'],t,{isStatic:true,kind:'startTask'});
}
member(TASK,'Delay',['int'],TASK,{isStatic:true});member(TASK,'Yield',[],TASK,{isStatic:true});prop(TASK,'CompletedTask',TASK,null,true,true);
member(TASK,'Run',['System.Action'],TASK,{isStatic:true,kind:'startTask'});
for(const r of ['int','double','bool','string','object'])member(TASK,'Run',['System.Func`1<'+r+'>'],TASK+'`1<'+r+'>',{isStatic:true,kind:'startTask'});
member(TASK,'WhenAll',[TASK+'[]'],TASK,{isStatic:true});member(TASK,'WhenAny',[TASK+'[]'],TASK+'`1<object>',{isStatic:true});
member(TASK,'FromResult',['int'],TASK+'`1<int>',{isStatic:true});member(TASK,'FromResult',['string'],TASK+'`1<string>',{isStatic:true});

}
