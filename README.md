# csv-reader-speed-01 — faster drop-in for csv-reader 1.0.0

`solve.js` answers exactly what csv-reader 1.0.0 answers, for every input. `main.ts` is the house
driver, unchanged.

## Approach

The reference reads the text one character at a time and builds every field one character at a time.
That is the cost this entry removes.

**Per record, find the line it starts on.** `text.indexOf('\n', pos)` gives the first LF, and a CR
immediately before it belongs to that break. That is one native scan per record instead of a walk.

**If the line holds no quote, split it in one call.** Every field on such a line is plain text, so
`raw.split(',')` replaces the whole character loop. A CR left on that line can only be a lone one —
the line's own break is excluded — so each is dropped and recorded as `stray_cr`, then the remainder
splits the same way.

**Only a record that really contains a quote falls back.** That path spells the policy out in full:
`indexOf` finds the closing quote, skipping doubled pairs; the region between the quotes is read with
one regex pass that both normalises CRLF and lone CR to LF and counts them for the line tally; the
doubled quotes are then collapsed. A quote that never closes is a literal character and the rest of
the record is re-read unquoted, exactly as the reference does.

**Errors keep the reference's order.** A record's `stray_cr` and `quote_junk` errors are emitted as
the record is read; `short_row` and `long_row` when it ends. `line` is the 1-based line the record
starts on, counting every LF, CRLF and lone CR inside quotes; `row` is its index in `rows`, `null`
for the header.

## Verification

- All 6 practice cases identical to the reference (`cases_passed` 6/6).
- 6,074 (text, header) pairs — 3,000 random strings over `a b Z 0 , " \n \r \r\n U+FEFF é \t space`
  plus 37 hand-picked edge cases (empty text, lone CRs, unterminated quotes, doubled quotes, quote
  junk, BOM, ragged rows) — **0 mismatches**.
- Two runs on the same input produce byte-identical output.

## Speed

Practice set (6 cases, 10.19 MB), user CPU, 5 runs each:

| | CPU |
|---|---|
| csv-reader 1.0.0 | 1.29 – 1.43 s |
| this entry | 0.54 – 0.60 s |

Parse alone is 157 ms against 625 ms. Peak RSS 241 MB against 350 MB.

## Licence

MIT — see `LICENSE`. `main.ts` is the house driver from the kit, unchanged. The reference program
is make.fun's own csv-reader 1.0.0 (MIT), derived from d3-dsv 3.0.2 (ISC) and papaparse 5.7.1 (MIT).