/**
 * Differential fixtures for SF-A02-T79: collection expression targets that are framework collections without a
 * one-argument `Add` (dictionaries). `[]` creates the collection; elements have no `Add` to go through (CS9215).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('collection-expression-targets', [
  out(
    'empty-dictionary',
    cs`
      using System;
      using System.Collections.Generic;
      interface IMarker { }
      class Program
      {
          static int Count(Dictionary<string, int> d) => d.Count;
          static void Main()
          {
              Dictionary<string, int> d = [];
              d.Add("a", 1);
              Console.WriteLine(d.Count);
              Console.WriteLine(Count([]));
              d = [];
              Console.WriteLine(d.Count);
          }
      }
    `,
  ),
  diag(
    'cs9215-dictionary-elements',
    cs`
      using System.Collections.Generic;
      class Program
      {
          static void Main()
          {
              Dictionary<string, int> one = [new KeyValuePair<string, int>("a", 1)];
              Dictionary<string, int> spread = [..one];
          }
      }
    `,
  ),
]);
