// langversion 12: expect CS9202 at 36 "allows"
class C
{
    void M<T>() where T : allows ref struct { }
}
