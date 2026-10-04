using System.Reflection.Metadata;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var inputs = new[] { Array.Empty<byte>(), Encoding.UTF8.GetBytes("deterministic PE content"),
    Enumerable.Range(0, 256).Select(value => (byte)value).ToArray() };
var cases = inputs.Select(bytes => {
    var hash = SHA256.HashData(bytes);
    var id = BlobContentId.FromHash(hash);
    return new { input = Convert.ToBase64String(bytes), guid = Convert.ToHexString(id.Guid.ToByteArray()).ToLowerInvariant(),
        timestamp = id.Stamp };
}).ToArray();
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cases },
    new JsonSerializerOptions { WriteIndented = true }));
