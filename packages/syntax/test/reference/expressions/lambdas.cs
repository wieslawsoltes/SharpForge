class Lambdas
{
    void M()
    {
        var a = (a) => a;
        var b = x => x + 1;
        var c = (int a, int b) => { };
        var d = async x => await x;
        var e = () => 42;
        var f = (x, y) => x * y;
        var g = async () => { await Task.Delay(1); };
        var h = static (int p, ref int q) => p;
        var i = static async x => await x;
        var j = (ref int p, out int q, in int r, params int[] s) => q = p;
        var k = int () => 1;
        var l = List<int> (int n) => new List<int>(n);
        var m = (int p = 1, string s = "x") => p;
        var n = x => y => z => x + y + z;
        var o = (a)(b);
        var p = (a) + b;
        var q = (a, b);
        var r = F(x => x, (y) => y, (int z) => z);
        var s = cond ? x => 1 : y => 2;
        var t = _ => 0;
        var u = (_, _) => 0;
        var v = async => async;
        var w = delegate (int p) { return p; };
        var x = delegate { };
        var y = async delegate (int p, ref string q) { await p; };
        var z = static delegate () { return 1; };
        Action act = delegate { Console.WriteLine(); };
        handler += delegate (object sender, EventArgs args) { };
        var z2 = () => { return 1; };
        var z3 = (x) => ref x;
    }
}
