// langversion 9: expect CS8773 at 56 ":"
class C
{
    void M()
    {
        bool b = o is { A.B: 1 };
    }
}
