// langversion 4: expect CS8025 at 43 "await"
class C
{
    async void M()
    {
        await task;
    }
}
