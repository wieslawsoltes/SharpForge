using System;
using System.Collections.Generic;

namespace StressDispose
{
    public sealed class Res : IDisposable
    {
        private readonly List<string> log;
        public string Name { get; }
        public bool Disposed { get; private set; }

        public Res(string name, List<string> log)
        {
            Name = name;
            this.log = log;
            if (name.StartsWith("bad", StringComparison.Ordinal)) throw new InvalidOperationException("cannot open " + name);
            log.Add("+" + name);
        }

        public void Dispose()
        {
            if (Disposed) { log.Add("again:" + Name); return; }
            Disposed = true;
            log.Add("-" + Name);
        }
    }

    public struct Meter : IDisposable
    {
        private readonly List<string> log;
        public int Uses;
        public Meter(List<string> log) { this.log = log; Uses = 0; }
        public void Touch() => Uses++;
        public void Dispose() { log.Add("meter:" + Uses); Uses = -1; }
    }

    public ref struct Indent
    {
        private readonly List<string> log;
        private readonly Span<int> depth;
        public Indent(List<string> log, Span<int> depth)
        {
            this.log = log;
            this.depth = depth;
            depth[0]++;
            log.Add("in" + depth[0]);
        }
        public void Dispose() { log.Add("out" + depth[0]); depth[0]--; }
    }

    public static class Program
    {
        private static readonly List<string> log = new List<string>();

        private static string Drain() { string text = string.Join(" ", log); log.Clear(); return text; }
        private static int Mark(string text) { log.Add(text); return text.Length; }
        private static bool Note(string text) { log.Add(text); return true; }
        private static Res Pick(bool create, string name) => create ? new Res(name, log) : null;

        private static int EarlyReturn(int n)
        {
            using var a = new Res("a", log);
            if (n == 0) return Mark("ret0");
            using var b = new Res("b", log);
            if (n == 1) return Mark("return1");
            using (var c = new Res("c", log))
            {
                if (n == 2) return Mark("return-two") + (c.Disposed ? 1000 : 0);
            }
            log.Add("tail:" + a.Disposed + b.Disposed);
            return n * 10;
        }

        private static int Loop()
        {
            int sum = 0;
            for (int i = 0; i < 6; i++)
            {
                using var r = new Res("r" + i, log);
                if (i == 1) continue;
                if (i == 4) break;
                using (new Res("x" + i, log))
                {
                    if (i == 3) goto skip;
                    sum += i;
                }
                log.Add("after" + i);
            skip:
                sum += 100;
            }
            return sum;
        }

        private static void Failing()
        {
            using (Res first = new Res("f1", log), second = new Res("f2", log))
            using (var third = new Res("bad3", log))
            {
                log.Add("body " + first.Name + second.Name + third.Name);
            }
        }

        private static string Classify(int code)
        {
            switch (code)
            {
                case 1: { using var r = new Res("one", log); return r.Name.ToUpperInvariant(); }
                case 2:
                    using (var r = new Res("two", log)) { if (r.Name.Length == code + 1) break; }
                    return "long-name";
                default: return "other";
            }
            return "after-switch";
        }

        public static int Main()
        {
            for (int n = 0; n < 4; n++)
            {
                int result = EarlyReturn(n);
                Console.WriteLine("early(" + n + ")=" + result + " : " + Drain());
            }
            Console.WriteLine("loop=" + Loop() + " : " + Drain());

            try { Failing(); }
            catch (InvalidOperationException e) { log.Add("caught[" + e.Message + "]"); }
            Console.WriteLine(Drain());

            using (var meter = new Meter(log)) { meter.Touch(); meter.Touch(); log.Add("uses=" + meter.Uses); }
            Meter outside = new Meter(log);
            outside.Touch();
            using (outside) { outside.Touch(); outside.Touch(); }
            Console.WriteLine(Drain() + " | outside.Uses=" + outside.Uses);

            Span<int> depth = stackalloc int[1];
            using (var one = new Indent(log, depth))
            {
                using var two = new Indent(log, depth);
                log.Add("depth=" + depth[0]);
            }
            Console.WriteLine(Drain() + " | depth=" + depth[0]);

            Res none = null;
            using (none) { log.Add("null-ok"); }
            using (Pick(false, "p0")) using (Pick(true, "p1")) { log.Add("body"); }
            using (IDisposable d = Pick(true, "p2")) { log.Add(d is Res res ? "is:" + res.Name : "not-res"); }
            var twice = new Res("t", log);
            using (twice) using (twice) { log.Add("twice"); }
            Console.WriteLine(Drain());

            try
            {
                using var outer = new Res("outer", log);
                try
                {
                    using var inner = new Res("inner", log);
                    throw new ApplicationException("boom");
                }
                finally { log.Add("finally(outer.Disposed=" + outer.Disposed + ")"); }
            }
            catch (ApplicationException e) when (Note("filter:" + e.Message)) { log.Add("handled"); }
            Console.WriteLine(Drain());

            for (int code = 1; code <= 3; code++) Console.WriteLine("classify(" + code + ")=" + Classify(code) + " : " + Drain());

            var stack = new Stack<Res>();
            try
            {
                foreach (string name in new[] { "s1", "s2", "bad-s3", "s4" }) stack.Push(new Res(name, log));
            }
            catch (InvalidOperationException) { log.Add("partial=" + stack.Count); }
            finally
            {
                while (stack.Count > 0) using (stack.Pop()) { }
            }
            Console.WriteLine(Drain());
            return log.Count;
        }
    }
}
