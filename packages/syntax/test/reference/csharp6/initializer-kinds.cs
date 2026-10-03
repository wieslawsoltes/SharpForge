class C
{
    void M()
    {
        var a = new T { [1, 2], [3] };
        var b = new T { X = 1, 2 };
        var c = new T { 1, X = 2 };
        var d = new T { [0] = 1, 2 };
    }
}
