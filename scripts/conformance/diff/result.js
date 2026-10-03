export function result(engine,fields={}){return {engine,status:'completed',phase:'execute',stdout:'',stderr:'',exitCode:0,exception:null,diagnostics:[],artifactHash:null,metrics:{},...fields};}
export function failure(engine,error,phase='host'){
  const status=['cancelled','budget-exceeded'].includes(error.code)?error.code:/cancelled/i.test(error.message)?'cancelled':/timed out|output limit/i.test(error.message)?'budget-exceeded':'host-error';
  return result(engine,{status,phase,stdout:error.result?.stdout??'',stderr:error.result?.stderr??'',exitCode:null,error:error.message,metrics:{elapsedMs:error.result?.elapsedMs??null}});
}
export function unsupported(engine,reason){return result(engine,{status:'unsupported',phase:'host',exitCode:null,reason});}
