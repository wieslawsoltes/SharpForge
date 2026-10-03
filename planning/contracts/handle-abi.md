# Handle identity and lifetime ABI 1

H1. A non-null identity is the tuple (epoch:uint32, h:uint32, g:uint32), where h and g are nonzero. The 64-bit handle word is `(g << 32) | h`; epoch is negotiated per heap session in the container header. Fixture: identity-and-surrogates, stale-handle.

H2. Null uses the null slot, never a heap record or a zero h/g handle. Zero-initialized structs remain values. Fixture: scalar-boundaries.

H3. Reference equality compares the full tuple, never only h, content or a JS object identity. A recycled index must increase g; exhaustion retires the index. Epoch exhaustion requires a new session identity outside the old channel. A reader rejects dangling/stale references. The reference lease table never reuses an index. Fixtures: stale-handle, leases.

H4. Current ManagedHeap h is zero-based; the adapter uses h+1. Current g may exceed uint32: an adapter must fail before narrowing and request a new epoch. Cross-VM handles may never be imported without an explicit table transfer. Fixture: identity-and-surrogates; range negative test.

H5. Strings use ordinary reference identity. Equal contents do not imply identity. An engine may intern strings within its own heap (CIL strings cache; source constants cache), but transfer preserves distinct records and repeated references. Fixture: identity-and-surrogates.

H6. A call borrows arguments until its synchronous return. Any asynchronous owner must create a strong lease before returning to the caller. Only the issuing table may release the opaque lease; release is idempotent and weak leases do not root. Fixture: leases; host callback tests.

H7. Cancellation is not immediate release: retain task, converted arguments, callback receiver and completion state until the operation has reached a terminal state. Dispose releases all leases and invalidates subsequent access. Fixtures: leases; host-cancel/host-dispose.

H8. Heap/session owner allocates, traces and retires identities; JS/Rust/Wasm consumers cannot dereference raw slots as pointers. Copies of a transfer envelope create a new receiver heap unless a negotiated same-session import resolves the epoch. Fixture: leases foreign-epoch test.

Review checklist: [x] width and generation; [x] null/default; [x] equality/interning; [x] stale/foreign; [x] retain/release; [x] cancellation/disposal; [x] overflow; [x] each clause links fixture coverage. Rust/Wasm execution remains separately unqualified; this is an executable JS reference contract.
