export const cases = [
  { name: 'TryInFinally', expected: '3\n', source: `
    int x=0;
    try { x=1; }
    finally { try { throw new Exception("x"); } catch(Exception e) { x+=2; } }
    Console.WriteLine(x);` },
  { name: 'FinallyInCatch', expected: '5\n', source: `
    int x=0;
    try { throw new Exception("x"); }
    catch(Exception e) { try { x=2; } finally { x+=3; } }
    Console.WriteLine(x);` },
  { name: 'ThreeLevels', expected: '15\n', source: `
    int x=0;
    try { try { x=1; } finally { try { x+=2; } finally { x+=4; } } }
    finally { x+=8; }
    Console.WriteLine(x);` },
  { name: 'NestedRethrow', expected: 'inner\n', source: `
    try { try { throw new Exception("inner"); } catch(Exception e) { throw; } }
    catch(Exception e) { Console.WriteLine(e.Message); }` },
];
