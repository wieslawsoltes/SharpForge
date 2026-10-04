import {DiagnosticId} from './diagnostics/codes.js';
import {canonicalType,taskResult,TASK} from '@sharpforge/framework';
import {diagnostic} from '@sharpforge/text';
import {formatMessage} from './diagnostics/codes.js';
/**
 * Lower a bounded Task async profile to explicit delegate capture + verified calls
 * into the SharpForge continuation ABI. This is NOT Roslyn/CLR state-machine IL.
 * Locals/operand stacks are retained by the cooperative managed scheduler.
 */
export function lowerAsyncFiles(files) {
  let ordinal=0;
  return files.map(file=>{
    const generated=[],diagnostics=[...file.diagnostics];
    const lower=(method,owner)=>{
      if(method.kind!=='Method'||!method.modifiers.includes('async'))return [method];
      const returnType=canonicalType(method.returnType),result=returnType==='void'?'void':taskResult(returnType);
      if(result===null){diagnostics.push(diagnostic(file.source,method.start,Math.max(1,method.end-method.start),DiagnosticId.CS1983,formatMessage(DiagnosticId.CS1983)));return [method];}
      const id=ordinal++,closure=`<>AsyncCapture${id}`,bodyName=`<>AsyncBody${id}_${method.name}`,origin=(owner?owner+'.':'')+method.name;
      const N=(kind,extra={})=>({kind,uri:method.uri,start:method.start,end:method.end,debugHidden:true,...extra});
      const name=n=>N('Name',{name:n}),member=(target,n)=>N('Member',{target,name:n});
      const call=(target,args=[])=>N('Call',{target,args});
      const expression=e=>N('ExpressionStatement',{expression:e});
      const assign=(left,right)=>N('Assignment',{operator:'=',left,right});
      const isStatic=method.modifiers.includes('static')||!owner;
      const fields=method.parameters.map((p,i)=>N('Field',{name:`arg${i}`,type:p.type,modifiers:['public'],initializer:null}));
      if(!isStatic)fields.unshift(N('Field',{name:'receiver',type:owner,modifiers:['public'],initializer:null}));
      const invokeTarget=isStatic?(owner?member(name(owner),bodyName):name(bodyName)):member(member(name('this'),'receiver'),bodyName);
      const invokeExpr=call(invokeTarget,method.parameters.map((p,i)=>member(name('this'),`arg${i}`)));
      const invoke=N('Method',{name:'Invoke',returnType:result,parameters:[],modifiers:['public'],generated:true,asyncOrigin:origin,asyncRole:'capture',body:N('Block',{statements:[result==='void'?expression(invokeExpr):N('Return',{expression:invokeExpr})]})});
      generated.push(N('Class',{name:closure,namespace:method.namespace??'',modifiers:['internal'],members:[...fields,invoke],interfaces:[],generated:true}));
      const local=N('Local',{declarations:[N('VariableDeclarator',{name:'<>capture',type:closure,hidden:true,initializer:N('New',{type:closure,args:[],initializers:[]})})]});
      const statements=[local];if(!isStatic)statements.push(expression(assign(member(name('<>capture'),'receiver'),name('this'))));
      method.parameters.forEach((p,i)=>statements.push(expression(assign(member(name('<>capture'),`arg${i}`),name(p.name)))));
      const start=call(member(name('SharpForge.Runtime.Async'),'Start'),[member(name('<>capture'),'Invoke')]);
      statements.push(returnType==='void'?expression(start):N('Return',{expression:start}));
      const wrapper={...method,parameters:method.parameters.map(p=>({...p,debugHidden:true})),modifiers:method.modifiers.filter(m=>m!=='async'),asyncOrigin:origin,asyncRole:'kickoff',body:N('Block',{statements})};
      const body={...method,name:bodyName,returnType:result,modifiers:method.modifiers.filter(m=>m!=='async'),generated:true,asyncBody:true,asyncOrigin:origin,asyncRole:'body'};
      return [wrapper,body];
    };
    const members=file.root.members.flatMap(member=>member.kind==='Class'?[{...member,members:member.members.flatMap(m=>lower(m,member.name))}]:lower(member,null));
    return {...file,diagnostics,root:{...file.root,members:[...members,...generated]}};
  });
}
