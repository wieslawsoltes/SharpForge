# Edit and Continue

Debug the source VM, break before `value++`, open Hot Reload, Edit code, paste Program.after.cs.txt into Program.cs and Apply. Existing `counter.Value` stays 40; its appended Added field defaults to 0. A newly constructed Counter initializes Added to 99. Continue prints 51. Without an update it prints 43. The direct-CIL path rejects structural changes; use source mode for this example.
