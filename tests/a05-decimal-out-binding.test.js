import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {Builtins, Op} from '@sharpforge/bytecode';

for (const pipeline of ['bound', 'legacy']) {
  test(`Decimal ${pipeline}: top-level out arguments retain their typed address without semantic fallback`, () => {
    const result = compile('decimal parsed;decimal.TryParse("1.20",out parsed);' +
      'Console.WriteLine(decimal.Round(parsed,1));', {pipeline});
    assert(result.success, JSON.stringify(result.diagnostics));
    const code = result.image.methods.flatMap(method => [...method.code]);
    let address = false, parse = false;
    for (let pc = 0; pc < code.length; pc += 3) {
      address ||= code[pc] === Op.ADDRESS;
      parse ||= code[pc] === Op.BUILTIN && Builtins[code[pc + 1]]?.numeric?.name === 'TryParse';
    }
    assert(address && parse);
  });
  test(`Decimal ${pipeline}: out assignment does not precede evaluation of later arguments`, () => {
    assert.equal(compile('decimal parsed;Console.WriteLine(parsed);decimal.TryParse("1",out parsed);', {pipeline}).success, false);
    assert.equal(compile('decimal parsed;decimal.TryParse("1",ref parsed);', {pipeline}).success, false);
  });
}
