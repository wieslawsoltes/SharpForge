// langversion 2: expect CS8023 at 46 "x"
delegate int Op(int x);
class C
{
    Op op = x => x;
}
