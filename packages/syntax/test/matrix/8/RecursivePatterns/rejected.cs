// langversion 7.3: expect CS8370 at 51 "{ Length: 1 }"
class C
{
    void M()
    {
        bool b = o is { Length: 1 };
    }
}
