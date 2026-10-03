// langversion 9: expect CS8773 at 66 "[A]"
class A : System.Attribute { }
class C
{
    System.Func<int> f = [A] () => 1;
}
