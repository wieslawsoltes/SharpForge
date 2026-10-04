/** The exact inputs compiled independently by Roslyn and SharpForge against the projected target contracts. */
export const requiredConstructorProbes = Object.freeze({
  single: 'using System; public class C { public static ReadOnlySpan<byte> Text() => "x"u8; }',
  repeated: `using System;
public class C {
  public static ReadOnlySpan<byte> First() => "x"u8;
  public static ReadOnlySpan<byte> Second() => "x"u8;
}`,
});
