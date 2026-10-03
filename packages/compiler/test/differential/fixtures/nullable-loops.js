/**
 * Differential fixtures for the nullable walker's loop fixed point (SF-A02-T05.4): an assignment later in a loop
 * body changes the null-state at the top of the next iteration, so CS8602 is expected on a dereference that is
 * safe on the first pass. Every form of loop and of jump back to the head is covered, plus programs whose loops
 * must stay free of warnings.
 */
import { cs, out, diag, feature } from './kit.js';

const helpers = `
          static string? Maybe(int i) => i > 2 ? null : "x";
          static void Main() { }`;

export const fixtures = feature('nullable-loops', [
  diag(
    'cs8602-while-assigns-null-later',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static void Direct(bool c)
          {
              string? s = "a";
              while (c)
              {
                  Console.WriteLine(s.Length);
                  s = null;
              }
          }
          static void Conditional(int n)
          {
              string? s = "a";
              int i = 0;
              while (i < n)
              {
                  Console.WriteLine(s.Length);
                  if (i == 3) s = Maybe(i);
                  i++;
              }
              Console.WriteLine(s.Length);
          }
${helpers}
      }
    `,
  ),
  diag(
    'cs8602-do-while',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static void Do(int n)
          {
              string? s = "a";
              do
              {
                  Console.WriteLine(s.Length);
                  s = Maybe(n);
                  n--;
              } while (n > 0);
          }
          static void DoContinue(int n)
          {
              string? s = "a";
              do
              {
                  Console.WriteLine(s.Length);
                  if (n == 2) { s = null; continue; }
                  s = "c";
              } while (--n > 0);
              Console.WriteLine(s.Length);
          }
${helpers}
      }
    `,
  ),
  diag(
    'cs8602-for-body-and-incrementor',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static void Body(int n)
          {
              string? s = "a";
              for (int i = 0; i < n; i++)
              {
                  Console.WriteLine(s.Length);
                  s = Maybe(i);
              }
          }
          static void Incrementor(int n)
          {
              string? s = "a";
              for (int i = 0; i < n; s = Maybe(i), i++)
              {
                  Console.WriteLine(s.Length);
              }
          }
          static void Infinite()
          {
              string? s = "a";
              for (;;)
              {
                  Console.WriteLine(s.Length);
                  s = null;
                  if (s == null) break;
              }
          }
${helpers}
      }
    `,
  ),
  diag(
    'cs8602-foreach',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static void ForEach(int[] items)
          {
              string? s = "a";
              foreach (var item in items)
              {
                  Console.WriteLine(s.Length);
                  s = Maybe(item);
              }
              Console.WriteLine(s.Length);
          }
${helpers}
      }
    `,
  ),
  diag(
    'cs8602-continue-and-break',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static void Continue(int n)
          {
              string? s = "a";
              for (int i = 0; i < n; i++)
              {
                  Console.WriteLine(s.Length);
                  if (i == 1) { s = null; continue; }
                  s = "b";
              }
          }
          static void Break(int n)
          {
              string? s = "a";
              while (true)
              {
                  if (n-- < 0) { s = null; break; }
                  Console.WriteLine(s.Length);
              }
              Console.WriteLine(s.Length);
          }
          static void InnerBreak(int n)
          {
              string? s = "a";
              for (int i = 0; i < n; i++)
              {
                  while (true)
                  {
                      if (i > 1) { s = null; break; }
                      break;
                  }
                  Console.WriteLine(s.Length);
                  s = "z";
              }
          }
${helpers}
      }
    `,
  ),
  diag(
    'cs8602-nested-loops',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static void Nested(int n)
          {
              string? s = "a";
              for (int i = 0; i < n; i++)
              {
                  for (int j = 0; j < n; j++)
                  {
                      Console.WriteLine(s.Length);
                  }
                  s = Maybe(i);
              }
          }
          static void TwoVariables(int n)
          {
              string? a = "a";
              string? b = "b";
              for (int i = 0; i < n; i++)
              {
                  Console.WriteLine(a.Length + b.Length);
                  a = b;
                  b = Maybe(i);
              }
          }
${helpers}
      }
    `,
  ),
  diag(
    'cs8602-switch-and-try-in-loop',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static void SwitchInLoop(int n)
          {
              string? s = "a";
              while (n-- > 0)
              {
                  Console.WriteLine(s.Length);
                  switch (n)
                  {
                      case 1: s = null; break;
                      case 2: s = "b"; break;
                      default: break;
                  }
              }
          }
          static void TryInLoop(int n)
          {
              string? s = "a";
              while (n-- > 0)
              {
                  try { Console.WriteLine(s.Length); s = Maybe(n); }
                  catch (Exception) { s = null; }
              }
          }
${helpers}
      }
    `,
  ),
  diag(
    'cs8602-after-null-terminated-walk',
    cs`
      #nullable enable
      using System;
      class Node { public Node? Next; public string Name = ""; }
      static class P
      {
          static void Walk(Node head)
          {
              Node? current = head;
              while (current != null)
              {
                  Console.WriteLine(current.Name);
                  current = current.Next;
              }
              Console.WriteLine(current.Name);
          }
          static void Parameter(string? p, int n)
          {
              if (p == null) return;
              while (n-- > 0)
              {
                  Console.WriteLine(p.Length);
                  p = Maybe(n);
              }
          }
${helpers}
      }
    `,
  ),
  out(
    'valid-loops-keep-not-null-state',
    cs`
      #nullable enable
      using System;
      class Node
      {
          public Node? Next;
          public string Name;
          public Node(string name, Node? next) { Name = name; Next = next; }
      }
      static class P
      {
          static string? Maybe(int i) => i > 2 ? null : "x";
          static int Walk(Node head)
          {
              int total = 0;
              for (Node? current = head; current != null; current = current.Next) total += current.Name.Length;
              return total;
          }
          static string UntilFound(int n)
          {
              string? s = null;
              while (s == null) { s = Maybe(n--); }
              return s;
          }
          static int Guarded(int n)
          {
              string? s = null;
              int total = 0;
              while (n-- > 0)
              {
                  if (s != null) total += s.Length;
                  s = Maybe(n);
              }
              return total;
          }
          static int Reassigned(int n)
          {
              string? t = "a";
              int total = 0;
              do
              {
                  total += t.Length;
                  t = "bb";
              } while (n-- > 0);
              foreach (var c in "xyz") { total += t.Length + c; t = "c"; }
              return total + t.Length;
          }
          static void Main()
          {
              var list = new Node("ab", new Node("cde", null));
              Console.WriteLine(Walk(list) + " " + UntilFound(5) + " " + Guarded(6) + " " + Reassigned(2));
          }
      }
    `,
  ),
]);
