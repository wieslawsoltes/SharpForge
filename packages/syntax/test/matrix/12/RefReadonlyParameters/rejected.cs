// langversion 11: expect CS9058 at 25 "readonly"
class C
{
    void M(ref readonly int x) { }
}
