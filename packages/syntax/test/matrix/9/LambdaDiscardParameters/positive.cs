delegate int Op(int a, int b);
class C
{
    Op op = (_, _) => 1;
}
