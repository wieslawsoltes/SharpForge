import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  Compilation
} from '@sharpforge/compiler';
import {
  parse
} from '@sharpforge/syntax';
import {
  SourceText
} from '@sharpforge/text';
import {
  Op
} from '@sharpforge/bytecode';
import {
  BoundTreeRewriter
} from '../packages/compiler/src/bound/rewriter.js';

const source = `class P {
  static bool Accept(Exception error, int value) { return error.Message == "saved" && value == 2; }
  static void Main() {
    int value = 1;
    try { throw new Exception("saved"); }
    catch (Exception error) when (Accept(error, value = 2)) { Console.WriteLine(value); }
    catch (Exception error) { Console.WriteLine(error.Message); }
  }
}`;

for (const pipeline of ['legacy', 'bound']) {
  test(`T04 ${pipeline}: filtered catch emits initialized typed local and explicit body boundaries`, () => {
    const result = compile(source, {
      pipeline
    });
    assert(result.success, JSON.stringify(result.diagnostics));
    const method = result.image.methods.find(item => item.name === 'Main');
    const [filtered, fallback] = method.handlers;
    assert.equal(filtered.type, 'System.Exception');
    assert.equal(fallback.type, 'System.Exception');
    assert(Number.isInteger(filtered.filter) && filtered.filter < filtered.target);
    assert.equal(method.code[(filtered.target - 1) * 3], Op.ENDFILTER);
    assert.equal(filtered.handlerEnd, fallback.target);
    assert(filtered.handlerEnd > filtered.target && fallback.handlerEnd > fallback.target);
    assert.equal(method.locals[filtered.slot].name, 'error');
  });
}

test('T04 filter-local assignment is part of bound definite-assignment flow', () => {
  const valid = 'int value;try{throw new Exception("x");}catch(Exception e) when((value=7)==7){Console.WriteLine(value);}';
  const invalid = 'int value;try{throw new Exception("x");}catch(Exception e) when(value==7){Console.WriteLine(1);}';
  assert.equal(compile(valid).success, true);
  assert(compile(invalid).diagnostics.some(item => item.code === 'CS0165'));
});

test('T04 bound-tree visitors retain and rewrite the filter expression', () => {
  const compilation = new Compilation([parse(new SourceText(source, 'Program.cs'))], {
    pipeline: 'bound'
  });
  const result = compilation.build();
  assert(result.success, JSON.stringify(result.diagnostics));
  const roots = compilation.boundPipeline.units.map(unit => unit.body).filter(Boolean);

  function catchBlock(node) {
    if (node.kind === 'CatchBlock' && node.filter) return node;
    for (const child of node.children ?? []) {
      const found = catchBlock(child);
      if (found) return found;
    }
    return null;
  }
  const clause = roots.map(catchBlock).find(Boolean);
  assert(clause);
  const seen = [];
  class FilterVisitor extends BoundTreeRewriter {
    visit(node) {
      if (node) seen.push(node);
      return super.visit(node);
    }
  }
  assert.equal(new FilterVisitor().visit(clause), clause);
  assert(seen.includes(clause.filter));
  assert.equal(clause.children[0], clause.filter);
});
