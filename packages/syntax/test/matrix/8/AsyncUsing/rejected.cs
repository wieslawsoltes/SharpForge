// langversion 7.3: expect CS8370 at 98 "await"
class C
{
    async System.Threading.Tasks.Task M(System.IAsyncDisposable resource)
    {
        await using (resource) { }
    }
}
