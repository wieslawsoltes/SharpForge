using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using System.Text.Json;

public class UsageTarget
{
    public int Value;
    public static int Shared;
    public static int Read(int value) => value;
    public static int Run()
    {
        var value = new UsageTarget();
        value.Value = 4;
        Shared = Read(value.Value);
        return Read(Shared);
    }
}
static class Program
{
    static readonly Dictionary<ushort, OpCode> Codes = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(field => field.FieldType == typeof(OpCode)).Select(field => (OpCode)field.GetValue(null))
        .ToDictionary(code => unchecked((ushort)code.Value));
    static object Inspect(MethodBase method)
    {
        var uses = new List<object>();
        using var reader = new BinaryReader(new MemoryStream(method.GetMethodBody().GetILAsByteArray()));
        while (reader.BaseStream.Position < reader.BaseStream.Length)
        {
            int offset = (int)reader.BaseStream.Position;
            ushort code = reader.ReadByte();
            if (code == 0xfe) code = (ushort)(0xfe00 | reader.ReadByte());
            var opcode = Codes[code];
            bool token = opcode.OperandType is OperandType.InlineMethod or OperandType.InlineField
                or OperandType.InlineType or OperandType.InlineTok;
            if (token)
            {
                int operand = reader.ReadInt32();
                var member = method.Module.ResolveMember(operand);
                uses.Add(new { offset, opcode = opcode.Name, operand, definition = member.MetadataToken,
                    local = member.Module == method.Module, assigned = opcode == OpCodes.Stfld || opcode == OpCodes.Stsfld,
                    instantiatedType = opcode == OpCodes.Newobj ? member.DeclaringType.MetadataToken : 0 });
                continue;
            }
            int size = opcode.OperandType switch {
                OperandType.InlineNone => 0,
                OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar => 1,
                OperandType.InlineVar => 2,
                OperandType.InlineI or OperandType.InlineBrTarget or OperandType.ShortInlineR
                    or OperandType.InlineString or OperandType.InlineSig => 4,
                OperandType.InlineI8 or OperandType.InlineR => 8,
                OperandType.InlineSwitch => checked(reader.ReadInt32() * 4),
                _ => throw new InvalidOperationException(opcode.OperandType.ToString())
            };
            if (reader.ReadBytes(size).Length != size) throw new EndOfStreamException();
        }
        return new { token = method.MetadataToken, name = method.Name, uses };
    }
    static void Main()
    {
        var type = typeof(UsageTarget);
        var methods = type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Cast<MethodBase>().Concat(type.GetConstructors()).OrderBy(method => method.MetadataToken);
        Console.Write(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), methods = methods.Select(Inspect).ToArray() }));
    }
}
