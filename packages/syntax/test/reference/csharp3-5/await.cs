using System.Threading.Tasks;
class C
{
    async Task A()
    {
        await x;
        await x.y();
        var a = await F(await G());
        await Task.Delay(1).ConfigureAwait(false);
        var b = await x + await y;
        var c = -await x;
        var d = (int)await x;
        var e = await (x);
        var f = await await x;
        Func<Task> g = async () => await x;
        Func<int, Task<int>> h = async v => await v;
        Func<int, Task<int>> i = async (v) => { return await v; };
        Func<int, Task<int>> j = async (int v) => await v;
        Func<Task> k = async delegate { await x; };
        Func<int, Task> l = async delegate (int v) { await x; };
        await this;
        await base.M();
        await new T();
        await default(T);
        if (await x) { }
        return;
    }
    async void B() { await x; }
    async Task<int> C1() { return await x; }
    public static async Task D() { }
    async Task<T> E<T>() where T : class { return await x; }
    void N()
    {
        int await = 1;
        await = 2;
        await++;
        F(await);
        var z = await + 1;
        var y = await.x;
        var w = await[0];
        await (x);
        int async = 1;
        async = async + 1;
        var v = async(x);
        async();
        Func<int, int> p = await => await;
        Func<Task> q = async () => { await x; };
        Func<int> r = () => { int await = 1; return await; };
    }
    int await;
    int async;
    void await() { }
    async async async(async async) { return await async; }
}
