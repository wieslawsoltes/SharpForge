# Recursive archive corpus

`quine.json` contains the exact 866 bytes of David Walker's MIT-licensed `quine.py.zip`, encoded as base64 for review.
Source: <https://github.com/d0sboots/PyZipQuine/blob/master/quine.py.zip>, Git blob
`d1a6ff0a0748e59d75af0f9384ae8aff571ea58e`. The full license is in `QUINE-LICENSE`.

The reference test reads one entry with Python `zipfile` and proves that it equals the enclosing archive byte for byte.
It never executes the embedded Python program or recursively extracts files. The archive tests then require the public
synchronous and streaming readers to reject this quine with `SFZIP014` under their normal memory budgets.

Nested expansion bombs are generated from deterministic data in `tests/a24-06-recursive-archives.test.js`. The optional
strict policy rejects their embedded ZIP signatures without opening the inner file; ordinary nested ZIP assets remain
inert bytes under the default policy. This keeps package archives portable without creating a recursive extractor.

Background on self-reproducing DEFLATE streams: Russ Cox, *Zip Files All The Way Down* (2010),
<https://research.swtch.com/zip>. This corpus uses Walker's independently licensed artifact, not code from that article.
