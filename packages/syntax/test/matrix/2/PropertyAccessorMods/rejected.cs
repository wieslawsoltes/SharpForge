// langversion 1: expect CS8022 at 48 "set"
class C
{
    int P { get { return 0; } private set { } }
}
