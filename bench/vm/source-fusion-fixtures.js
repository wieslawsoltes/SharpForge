export const sourceFusionFixtures = Object.freeze([
  {id: 'integer-loop', expected: '704982704\n', source: `class Program {
    static void Main() { int sum = 0; for (int i = 0; i < 100000; i++) sum += i; Console.WriteLine(sum); }
  }`},
  {id: 'fibonacci', expected: '6765\n', source: `class Program {
    static int Fib(int n) { if (n < 2) return n; return Fib(n - 1) + Fib(n - 2); }
    static void Main() { Console.WriteLine(Fib(20)); }
  }`}
]);
