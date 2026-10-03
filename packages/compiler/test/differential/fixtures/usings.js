/**
 * Differential fixtures for using directives and qualified names (SF-A02-T24): namespaces that do not exist
 * (CS0246, CS0234) at compilation-unit and namespace level, in aliases and in qualified type names; namespaces of
 * the base class library that the framework registry does not model (no diagnostic); `using` of a type (CS0138),
 * `using static` of a namespace (CS7007); duplicate aliases (CS1537), aliases that conflict with a declaration
 * (CS0576) and unknown alias qualifiers (CS0432).
 */
import { cs, out, diag, feature } from './kit.js';

const main = 'static void Main() { System.Console.WriteLine("ok"); }';

export const fixtures = feature('namespaces', [
  out(
    'using-bcl-namespaces-outside-the-registry',
    cs`
      using System.Xml;
      using System.Reflection;
      using System.Runtime.InteropServices;
      using System.Security.Cryptography;
      using Microsoft.Win32;
      class Program { ${main} }
    `,
  ),
  diag(
    'cs0234-using-unknown-system-namespace',
    cs`
      using System.Nope;
      class Program { ${main} }
    `,
  ),
  diag(
    'cs0234-using-unknown-nested-namespace',
    cs`
      using System.Collections.Nope;
      using System.Text.Missing.Deeper;
      class Program { ${main} }
    `,
  ),
  diag(
    'cs0234-using-unknown-microsoft-namespace',
    cs`
      using Microsoft.Nope;
      class Program { ${main} }
    `,
  ),
  diag(
    'cs0246-using-unknown-root-with-members',
    cs`
      using Nope.Deeper.Still;
      class Program { ${main} }
    `,
  ),
  diag(
    'cs0234-using-inside-namespace',
    cs`
      namespace App
      {
          using System.Nope;
          using Missing;
          class Program { ${main} }
      }
    `,
  ),
  diag(
    'cs0234-using-static-unknown',
    cs`
      using static System.Nope;
      using static Missing.Type;
      class Program { ${main} }
    `,
  ),
  diag(
    'cs0234-alias-to-unknown',
    cs`
      using A = System.Nope.Thing;
      using B = Missing;
      class Program { ${main} }
    `,
  ),
  diag(
    'cs0234-qualified-type-names',
    cs`
      class Program
      {
          static void Main()
          {
              System.Nope.Thing a = null;
              Missing.Thing b = null;
              object o = a;
              o = b;
          }
      }
    `,
  ),
  diag(
    'cs0234-qualified-name-in-source-namespace',
    cs`
      namespace App.Models { class Item { } }
      class Program
      {
          static void Main()
          {
              App.Models.Item item = new App.Models.Item();
              App.Models.Missing other = null;
              App.Views.Item view = null;
              object o = item;
              o = other;
              o = view;
          }
      }
    `,
  ),
  diag(
    'cs0234-qualified-name-through-alias',
    cs`
      using Models = App.Models;
      namespace App.Models { class Item { } }
      class Program
      {
          static void Main()
          {
              Models.Item item = new Models.Item();
              Models.Missing other = null;
              object o = item;
              o = other;
          }
      }
    `,
  ),
  diag(
    'cs0138-using-a-type',
    cs`
      using System.Console;
      using App.Item;
      namespace App { class Item { } }
      class Program { ${main} }
    `,
  ),
  diag(
    'cs7007-using-static-a-namespace',
    cs`
      using static System;
      using static App;
      namespace App { class Item { } }
      class Program { ${main} }
    `,
  ),
  diag(
    'cs1537-duplicate-alias',
    cs`
      using A = System.Console;
      using A = System.Math;
      class Program { static void Main() { A.WriteLine("ok"); } }
    `,
  ),
  diag(
    'cs0576-alias-conflicts-with-type',
    cs`
      using Item = System.Console;
      class Item { }
      class Program
      {
          static void Main()
          {
              Item item = null;
              object o = item;
          }
      }
    `,
  ),
  diag(
    'cs0576-alias-conflicts-with-namespace',
    cs`
      using App = System.Console;
      namespace App { class Item { } }
      class Program
      {
          static void Main()
          {
              App.Item item = null;
              object o = item;
          }
      }
    `,
  ),
  diag(
    'cs0432-unknown-alias-qualifier',
    cs`
      using T = System.Text;
      class Program
      {
          static void Main()
          {
              T::StringBuilder builder = new T::StringBuilder();
              Nope::Thing thing = null;
              object o = builder;
              o = thing;
          }
      }
    `,
  ),
  diag(
    'cs0431-alias-qualifier-names-a-type',
    cs`
      using C = System.Console;
      class Program
      {
          static void Main()
          {
              C::WriteLine("ok");
          }
      }
    `,
  ),
  diag(
    'cs0105-duplicate-using-static-and-alias',
    cs`
      using System;
      using static System.Math;
      using static System.Math;
      using S = System;
      using System;
      class Program { static void Main() { Console.WriteLine(Max(1, 2)); } }
    `,
  ),
  out(
    'alias-and-namespace-of-the-same-target',
    cs`
      using System;
      using Text = System.Text;
      using Builder = System.Text.StringBuilder;
      class Program
      {
          static void Main()
          {
              Text.StringBuilder a = new Text.StringBuilder("a");
              Builder b = new Builder("b");
              global::System.Console.WriteLine(a.ToString() + b.ToString());
          }
      }
    `,
  ),
]);
