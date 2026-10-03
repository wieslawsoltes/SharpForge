// langversion 7.3: expect CS8370 at 33 "readonly"
struct S
{
    int x;
    public readonly int Get() { return x; }
}
