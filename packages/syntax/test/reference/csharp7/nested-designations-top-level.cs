(var x, var (y, z)) = t;
(int a, var (b, c)) = (1, (2, 3));
var (d, (e, f)) = t;
for ((var g, var (h, i)) = t; ; ) { }
System.Action l = () => { (var m, var (n, o)) = t; };
if (t is (var p, var (q, r))) { }
var s = t switch { (var u, var (v, w)) => 1 };
(var x2, var (y2, z2), var (a2, (b2, c2))) = t;
((var d2, var (e2, f2)), var g2) = t;
