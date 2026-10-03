using System.Reflection;
using System.Text.Json;
var inputs = JsonSerializer.Deserialize<string[]>(File.ReadAllText(args[0]))!;
var cases = inputs.Select(input => {
 try {
  var name = new AssemblyName(input);
  return (object)new { input, name = name.Name, version = name.Version?.ToString(), culture = name.CultureName,
    token = name.GetPublicKeyToken() is {} token ? Convert.ToHexString(token).ToLowerInvariant() : null,
    flags = (int)name.Flags, contentType = name.ContentType.ToString(), fullName = name.FullName };
 } catch (Exception e) { return new { input, error = e.GetType().Name }; }
});
Console.WriteLine(JsonSerializer.Serialize(new { runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
 sdk = "10.0.201", cases }, new JsonSerializerOptions { WriteIndented = true }));
