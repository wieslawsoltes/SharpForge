/**
 * Differential fixtures for SF-A02-T50 (C# 2 type modifiers): static classes, partial types and the accessibility
 * of property accessors.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('type-modifiers', [
    out(
      'static-class-and-partial-type',
      cs`
    using System;
    static class Counter
    {
        static int count;
        public const int Step = 2;
        public static int Next()
        {
            count += Step;
            return count;
        }
        public static int Count { get { return count; } }
    }
    partial class Account
    {
        int balance;
        public Account(int opening) { balance = opening; }
    }
    partial class Account
    {
        public int Balance { get { return balance; } private set { balance = value; } }
        public void Deposit(int amount) { Balance = Balance + amount; }
    }
    class Program
    {
        static void Main()
        {
            Counter.Next();
            Console.WriteLine(Counter.Next() + Counter.Count);
            Account account = new Account(10);
            account.Deposit(5);
            Console.WriteLine(account.Balance);
        }
    }
  `,
    ),
    diag(
      'static-class-members',
      cs`
    static class Tools
    {
        int field;
        static int shared;
        void Method() { }
        int Property { get { return 0; } }
        public Tools() { }
        static Tools() { shared = 1; }
        ~Tools() { }
        public int this[int index] { get { return index; } }
        public static Tools operator +(Tools left, Tools right) { return left; }
        protected static void Hidden() { }
        class Nested { int ok; }
        const int Limit = 1;
    }
  `,
    ),
    diag(
      'static-class-declaration',
      cs`
    interface IMarker { }
    class Base { }
    static class FromBase : Base { }
    static class WithInterface : IMarker { }
    static class FromObject : object { }
    abstract static class AbstractStatic { }
    sealed static class SealedStatic { }
    static class Root { }
    class Derived : Root { }
    static struct Value { }
    static interface IStatic { }
  `,
    ),
    diag(
      'static-class-as-a-type',
      cs`
    using System.Collections.Generic;
    static class Tools { public static int Zero; }
    class Holder<T> { }
    class Program
    {
        Tools field;
        Tools[] array;
        Tools Property { get { return null; } }
        Tools Method(Tools parameter) { return parameter; }
        static void Constrained<T>() where T : Tools { }
        static void Main()
        {
            Tools local = null;
            object boxed = new Tools();
            object cast = (Tools)boxed;
            bool test = boxed is Tools;
            object viaAs = boxed as Tools;
            System.Type type = typeof(Tools);
            List<Tools> list = null;
            int size = Tools.Zero;
        }
    }
  `,
    ),
    diag(
      'partial-declarations',
      cs`
    partial class Mixed { }
    class Mixed { }
    partial class Kinds { }
    partial struct Kinds { }
    public partial class Access { }
    internal partial class Access { }
    partial class Bases : System.Exception { }
    partial class Bases : System.Attribute { }
    abstract partial class Flags { }
    sealed partial class Flags { }
    partial class Generic<T> where T : class { }
    partial class Generic<T> where T : struct { }
    partial class Names<T> { }
    partial class Names<U> { }
    partial class Fine { int a; }
    partial class Fine { int a; int b; }
  `,
    ),
    diag(
      'partial-modifier-position',
      cs`
    partial public class Wrong { }
    public partial class Right { }
    partial enum Color { Red }
    partial delegate void Callback();
    class Outer
    {
        partial class Inner { }
        partial class Inner { }
        partial int field;
    }
  `,
    ),
    diag(
      'accessor-accessibility',
      cs`
    interface IShape
    {
        int Sides { get; private set; }
    }
    abstract class Shape
    {
        public int Width { get; private set; }
        public int Both { private get; private set; }
        private int Wider { public get; set; }
        public int Same { public get; set; }
        protected int Sideways { get; internal set; }
        protected internal int Narrowed { get; protected set; }
        public int GetOnly { private get { return 0; } }
        public abstract int Hidden { get; private set; }
        public abstract int Visible { get; set; }
        public virtual int Overridable { get; protected set; }
        public int this[int index] { get { return index; } protected set { } }
    }
    class Square : Shape
    {
        public override int Visible { get { return 0; } set { } }
        public override int Overridable { get { return 0; } set { } }
    }
  `,
    ),
    diag(
      'accessor-accessibility-at-use',
      cs`
    class Account
    {
        public int Balance { get; private set; }
        public int Secret { private get; set; }
        public int Family { get; protected set; }
        public int this[int index] { get { return index; } private set { } }
        public void Reset() { Balance = 0; Secret = Secret + 1; this[0] = 1; }
    }
    class Savings : Account
    {
        void Touch(Account other)
        {
            Family = 1;
            Balance = 3;
        }
    }
    class Program
    {
        static void Main()
        {
            Account account = new Account();
            account.Balance = 1;
            account.Balance += 1;
            account.Balance++;
            int read = account.Secret;
            account.Secret = read;
            account[0] = account[1];
            account.Family = 2;
        }
    }
  `,
    ),
  ]),
];
