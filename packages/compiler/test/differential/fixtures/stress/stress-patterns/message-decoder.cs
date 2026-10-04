using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public interface IMessage { byte Channel { get; } }

public sealed class Ping : IMessage
{
    public Ping(byte channel) { Channel = channel; }
    public byte Channel { get; }
}

public class Text : IMessage
{
    public Text(byte channel, string body) { Channel = channel; Body = body; }
    public byte Channel { get; }
    public string Body { get; }
}

public class Move : IMessage
{
    public Move(byte channel, (int X, int Y) delta) { Channel = channel; Delta = delta; }
    public byte Channel { get; }
    public (int X, int Y) Delta { get; }
}

public sealed class Batch : IMessage
{
    public byte Channel { get; init; }
    public List<IMessage> Items { get; } = new List<IMessage>();
}

public readonly struct Ack : IMessage
{
    public Ack(ushort sequence) { Sequence = sequence; }
    public byte Channel => 0;
    public ushort Sequence { get; }
    public void Deconstruct(out byte high, out byte low) { high = (byte)(Sequence >> 8); low = (byte)Sequence; }
}

public static class Decoder
{
    private const byte Flag = 0x7E, KindPing = 1, KindText = 2, KindMove = 3, KindBatch = 4, KindAck = 5;

    public static object Decode(ReadOnlySpan<byte> frame, out int consumed)
    {
        consumed = frame.Length;
        switch (frame)
        {
            case []:
                return "empty frame";
            case [Flag, .. var inner, Flag]:
                object unwrapped = Decode(inner, out int used);
                consumed = used + 2;
                return unwrapped;
            case [not (1 or 2), ..]:
                return "bad version " + frame[0];
            case [_, KindPing, var channel and < 16, ..]:
                consumed = 3;
                return new Ping(channel);
            case [_, KindText, var channel, var length, .. var payload] when payload.Length >= length:
                consumed = 4 + length;
                return new Text(channel, Encoding.ASCII.GetString(payload[..length]));
            case [_, KindText, ..]:
                return "truncated text";
            case [2, KindMove, var channel, .. { Length: >= 4 } delta]:
                consumed = 7;
                return new Move(channel, (BinaryPrimitives.ReadInt16BigEndian(delta), BinaryPrimitives.ReadInt16BigEndian(delta[2..])));
            case [1, KindMove, var channel, var dx, var dy, ..]:
                consumed = 5;
                return new Move(channel, ((sbyte)dx, (sbyte)dy));
            case [_, KindBatch, var channel, var count and > 0 and <= 8, .. var body]:
                var batch = new Batch { Channel = channel };
                consumed = 4;
                for (int i = 0; i < count; i++)
                {
                    object item = Decode(body, out int step);
                    if (item is not IMessage message) return "batch item " + i + ": " + item;
                    batch.Items.Add(message);
                    body = body[step..];
                    consumed += step;
                }
                return batch;
            case [_, KindAck, var high, var low, ..]:
                consumed = 4;
                return new Ack((ushort)(high << 8 | low));
            case [_, >= 0x80 and var reserved, ..]:
                return "reserved kind 0x" + reserved.ToString("X2");
            default:
                return "malformed frame of " + frame.Length;
        }
    }

    public static string Describe(object decoded) => decoded switch
    {
        string error => "ERR " + error,
        Ping { Channel: 0 } => "ping broadcast",
        Ping ping => "ping ch" + ping.Channel,
        Text { Body: "" or null } => "blank text",
        Text { Body: ['/', .. var command] } text => $"command '{command}' ch{text.Channel}",
        Text { Body.Length: > 10, Body: var body } => "long text " + body[..10] + "...",
        Text { Body: var body } => "text " + body,
        Move { Delta: (0, 0) } => "no move",
        Move { Delta: (var dx, 0) } => "horizontal " + dx,
        Move { Delta: (0, var dy) } => "vertical " + dy,
        Move { Delta: { X: var dx, Y: var dy } } when Math.Abs(dx) == Math.Abs(dy) => "diagonal " + dx + "/" + dy,
        Move { Delta.X: > 0, Delta.Y: var dy } move => "east-ish by " + move.Delta.X + " and " + dy,
        Move move => "move " + move.Delta,
        Batch { Items: [] } => "empty batch",
        Batch { Items: [Ping, ..] or [.., Ping] } batch => "ping-framed batch of " + batch.Items.Count,
        Batch { Items.Count: var n, Items: var items } => "batch of " + n + " [" + string.Join(", ", items.Select(i => Describe(i))) + "]",
        Ack { Sequence: >= 0xFF00 } => "ack near wrap",
        Ack(0, var low) => "early ack " + low,
        Ack(var high, var low) => $"ack {high}.{low}",
        IMessage other => "message on " + other.Channel,
        _ => "unknown",
    };

