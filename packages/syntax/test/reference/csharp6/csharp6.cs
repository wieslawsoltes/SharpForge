using static System.Math;
using static System.Console;
using static global::System.Linq.Enumerable;
using static A.B<int>.C;
namespace N
{
    using static System.String;
    class C
    {
        void M()
        {
            try { }
            catch (System.Exception e) when (e.Message != null) { }
            catch (System.IO.IOException) when (F()) { }
            catch when (true) { }
            catch (E e) when (e is A || e is B) { throw; }
            finally { }
            var a = new Dictionary<string, int> { ["a"] = 1, ["b"] = 2 };
            var b = new T { [0] = 1, [1, 2] = { X = 1 }, P = { [0] = 2 }, Q = 3 };
            var c = new T { [0] = { 1, 2 }, [1] = new U { [2] = 3 } };
            var d = new T { [x: 1] = 2, [ref y] = 3 };
            var n = nameof(M);
            var m = nameof(System.Console.WriteLine);
            var o = nameof(List<int>.Count);
            int nameof = 1;
            var when = 1;
            when = when + 1;
        }
        int nameof(int x) { return x; }
        int when;
    }
}
