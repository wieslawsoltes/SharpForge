/**
 * Differential fixtures for where a diagnostic is reported (SF-A02-T07, SF-A02-T09, SF-A02-B01): the argument count
 * of a delegate invocation on the invoked expression, the argument count of a library method on the member name, and
 * the 'async function' gate on the name of a method but on the keyword of a lambda or anonymous method.
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = feature('diagnostic-spans', [
  diag(
    'cs1593-cs7036-delegate-invocation',
    cs`
      using System;
      class H
      {
          public Func<int, int> F = x => x;
          public Func<int, int> G() => F;
          public Func<int, int>[] A = new Func<int, int>[1];
      }
      static class P
      {
          static void Main()
          {
              Func<int, int> f = x => x;
              var h = new H();
              Console.WriteLine(f(1, 2));
              Console.WriteLine(f());
              Console.WriteLine(h.F(1, 2));
              Console.WriteLine(h.G()(1, 2));
              Console.WriteLine(h.A[0](1, 2));
          }
      }
    `,
  ),
  diag(
    'cs1501-library-method-name',
    cs`
      using System;
      Console.WriteLine("abc".Substring(1, 2, 3));
      Console.WriteLine("abc".Substring());
    `,
  ),
  diag(
    'cs8025-async-forms-at-4',
    cs`
      using System;
      using System.Threading.Tasks;
      class Program
      {
          static async Task M() { }
          public static async void N() { }
          static async Task<int> G<T>(T t) { return 1; }
          static void Main()
          {
              Func<Task> f = async () => { };
              Func<int, Task> g = async x => { };
              Func<Task> h = async delegate { };
          }
      }
    `,
    { langVersion: '4' },
  ),
  diag(
    'cs8370-discard-pattern-at-7-3',
    cs`
      class Program
      {
          static string M(int n) => n switch { 1 => "one", 2 => "two", _ => "other" };
          static bool N(object o) => o is string { Length: 1 };
          static void Main() { }
      }
    `,
    { langVersion: '7.3' },
  ),
  diag(
    'cs0246-dynamic-at-3',
    cs`
      class Program
      {
          static dynamic M(dynamic d) { return d; }
          static void Main() { dynamic d = 1; object o = d; }
      }
    `,
    { langVersion: '3' },
  ),
]);
