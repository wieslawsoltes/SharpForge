// langversion 4: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System;
using System.Threading.Tasks;
class P
{
    static async void M() { }
    static async Task N(Task t) { await t; }
    public async Task<int> O() { return 1; }
    async Task I.Explicit() { }
    void Q()
    {
        Func<Task> f = async () => { };
        Func<int, Task> g = async x => { };
        Action h = async delegate { };
        Func<int, Task> i = async (int y) => { await Task.Delay(y); };
        Func<Task> j = static async () => { };
        Func<Task> k = async static () => { };
        async Task Local() { }
        async void Other(Task t) { await t; await t; }
    }
}
interface I { Task Explicit(); }
