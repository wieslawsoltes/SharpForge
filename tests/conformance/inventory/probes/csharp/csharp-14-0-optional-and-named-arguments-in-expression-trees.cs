class C { static int F(int x=1) => x; System.Linq.Expressions.Expression<System.Func<int>> E = () => F(x:2); }
