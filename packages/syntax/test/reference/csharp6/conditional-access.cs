class C
{
    void M()
    {
        var a = x?.y;
        var b = x?.y.z;
        var c = x?.y?.z;
        var d = x?[0];
        var e = x?[0].y;
        var f = x?.y[0];
        var g = x?.y();
        var h = a?.b.c?[i].d();
        var i = x?.y?.z?.w;
        var j = x?.y!.z;
        var k = x?.y<int>();
        var l = x?.y++;
        var m = x?.y ?? z;
        var n = x?.y == null ? 1 : 2;
        var o = (x?.y).z;
        var p = x.y?.z.w;
        var q = x?[0]?[1];
        var r = x?[0, 1]?.y(z?.w);
        var s = x?.y(a)(b)[c].d;
        var t = this?.x;
        var u = base.x?.y;
        var v = x?.y.z?.w.u?[0];
        var w = -x?.y;
        var y = !x?.y;
        var z = await x?.y;
        x?.y();
        x?.Invoke(1);
        x?.y?.z();
        var aa = x ? .5 : 1;
        var ab = x ? [1] : [2];
        var ac = x?.y->z;
        var ad = x?.y!;
        var ae = x?.y is T;
        var af = (int?)x?.y;
        var ag = x?.y.z = 1;
        var ai = x? .y;
        var aj = x ?.y;
        var ak = x?
            .y;
    }
}
