import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { DebugSession } from '@sharpforge/debugger';
import { verifyImage } from '@sharpforge/bytecode';
export function image(source) {
  const result=compile(source);
  assert.equal(result.success,true,result.diagnostics.map(d=>`${d.uri}:${d.range.start.line+1} ${d.code}: ${d.message}`).join('\n'));
  const errors=verifyImage(result.image);
  assert.equal(errors.length,0,JSON.stringify(errors));return result.image;
}
export function execute(source,options={}) { return new VirtualMachine(image(source),options).run(); }
export function output(source,expected) {const result=execute(source);assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,expected);return result;}
export function debug(source,options={}) {return new DebugSession(image(source),options);}
export function stop(session,mode) {if(mode)session.resume(mode);return session.runUntilStop();}
