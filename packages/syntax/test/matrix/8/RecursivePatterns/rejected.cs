// langversion 7.3: expect CS8370 at 51 "{"
class C
{
    void M()
    {
        bool b = o is { Length: 1 };
    }
}
