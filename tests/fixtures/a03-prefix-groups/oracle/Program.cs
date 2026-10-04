using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.InteropServices;
using System.Text.Json;

var assembly = AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("PrefixFixture"), AssemblyBuilderAccess.Run);
var module = assembly.DefineDynamicModule("PrefixFixture");
var builder = module.DefineType("Cases", TypeAttributes.Public);
var method = builder.DefineMethod("Read", MethodAttributes.Public | MethodAttributes.Static, typeof(int), new[] { typeof(int) });
var il = method.GetILGenerator();
il.Emit(OpCodes.Ldarga_S, (byte)0);
il.Emit(OpCodes.Volatile);
il.Emit(OpCodes.Unaligned, (byte)1);
il.Emit(OpCodes.Volatile);
il.Emit(OpCodes.Ldind_I4);
il.Emit(OpCodes.Ret);
var created = builder.CreateType()!.GetMethod("Read")!;
var code = Convert.ToBase64String(created.GetMethodBody()!.GetILAsByteArray()!);
var result = created.Invoke(null, new object[] { 42 });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, code, result },
    new JsonSerializerOptions { WriteIndented = true }));
