using System.Threading.Tasks;
class Program
{
    static async Task<int> Work(int value, int delay)
    {
        int answer = value * 2;
        await Task.Delay(delay);
        return answer;
    }
    static async Task Main()
    {
        Task<int> first = Work(20, 800);
        Task<int> second = Work(21, 300);
        int left = await first;
        int right = await second;
        Console.WriteLine(left + right);
    }
}
