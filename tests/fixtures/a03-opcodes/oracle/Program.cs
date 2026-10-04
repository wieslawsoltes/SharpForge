using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.InteropServices;
using System.Text.Json;

var opcodes = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
    .Where(field => field.FieldType == typeof(OpCode))
    .Select(field => (OpCode)field.GetValue(null)!)
    .Select(opcode => new {
        name = opcode.Name, value = unchecked((ushort)opcode.Value), size = opcode.Size,
        operandType = opcode.OperandType.ToString(), stackBehaviourPop = opcode.StackBehaviourPop.ToString(),
        stackBehaviourPush = opcode.StackBehaviourPush.ToString(), flowControl = opcode.FlowControl.ToString(),
        opCodeType = opcode.OpCodeType.ToString(),
    }).OrderBy(opcode => opcode.value).ToArray();
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, opcodes },
    new JsonSerializerOptions { WriteIndented = true }));
