using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public enum Op { Nop, Halt, LoadI, Move, Add, AddI, Sub, Mul, Inc, Dec, Cmp, Jmp, Jz, Jnz, Jlt, Call, Ret, Print, PrintC }

public static class Assembler
{
    private static (char Kind, int Value) Operand(string text)
    {
        switch (text[0])
        {
            case 'r':
            case 'R':
                int index = text.Length == 2 ? text[1] - '0' : -1;
                if (index is < 0 or > 3) goto default;
                return ('r', index);
            case '-':
            case '+':
            case >= '0' and <= '9':
                return ('i', int.Parse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture));
            case '\'' when text.Length == 3 && text[2] == '\'':
                return ('i', text[1]);
            case '@':
                return ('l', 0);
            default:
                throw new FormatException("bad operand " + text);
        }
    }

    public static int[] Assemble(string source)
    {
        var code = new List<int>();
        var labels = new Dictionary<string, int>();
        var fixups = new List<(int Slot, string Label)>();
        string[] lines = source.Split(';');
        for (int lineNumber = 0; lineNumber < lines.Length; lineNumber++)
        {
            string[] parts = lines[lineNumber].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) continue;
            string mnemonic = parts[0].ToLowerInvariant();
            string[] operands = parts[1..];
            foreach (string operand in operands)
            {
                if (operand[0] != '#') continue;
                operands = operands[..Array.IndexOf(operands, operand)];
                goto dispatch;
            }
        dispatch:
            Op op;
            switch (mnemonic)
            {
                case "nop": op = Op.Nop; break;
                case "hlt": case "halt": case "stop":
                    op = Op.Halt;
                    break;
                case "clr":
                    operands = new[] { operands[0], "0" };
                    goto case "mov";
                case "mov":
                case "load":
                    op = Operand(operands[1]).Kind == 'r' ? Op.Move : Op.LoadI;
                    break;
                case "add":
                    op = Operand(operands[1]).Kind == 'r' ? Op.Add : Op.AddI;
                    break;
                case "sub" or "mul" or "cmp":
                    op = mnemonic[0] switch { 's' => Op.Sub, 'm' => Op.Mul, _ => Op.Cmp };
                    if (Operand(operands[1]).Kind != 'r') throw new FormatException($"line {lineNumber}: {mnemonic} needs two registers");
                    break;
                case "inc": case "dec": case "print": case "printc":
                    op = Enum.Parse<Op>(mnemonic, ignoreCase: true);
                    break;
                case "jmp": case "jz": case "jnz": case "jlt": case "call":
                    op = Enum.Parse<Op>(mnemonic, ignoreCase: true);
                    fixups.Add((code.Count + 1, operands[0].TrimStart('@')));
                    operands = new[] { "@" };
                    break;
                case "ret": op = Op.Ret; break;
                default:
                    if (mnemonic.EndsWith(':') && operands.Length == 0) { labels[mnemonic[..^1]] = code.Count / 3; continue; }
                    throw new FormatException($"line {lineNumber}: unknown mnemonic {mnemonic}");
            }
            code.Add((int)op);
            code.Add(operands.Length > 0 ? Operand(operands[0]).Value : 0);
            code.Add(operands.Length > 1 ? Operand(operands[1]).Value : 0);
        }
        foreach (var (slot, label) in fixups)
            code[slot] = labels.TryGetValue(label, out int target) ? target : throw new FormatException("unknown label " + label);
        return code.ToArray();
    }

    public static string Disassemble(int[] code, int pc)
    {
        Op op = (Op)code[pc * 3];
        int a = code[pc * 3 + 1], b = code[pc * 3 + 2];
        switch (op)
        {
            case Op.Nop: case Op.Halt: case Op.Ret:
                return op.ToString().ToLowerInvariant();
            case Op.Jmp: case Op.Jz: case Op.Jnz: case Op.Jlt: case Op.Call:
                return $"{op.ToString().ToLowerInvariant()} @{a}";
            case Op.LoadI: case Op.AddI:
                return $"{op.ToString().ToLowerInvariant()} r{a} {b}";
            case Op.Inc or Op.Dec or Op.Print or Op.PrintC:
                return $"{op.ToString().ToLowerInvariant()} r{a}";
            default:
                return $"{op.ToString().ToLowerInvariant()} r{a} r{b}";
        }
    }
}

public sealed class Machine
{
    public int[] Registers { get; } = new int[4];
    public List<string> Output { get; } = new List<string>();
    public int Steps { get; private set; }

