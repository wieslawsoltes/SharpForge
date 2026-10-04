using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public enum Op : byte { Push, Add, Sub, Mul, Div, Dup, Swap, Pop, Load, Store, Jump, JumpIfZero, Call, Ret, Print, Halt, Less }

public readonly struct Instruction
{
    public Instruction(Op op, int operand = 0) { Op = op; Operand = operand; }
    public Op Op { get; }
    public int Operand { get; }
    public override string ToString() => Op switch
    {
        Op.Push or Op.Load or Op.Store or Op.Jump or Op.JumpIfZero or Op.Call => Op + " " + Operand,
        _ => Op.ToString(),
    };
}

public sealed class VmException : Exception
{
    public VmException(string message, int pc) : base($"{message} at {pc}") { }
}

public sealed class Assembler
{
    private readonly List<Instruction> code = new List<Instruction>();
    private readonly Dictionary<string, int> labels = new Dictionary<string, int>();
    private readonly List<(int Index, string Label)> fixups = new List<(int, string)>();

    public Assembler Emit(Op op, int operand = 0) { code.Add(new Instruction(op, operand)); return this; }
    public Assembler Label(string name) { labels[name] = code.Count; return this; }
    public Assembler Branch(Op op, string label) { fixups.Add((code.Count, label)); return Emit(op, -1); }

    public Instruction[] Build()
    {
        foreach (var (index, label) in fixups)
        {
            if (!labels.TryGetValue(label, out int target)) throw new VmException("unknown label " + label, index);
            code[index] = new Instruction(code[index].Op, target);
        }
        return code.ToArray();
    }
}

public sealed class Machine
{
    private readonly Stack<int> stack = new Stack<int>();
    private readonly Stack<int> calls = new Stack<int>();
    private readonly int[] memory = new int[8];
    private readonly StringBuilder output = new StringBuilder();
    public int Steps { get; private set; }

    private int Pop(int pc) => stack.Count > 0 ? stack.Pop() : throw new VmException("stack underflow", pc);

    public string Run(Instruction[] program, int budget = 10_000)
    {
        int pc = 0;
        while (true)
        {
            if (pc < 0 || pc >= program.Length) throw new VmException("pc out of range", pc);
            if (++Steps > budget) throw new VmException("budget exhausted", pc);
            var instruction = program[pc++];
            int right, left;
            switch (instruction.Op)
            {
                case Op.Push: stack.Push(instruction.Operand); break;
                case Op.Add: case Op.Sub: case Op.Mul: case Op.Div: case Op.Less:
                    right = Pop(pc - 1);
                    left = Pop(pc - 1);
                    stack.Push(instruction.Op switch
                    {
                        Op.Add => left + right,
                        Op.Sub => left - right,
                        Op.Mul => checked(left * right),
                        Op.Less => left < right ? 1 : 0,
                        _ => right != 0 ? left / right : throw new VmException("division by zero", pc - 1),
                    });
                    break;
                case Op.Dup: left = Pop(pc - 1); stack.Push(left); stack.Push(left); break;
                case Op.Swap: right = Pop(pc - 1); left = Pop(pc - 1); stack.Push(right); stack.Push(left); break;
                case Op.Pop: Pop(pc - 1); break;
                case Op.Load: stack.Push(memory[instruction.Operand]); break;
                case Op.Store: memory[instruction.Operand] = Pop(pc - 1); break;
                case Op.Jump: pc = instruction.Operand; break;
                case Op.JumpIfZero: if (Pop(pc - 1) == 0) pc = instruction.Operand; break;
                case Op.Call: calls.Push(pc); pc = instruction.Operand; break;
                case Op.Ret:
                    if (calls.Count == 0) return output.ToString().TrimEnd();
                    pc = calls.Pop();
                    break;
                case Op.Print: output.Append(Pop(pc - 1)).Append(' '); break;
                case Op.Halt: return output.ToString().TrimEnd();
                default: throw new VmException("bad opcode " + (int)instruction.Op, pc - 1);
            }
        }
    }
}

public static class Program
{
    private static Instruction[] Factorials(int count) => new Assembler()
        .Emit(Op.Push, 1).Emit(Op.Store, 0)
        .Label("loop")
        .Emit(Op.Load, 0).Emit(Op.Push, count + 1).Emit(Op.Less).Branch(Op.JumpIfZero, "end")
        .Emit(Op.Load, 0).Branch(Op.Call, "fact").Emit(Op.Print)
        .Emit(Op.Load, 0).Emit(Op.Push, 1).Emit(Op.Add).Emit(Op.Store, 0)
        .Branch(Op.Jump, "loop")
        .Label("end").Emit(Op.Halt)
        .Label("fact")
        .Emit(Op.Dup).Emit(Op.Push, 2).Emit(Op.Less).Branch(Op.JumpIfZero, "recurse")
        .Emit(Op.Pop).Emit(Op.Push, 1).Emit(Op.Ret)
        .Label("recurse")
        .Emit(Op.Dup).Emit(Op.Push, 1).Emit(Op.Sub).Branch(Op.Call, "fact").Emit(Op.Mul).Emit(Op.Ret)
        .Build();

    private static string Try(Func<string> run)
    {
        try { return run(); }
        catch (VmException e) { return "vm error: " + e.Message; }
        catch (OverflowException) { return "overflow"; }
    }

    public static void Main()
    {
        var program = Factorials(10);
        Console.WriteLine(program.Length + " instructions: " + string.Join("; ", program.Take(8)));
        var machine = new Machine();
        Console.WriteLine(machine.Run(program) + " in " + machine.Steps + " steps");
        Console.WriteLine(Try(() => new Machine().Run(Factorials(14))));
        Console.WriteLine(Try(() => new Machine().Run(new[] { new Instruction(Op.Push, 1), new Instruction(Op.Push, 0), new Instruction(Op.Div) })));
        Console.WriteLine(Try(() => new Machine().Run(new[] { new Instruction(Op.Add) })));
        Console.WriteLine(Try(() => new Machine().Run(new[] { new Instruction(Op.Jump, 0) }, budget: 50)));
        Console.WriteLine(Try(() => new Machine().Run(new[] { new Instruction((Op)99) })));
        Console.WriteLine(Try(() => new Machine().Run(new Assembler().Branch(Op.Jump, "nowhere").Build())));
        Console.WriteLine(Try(() => new Machine().Run(new Assembler().Emit(Op.Push, 3).Emit(Op.Push, 4).Emit(Op.Swap).Emit(Op.Sub).Emit(Op.Print).Emit(Op.Ret).Build())));
        var histogram = program.GroupBy(i => i.Op).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Select(g => g.Key + "x" + g.Count());
        Console.WriteLine(string.Join(" ", histogram));
        Console.WriteLine(sizeof(Op) + " " + (byte)Op.Less + " " + Enum.GetValues<Op>().Length + " " + (Op)3 + " " + default(Instruction));
    }
}
