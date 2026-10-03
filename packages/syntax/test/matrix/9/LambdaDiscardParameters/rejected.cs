// langversion 8: expect CS8400 at 57 "_"
delegate int Op(int a, int b);
class C
{
    Op op = (_, _) => 1;
}
