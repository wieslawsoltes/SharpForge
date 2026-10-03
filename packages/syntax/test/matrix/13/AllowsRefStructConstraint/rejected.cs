// langversion 12: expect CS9202 at 43 "ref struct"
class C
{
    void M<T>() where T : allows ref struct { }
}
