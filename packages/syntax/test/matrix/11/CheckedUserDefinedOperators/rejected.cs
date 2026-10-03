// langversion 10: expect CS8936 at 39 "checked"
class C
{
    public static C operator checked +(C a, C b) { return a; }
}
