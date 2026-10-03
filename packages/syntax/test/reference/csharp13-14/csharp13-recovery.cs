class C
{
    void A(params) { }
    void B(params params int[] xs) { }
    void M()
    {
        var a = new Buffer { [^] = 1 };
        var b = new Buffer { [^1] = };
    }
    void T<T1>() where T1 : allows { }
    void U<T1>() where T1 : allows ref { }
}
