class C
{
    void M(int a, int b, uint c)
    {
        var s1 = a >>> b;
        var s2 = a >>> b >>> c;
        var s3 = a >> b >>> c << 1;
        var s4 = a + b >>> c - 1;
        var s5 = a >>> b > c;
        var s6 = a >>> b == c;
        var s7 = (a >>> b) & c;
        a >>>= b;
        a >>>= b >>> 1;
        a >>= b;
        a <<= b;
        var s8 = a >> b;
        var s9 = a << b;
        var t1 = a > > b;
        var t2 = x as List<List<int>>;
        var t3 = new Dictionary<int, List<List<int>>>();
        var t4 = a > b >> 1;
        var t5 = F<A<B<C>>>(1);
        var t6 = a >>> -b;
        var t7 = -a >>> b;
        var t8 = a >>> b ? 1 : 2;
        var t9 = a >>> b ?? c;
    }
    public static C operator >>>(C a, int b) => a;
    public static C operator >>(C a, int b) => a;
    public static C operator <<(C a, int b) => a;
    public static C operator >>>(C a, C b) => a;
    public static C operator >>(C a, C b) => a;
    static C I.operator >>>(C a, int b) => a;
}
