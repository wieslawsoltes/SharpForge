import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector} from '@sharpforge/cil';

// Package imports and benchmark bytes must come from this helper's own checkout.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
if (process.argv[2] && resolve(process.argv[2]) !== resolve(root)) {
  throw new Error('Run the inspection helper inside the inspected worktree');
}
const source = readFileSync(resolve(root, 'scripts/benchmark-release14.js'), 'utf8');
const workloads = [...source.matchAll(/\b(dictionary|list|queue|builder):`([^`]*)`/g)];
if (workloads.length !== 4) throw new Error('Unexpected unchanged benchmark workload definitions');
const hash = value => createHash('sha256').update(JSON.stringify(value,
  (_, item) => typeof item === 'bigint' ? item.toString() + 'n' : item)).digest('hex');
const results = [];
for (const [, name, body] of workloads) {
  const result = compileToIL('using System;using System.Collections.Generic;using System.Text;' + body);
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  const inspector = new AssemblyInspector(result.assembly);
  const sourceMethods = result.image.methods.map(method => ({name: method.name, owner: method.owner,
    instructions: method.code.length / 3, codeHash: hash(method.code), locals: method.locals.length}));
  const cilMethods = [...inspector.methods.values()].map(definition => {
    const method = inspector.getMethod(definition.token);
    return {name: method.name, owner: method.owner, codeSize: method.codeSize,
      instructions: method.instructions.length, instructionHash: hash(method.instructions
        .map(instruction => [instruction.name, instruction.operandKind, instruction.operand])),
      localCount: method.locals.length, handlerCount: method.handlers.length};
  });
  results.push({name, sourceMethods, cilMethods, sourceMethodsHash: hash(sourceMethods),
    cilMethodsHash: hash(cilMethods), propertyRows: inspector.metadata.rows[23]?.length ?? 0,
    methodSemanticsRows: inspector.metadata.rows[24]?.length ?? 0,
    hasExternalReferences: result.image.externalReferences !== undefined,
    qualifiedSourceTypes: result.image.types.filter(type => type.assemblyKey).length,
    peBytes: result.assembly.length, debugBytes: inspector.metadata.streams.get('#SF')?.length ?? 0});
}
console.log(JSON.stringify({node: process.version, runtimeExecuted: false, results}, null, 2));
