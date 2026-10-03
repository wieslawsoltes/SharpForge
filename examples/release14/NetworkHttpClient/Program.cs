using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
class Program
{
    static async Task Main()
    {
        using var client = new HttpClient();
        client.Timeout = TimeSpan.FromSeconds(5);
        try
        {
            string json = await client.GetStringAsync("http://127.0.0.1:8787/data");
            using var document = JsonDocument.Parse(json);
            Console.WriteLine(document.RootElement.GetProperty("message").GetString());
            Console.WriteLine(document.RootElement.GetProperty("answer").GetInt32());
        }
        catch (Exception error)
        {
            Console.WriteLine("Request blocked or failed. Review Language & Runtime grants.");
        }
    }
}
