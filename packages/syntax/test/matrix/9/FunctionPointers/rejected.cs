// langversion 8: expect CS8400 at 21 "delegate"
unsafe class C
{
    delegate*<int, void> p;
}
