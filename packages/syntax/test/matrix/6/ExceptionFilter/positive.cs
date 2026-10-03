class C
{
    void M()
    {
        try { } catch (System.Exception e) when (e != null) { }
    }
}
