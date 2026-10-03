import test from 'node:test';
import {numericDifferential} from './support/numeric-differential.js';

const cases = [
  ['long carry', 'long x=int.MaxValue;x++;Console.WriteLine(x);', '2147483648\n'],
  ['uint wrap', 'uint x=4294967295U;x=unchecked(x+1U);Console.WriteLine(x);', '0\n'],
  ['ulong division', 'ulong x=18446744073709551615UL;Console.WriteLine(x/3UL);', '6148914691236517205\n'],
  ['small narrowing', 'int x=65535;short a=unchecked((short)x);byte b=unchecked((byte)x);' +
    'sbyte c=unchecked((sbyte)x);ushort d=unchecked((ushort)x);' +
    'Console.WriteLine(a);Console.WriteLine(b);Console.WriteLine(c);Console.WriteLine(d);', '-1\n255\n-1\n65535\n'],
  ['char storage', 'char letter=(char)65;Console.WriteLine(letter);Console.WriteLine((int)letter);', 'A\n65\n'],
  ['float precision', 'float x=16777216F;Console.WriteLine(x+1F);', '16777216\n'],
  ['decimal scale', 'decimal x=1.10M;Console.WriteLine(x+0.20M);', '1.30\n'],
];

for (const [family, source, expected] of cases) {
  test(`T01.8 shared scalar modes: ${family}`, () => numericDifferential(source, expected, {family}));
}
