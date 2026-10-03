// langversion 11: expect CS9058 at 46 "params"
class C
{
    void M()
    {
        var f = (params int[] xs) => xs.Length;
    }
}
