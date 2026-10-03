# SF-A05-T08.3: exact small-long lanes

`smallLongFastPath:true` enables the private Int64 lane independently of
`typedNumericStack`. Values in `Number.MIN_SAFE_INTEGER..MAX_SAFE_INTEGER` use
Number plus the Int64 tag. Wider values retain BigInt. Ordinary array readers,
managed calls, reflection, debugger inspection and snapshot copies always receive
the existing signed BigInt stack pattern. Int32 values never acquire an Int64 tag
without a conversion or declared Int64 storage location.

The bytecode package exports `smallInt64`, `smallInt64Binary`,
`smallInt64Compare` and `smallInt64Unary` beside the existing Int64 helpers. These
are private-representation adapters, not replacements for the generic numeric
dispatcher. Their Number inputs must be exact safe integers. Add/subtract/multiply,
division/remainder and shifts accept a Number result only while it remains exact.
Unsigned operations with negative bit patterns and all wider results use the
existing BigInt implementation, preserving checked overflow and managed faults.
Comparisons retain unsigned ordering across the sign boundary.

The decode contribution selects tagged constants, loads, stores, arithmetic,
comparisons, unary operations and integer conversions. Unobserved scalar stores
preserve the write revision; observed writes take the original notification path.
Decode cache keys must include `smallLongFastPath` as well as the other numeric
flags. The existing T07 typed-frame hook also attaches small-long storage.

Prepared tests cover ten million deterministic operations against pure BigInt,
the 53-bit boundaries, 64-bit wrapping, checked/unsigned faults, division by zero,
negative shifts, conversions, snapshots and a counter loop without BigInt
materialization inside the loop. No tests or benchmarks have run before E02
assembly; the required 3x counter throughput improvement remains unqualified.
