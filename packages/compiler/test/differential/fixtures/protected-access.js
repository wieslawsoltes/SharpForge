/**
 * Differential fixtures for SF-A02-T49 (C# 2 accessibility): a protected member reached through a receiver that is
 * not of the accessing class (CS1540), against CS0122 and CS0272 from an unrelated class.
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('protected-access', [
    diag(
      'through-a-base-typed-receiver',
      cs`
    class Base
    {
        protected int Field;
        protected int Value { get { return 1; } set { } }
        public int Mixed { get { return 1; } protected set { } }
        protected void Run() { }
        protected static void Shared() { }
        protected int this[int i] { get { return i; } set { } }
    }
    class Derived : Base
    {
        void Use(Base other, Derived same, Derived2 sibling)
        {
            other.Field = 1;
            other.Value = 2;
            int a = other.Value;
            other.Mixed = 3;
            int read = other.Mixed;
            other.Run();
            int b = other[0];
            same.Field = 1;
            same.Value = 2;
            same.Mixed = 3;
            same.Run();
            int c = same[0];
            sibling.Field = 4;
            sibling.Mixed = 5;
            this.Field = 5;
            base.Mixed = 6;
            base.Run();
            Base.Shared();
        }
    }
    class Derived2 : Derived { }
    class Unrelated
    {
        void Use(Base other, Derived derived)
        {
            other.Field = 1;
            derived.Run();
            other.Mixed = 2;
        }
    }
    class Program
    {
        static void Main() { }
    }
    `,
    ),
  ]),
];
