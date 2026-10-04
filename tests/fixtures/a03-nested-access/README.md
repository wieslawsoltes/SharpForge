# Nested member-access reference plan

Implementation-ready; no local test/native/performance result is claimed yet.
This extension reuses the canonical member/type context and bounded inheritance
relations. It adds an owned lexical parent forest, not a second name resolver.

Nine focused tests cover enclosing-to-nested direction, sibling isolation, all
six nested visibility flags, protected receivers through an enclosing derived
caller, private containing types, owned snapshots, identity/cancellation, raw
RID/duplicate/cycle/visibility rejection, depth64/65 and aggregate work limits.
The previous eight flat-access tests remain, with former nested unknown cases
updated to their now-defined positive outcomes.

The authored native plan uses pinned ILAsm/ILVerify10.0.5 and SDK10.0.201: 24
independent assemblies, fields and methods across twelve lexical access cases.
Twenty-two queries are expected known agreements, and the two invalid protected
base-receiver cases remain explicit unknown because System.Object is unresolved
by this local adapter. Only the single Test method is verified; no invalid case
is executed. Raw attempts are written before parsing, with tool/source/assembly
hashes and actual query outcomes retained by the capture.

```sh
node scripts/limited.js node tests/fixtures/a03-nested-access/capture.mjs tests/fixtures/a03-nested-access/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-nested-access.test.js tests/a03-07-member-access.test.js
```

At the serial slot: compare exact merged parent8ae8188b and candidate with the
unchanged benchmark-member-access.mjs harness (context creation, cached member,
public/family access), retain all chronological samples, then measure nested
queries separately. Run affected metadata/member contracts plus required static
and structure checks. The broader browser/Rust/full verifier matrix remains
staged; no full verification, external binding or generic nested access claim.
