// langversion 9: expect CS8773 at 46 "int"
delegate int Op(int x);
class C
{
    Op op = int (int x) => x;
}
