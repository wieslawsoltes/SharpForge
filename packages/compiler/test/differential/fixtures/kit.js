/**
 * Fixture authoring helpers for the Roslyn differential harness (SF-A02-T40).
 *
 * A fixture is `{id,feature,kind,langVersion?,allowUnsafe?,source}`: `kind` is 'output' (Roslyn compiles it without
 * errors and its stdout is pinned) or 'diagnostics' (Roslyn reports at least one error or warning that is pinned). The
 * source text is exactly what both compilers see, so diagnostic offsets are comparable. `allowUnsafe: true` compiles
 * the fixture with /unsafe on both sides (it is part of the fixture's hash, like the language version).
 * `referencesOnly: true` marks a program that needs the real base class library: it runs on the real-.NET axis
 * (tools/dotnet-axis.mjs, bound against reference assemblies) and is unsupported on the registry-bound axes.
 */

/** Tagged template for C# source: raw text (backslashes are literal), common indentation removed, '\n' line ends. */
export function cs(strings,...values){
  const lines=String.raw(strings,...values).replace(/\r\n?/g,'\n').split('\n');
  if(lines.length&&lines[0].trim()==='')lines.shift();if(lines.length&&lines.at(-1).trim()==='')lines.pop();
  const indent=Math.min(...lines.filter(l=>l.trim()).map(l=>l.match(/^ */)[0].length));
  return lines.map(l=>l.slice(Number.isFinite(indent)?indent:0)).join('\n')+'\n';
}
/** A program Roslyn accepts; its standard output is compared on both SharpForge back ends. */
export function out(id,source,options={}){return {id,kind:'output',source,...options};}
/** A program for which Roslyn reports errors and/or warnings; only diagnostics are compared. */
export function diag(id,source,options={}){return {id,kind:'diagnostics',source,...options};}
/** Tag a list of fixtures with a stable feature id; fixture ids become `<feature>/<id>`. */
export function feature(name,list){return list.map(f=>({...f,feature:name,id:name+'/'+f.id}));}
