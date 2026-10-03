// langversion 1: expect CS8022 at 40 "private"
class C
{
    int P { get { return 0; } private set { } }
}
