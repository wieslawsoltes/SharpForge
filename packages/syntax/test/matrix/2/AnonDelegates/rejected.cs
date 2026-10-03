// langversion 1: expect CS8022 at 46 "delegate"
delegate int Op(int x);
class C
{
    Op op = delegate (int x) { return x; };
}
