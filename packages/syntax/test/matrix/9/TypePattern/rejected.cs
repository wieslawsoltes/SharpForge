// langversion 8: expect CS8400 at 55 "int"
class C
{
    void M()
    {
        switch (o) { case int: break; }
    }
}