    public static string Route<T>(T message) where T : IMessage => message switch
    {
        Ack => "control",
        { Channel: 0 } => "broadcast",
        { Channel: > 0 and < 8 } and (Text or Move) => "user",
        Batch { Items: var items } when items.TrueForAll(i => i is not Batch) => "bulk",
        _ => "system",
    };

    public static bool TryGet<T>(object decoded, out T message) where T : IMessage
    {
        if (decoded is T typed) { message = typed; return true; }
        message = default;
        return false;
    }
}

public static class Program
{
    public static void Main()
    {
        byte[][] frames =
        {
            new byte[0],
            new byte[] { 1, 1, 0 },
            new byte[] { 2, 1, 9 },
            new byte[] { 3, 1, 9 },
            new byte[] { 1, 2, 4, 5, (byte)'h', (byte)'e', (byte)'l', (byte)'l', (byte)'o' },
            new byte[] { 1, 2, 4, 9, (byte)'h', (byte)'i' },
            new byte[] { 0x7E, 2, 2, 7, 5, (byte)'/', (byte)'q', (byte)'u', (byte)'i', (byte)'t', 0x7E },
            new byte[] { 2, 2, 1, 14, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110 },
            new byte[] { 2, 2, 1, 0 },
            new byte[] { 2, 3, 2, 0xFF, 0xFD, 0x00, 0x03 },
            new byte[] { 2, 3, 2, 0x01, 0x00, 0xFF, 0xFE },
            new byte[] { 1, 3, 2, 0, 0xFB },
            new byte[] { 1, 3, 2, 0, 0 },
            new byte[] { 1, 3, 2, 6, 0 },
            new byte[] { 2, 3, 5, 0, 1 },
            new byte[] { 1, 4, 3, 3, 1, 1, 2, 1, 2, 3, 2, (byte)'o', (byte)'k', 1, 5, 0x12, 0x34 },
            new byte[] { 1, 4, 3, 2, 1, 2, 3, 1, (byte)'a', 1, 5, 0, 7 },
            new byte[] { 1, 4, 3, 2, 1, 1, 4, 9, 9 },
            new byte[] { 2, 5, 0xFF, 0x10 },
            new byte[] { 2, 5, 0, 77 },
            new byte[] { 2, 0x90, 1 },
            new byte[] { 2, 6 },
            new byte[] { 0x7E, 0x7E },
        };
        var routes = new SortedDictionary<string, int>(StringComparer.Ordinal);
        int totalConsumed = 0;
        foreach (var frame in frames)
        {
            object decoded = Decoder.Decode(frame, out int consumed);
            totalConsumed += consumed;
            Console.WriteLine($"{frame.Length,2} bytes, used {consumed,2}: {Decoder.Describe(decoded)}");
            if (decoded is IMessage message)
            {
                string route = Decoder.Route(message);
                routes[route] = routes.TryGetValue(route, out int seen) ? seen + 1 : 1;
            }
        }
        Console.WriteLine(totalConsumed + " " + string.Join(" ", routes.Select(pair => pair.Key + "=" + pair.Value)));
        object sample = Decoder.Decode(frames[18], out _);
        Console.WriteLine(Decoder.TryGet<Ack>(sample, out var ack) + " " + ack.Sequence + " " + Decoder.TryGet<Ping>(sample, out var none) + " " + (none is null)
            + " " + Decoder.Route(ack) + " " + Decoder.Route(new Text(0, "x")) + " " + Decoder.Route(new Text(9, "x")) + " " + (sample is Ack(0xFF, var tail) ? tail : -1));
    }
}
