# A05 scalar example

After the complete E01 adapters are assembled, run:

```sh
node apps/cli/main.js run examples/features-a05/scalar-numerics.cs
```

The example preserves UInt32 while widening, contrasts Single and Double precision, keeps Decimal trailing scale, and catches checked overflow. Both engines should produce:

```text
4294967295
0
1
23.9400
OverflowException
```

See [the scalar contract](../../docs/a05-scalar-numerics.md) for the supported APIs, native integer ABI, native oracle and performance commands. Validation is deferred until the E01 integration is complete.
