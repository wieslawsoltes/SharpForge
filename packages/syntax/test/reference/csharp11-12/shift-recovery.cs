class C
{
    void M(int a, int b)
    {
        var s1 = a >>> ;
        var s2 = a >> > b;
        var s3 = a > >> b;
        var s4 = a >>>;
        a >>>= ;
        var s5 = a >>>> b;
    }
    public static C operator >>>(C a) => a;
}
