// langversion 8: expect CS8400 at 36 "default"
class C
{
    void M<T>() where T : default { }
}
