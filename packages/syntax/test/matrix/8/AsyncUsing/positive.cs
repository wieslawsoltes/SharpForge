class C
{
    async System.Threading.Tasks.Task M(System.IAsyncDisposable resource)
    {
        await using (resource) { }
    }
}