    public string Run(int[] code, int stepLimit = 500)
    {
        var calls = new Stack<int>();
        int pc = 0, flags = 0;
        while (true)
        {
            if (pc < 0 || pc * 3 >= code.Length) return "fell off at " + pc;
            if (++Steps > stepLimit) goto exhausted;
            Op op = (Op)code[pc * 3];
            int a = code[pc * 3 + 1], b = code[pc * 3 + 2];
            pc++;
            switch (op)
            {
                case Op.Nop:
                    break;
                case Op.LoadI:
                    Registers[a] = b;
                    break;
                case Op.Move: b = Registers[b]; goto case Op.LoadI;
                case Op.Inc: b = 1; goto case Op.AddI;
                case Op.Dec: b = -1; goto case Op.AddI;
                case Op.Add: b = Registers[b]; goto case Op.AddI;
                case Op.Sub: b = -Registers[b]; goto case Op.AddI;
                case Op.AddI:
                    Registers[a] += b;
                    flags = Math.Sign(Registers[a]);
                    break;
                case Op.Mul:
                    Registers[a] *= Registers[b];
                    flags = Math.Sign(Registers[a]);
                    break;
                case Op.Cmp:
                    flags = Registers[a].CompareTo(Registers[b]);
                    break;
                case Op.Jz: if (flags != 0) break; goto case Op.Jmp;
                case Op.Jnz: if (flags == 0) break; goto case Op.Jmp;
                case Op.Jlt: if (flags >= 0) break; goto case Op.Jmp;
                case Op.Call:
                    if (calls.Count >= 8) goto default;
                    calls.Push(pc);
                    goto case Op.Jmp;
                case Op.Jmp:
                    pc = a;
                    continue;
                case Op.Ret:
                    if (calls.Count == 0) goto case Op.Halt;
                    pc = calls.Pop();
                    break;
                case Op.PrintC: Output.Add(((char)Registers[a]).ToString()); break;
                case Op.Print: Output.Add(Registers[a].ToString(CultureInfo.InvariantCulture)); break;
                case Op.Halt:
                    return $"halted after {Steps} steps";
                default:
                    return $"fault: {op} at {pc - 1} depth {calls.Count}";
            }
        }
    exhausted:
        return "step limit at " + pc;
    }
}

public static class Program
{
    public static void Main()
    {
        var programs = new (string Name, string Source)[]
        {
            ("factorial", "mov r0 6; mov r1 1; loop:; mul r1 r0; dec r0; jnz @loop; print r1; halt"),
            ("fibonacci", "clr r0; load r1 1; mov r3 8 # count; next:; print r0; mov r2 r0; add r2 r1; mov r0 r1; mov r1 r2; dec r3; jnz next; stop"),
            ("gcd", "mov r0 84; mov r1 36; again:; cmp r0 r1; jz done; jlt less; sub r0 r1; jmp again; less:; sub r1 r0; jmp again; done:; print r0; hlt"),
            ("letters", "mov r0 'a'; mov r1 5; more:; printc r0; add r0 2; dec r1; jnz more; mov r0 '!'; PRINTC r0; ret"),
            ("subroutine", "mov r0 3; call square; call square; print r0; halt; square:; mul r0 r0; ret"),
            ("countdown", "mov r0 2; top:; print r0; add r0 -1; jlt out; jmp top; out:; nop"),
            ("spin", "top:; inc r0; jmp top"),
            ("recursion", "down:; inc r1; call down"),
        };
        foreach (var (name, source) in programs)
        {
            int[] code = Assembler.Assemble(source);
            var machine = new Machine();
            string status = machine.Run(code, 120);
            Console.WriteLine($"{name}: {code.Length / 3} ops, {status}, out [{string.Join(name == "letters" ? "" : " ", machine.Output)}] r=({string.Join(",", machine.Registers)})");
        }
        int[] gcd = Assembler.Assemble(programs[2].Source);
        Console.WriteLine(string.Join(" | ", Enumerable.Range(0, gcd.Length / 3).Select(pc => Assembler.Disassemble(gcd, pc))));
        int[] sub = Assembler.Assemble(programs[4].Source);
        Console.WriteLine(string.Join(" | ", Enumerable.Range(0, sub.Length / 3).Select(pc => Assembler.Disassemble(sub, pc))));
        foreach (string broken in new[] { "mov r0 1; frob r0", "mov r9 1", "jmp nowhere", "sub r0 5", "mov r0 x", "mov r0 'ab'" })
        {
            try { Console.WriteLine(Assembler.Assemble(broken).Length); }
            catch (FormatException e) { Console.WriteLine("assemble error: " + e.Message); }
        }
        var patched = (int[])sub.Clone();
        patched[0] = 99;
        Console.WriteLine(new Machine().Run(patched) + "; " + new Machine().Run(new int[0]) + "; " + new Machine().Run(Assembler.Assemble("jmp end; end:")) + "; " + new Machine().Run(Assembler.Assemble("ret")));
    }
}
