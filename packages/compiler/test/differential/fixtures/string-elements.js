/**
 * The elements of a string (SF-A02-T46): `s[i]` and `foreach (char c in s)` read UTF-16 code units as `char` values.
 * Both lower onto the runtime's `string.get_Chars` intrinsic (lowering/string-elements.js).
 */
import { cs, out, feature } from './kit.js';

const list = [
  out(
    'index-reads-code-units',
    cs`
    using System;
    class Program {
      static char At(string text, int index) { return text[index]; }
      static void Main() {
        string s = "héllo";
        Console.WriteLine(s[1]);
        Console.WriteLine(s[0] == 'h');
        Console.WriteLine(s[^1]);
        Console.WriteLine((int)s[1]);
        Console.WriteLine(s[2] + 1);
        char first = s[0];
        first++;
        Console.WriteLine(first);
        Console.WriteLine("" + s[4] + s[3]);
        Console.WriteLine(At("abc", s.Length - 3));
        int sum = 0;
        for (int i = 0; i < s.Length; i++) sum += s[i];
        Console.WriteLine(sum);
      }
    }
  `,
  ),
  out(
    'foreach-over-a-string',
    cs`
    using System;
    using System.Collections.Generic;
    class Program {
      static int evaluations;
      static string Text() { evaluations++; return "a-b-c"; }
      static IEnumerable<int> Codes(string text) { foreach (char c in text) yield return c; }
      static void Main() {
        int dashes = 0;
        string reversed = "";
        foreach (char c in Text()) {
          if (c == '-') { dashes++; continue; }
          reversed = c + reversed;
        }
        Console.WriteLine(dashes + " " + reversed + " " + evaluations);
        foreach (var c in "ab") Console.WriteLine(c + 1);
        foreach (int code in "A") Console.WriteLine(code);
        foreach (char c in "xyz") { if (c == 'y') break; Console.WriteLine(c); }
        foreach (char c in "") Console.WriteLine("never");
        foreach (int code in Codes("xy")) Console.WriteLine(code);
        int total = 0;
        foreach (char c in "12") { Func<int> read = () => c - '0'; total += read(); }
        Console.WriteLine(total);
      }
    }
  `,
  ),
  out(
    'out-of-range-and-null-throw',
    cs`
    using System;
    class Program {
      static void Main() {
        string s = "ab";
        try { Console.WriteLine(s[2]); } catch (Exception) { Console.WriteLine("range"); }
        try { Console.WriteLine(s[-1]); } catch (Exception) { Console.WriteLine("negative"); }
        string none = null;
        try { Console.WriteLine(none[0]); } catch (Exception) { Console.WriteLine("null element"); }
        try { foreach (char c in none) Console.WriteLine(c); } catch (Exception) { Console.WriteLine("null loop"); }
        Console.WriteLine(s[1]);
      }
    }
  `,
  ),
];

export const fixtures = feature('string-elements', list);
