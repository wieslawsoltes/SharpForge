// langversion 2: expect CS8023 at 48 "=>"
delegate int Op(int x);
class C
{
    Op op = x => x;
}
