delegate int Op(int x);
class C
{
    Op op = delegate (int x) { return x; };
}
