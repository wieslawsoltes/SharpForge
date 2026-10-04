import {internString,isInternedString,referenceEquals,stringChar} from '../strings.js';
import {enumHasFlag} from '../enums.js';
import {objectType,typeName} from '../tokens.js';

function stringIntern(vm,args) { return internString(vm,args[0]); }
function stringIsInterned(vm,args) { return isInternedString(vm,args[0]); }
function stringCharacter(vm,args) { return stringChar(vm,args[0],args[1]); }
function objectGetType(vm,args) { return objectType(vm,args[0]); }
function typeSimpleName(vm,args) {
  const text=typeName(vm,args[0],false);
  return text===null?null:vm.heap.string(text);
}
function typeFullName(vm,args) {
  const text=typeName(vm,args[0],true);
  return text===null?null:vm.heap.string(text);
}
function objectReferenceEquals(vm,args) { return referenceEquals(args[0],args[1]); }
function enumFlag(vm,args) { return enumHasFlag(vm,args[0],args[1]); }
function objectNew(vm) { return vm.heap.object('System.Object',[]); }
function exceptionNew(vm,args) { return vm.heap.allocate('exception','Exception',[args[0]]); }
function exceptionMessage(vm,args) { return vm.heap.get(args[0]).data[0]; }

export const objectBuiltins=Object.freeze({
  'string.Intern':stringIntern,
  'string.IsInterned':stringIsInterned,
  'string.get_Chars':stringCharacter,
  'object.GetType':objectGetType,
  'Type.Name':typeSimpleName,
  'Type.FullName':typeFullName,
  'object.ReferenceEquals':objectReferenceEquals,
  'Enum.HasFlag':enumFlag,
  'object.new':objectNew,
  'Exception.new':exceptionNew,
  'Exception.Message':exceptionMessage
});
