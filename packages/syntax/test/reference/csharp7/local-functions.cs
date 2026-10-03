class C
{
    void M()
    {
        int Add(int a, int b) { return a + b; }
        int Twice(int a) => a * 2;
        void Nothing() { }
        T Id<T>(T t) where T : class => t;
        async Task Run() { await x; }
        async Task<int> RunValue() => await x;
        unsafe void U(int* p) { }
        static int S(int a) => a;
        static async Task SA() { }
        async static Task AS() { }
        extern static int E(int a);
        static extern int E2(int a);
        [Attr] void WithAttribute() { }
        [Attr, Other(1)][return: R] static int WithAttributes([P] int a) => a;
        System.Collections.Generic.IEnumerable<int> Iter() { yield return 1; }
        (int, int) Tuple() => (1, 2);
        int[] Array() => null;
        int? Nullable() => null;
        N.T<int>.U Qualified() => null;
        ref int Ref() => ref field;
        ref readonly int RefReadonly() => ref field;
        void Outer() { void Inner() { void Innermost() { } } }
        var Var() => 1;
        dynamic Dyn() => 1;
        void Params(params int[] a) { }
        void Defaults(int a = 1, string b = null) { }
        Add(1, 2);
        int x = Add(1, 2);
        Func<int> f = () => { int L() => 1; return L(); };
        List<int> Generic<T, U>(T t, U u) => null;
        int* Pointer() => null;
        unsafe static void US() { }
        static unsafe void SU() { }
        void await() { }
        async async() => default;
    }
    int P { get { int L() => 1; return L(); } }
}
