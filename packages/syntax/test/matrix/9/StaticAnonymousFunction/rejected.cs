// langversion 8: expect CS8400 at 46 "static"
delegate int Op(int x);
class C
{
    Op op = static x => x;
}
