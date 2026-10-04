/**
 * Differential fixtures for the remaining rules of SF-A02-T49 and SF-A02-T50: where a static type used as a type
 * argument is reported (CS0718), and a returned value of an anonymous function that does not convert (CS1662).
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('csharp2-locations', [
    diag(
      'static-type-arguments-and-anonymous-returns',
      cs`
    using System;
    using System.Collections.Generic;
    static class Util { }
    class Box<T> { }
    delegate Box<Util> Maker(Box<Util> input);
    class Holder
    {
        Box<Util> boxed;
        List<Util> listed;
        Box<Box<Util>> nested;
        Box<Util>[] many;
        Box<Util> Property { get { return null; } }
        static Box<Util> Make() { return null; }
        static void Take(Box<Util> box, int other) { }
        void Body()
        {
            Box<Util> local = null;
            object o = new Box<Util>();
        }
    }
    delegate int Number();
    delegate void Act();
    class Program
    {
        static void Main()
        {
            Number one = delegate { return "text"; };
            Number two = delegate { return; };
            Act three = delegate { return 1; };
            Number four = delegate { if (one == null) return 1; return "x"; };
            Number five = () => "text";
            Func<int> six = delegate { return 1.5; };
            Number seven = delegate { return 1; };
            Func<int, int> eight = x => { if (x > 0) return x; return null; };
        }
    }
    `,
    ),
  ]),
];
