# Kerusi JSON Schemas

JSON Schema (draft 2020-12) definitions for the four Kerusi document types, as
described in [the Kerusi standard, v1.0.0-draft](../RFC/kerusi-standard_v1.0.0-draft.md).
§8 of that document recommends publishing a schema per document type per
version so that conformance can be checked mechanically; these are those
schemas.

| File | Document type | Spec section | Purpose |
|---|---|---|---|
| [`kerusi-map-1.0.schema.json`](kerusi-map-1.0.schema.json) | `KerusiMap` | §4 | The reusable physical configuration: legend, price tiers, sections, rows, seats, elements. Rarely changes; cacheable. |
| [`kerusi-session-1.0.schema.json`](kerusi-session-1.0.schema.json) | `KerusiSession` | §5.3 | The optional join between one event (showtime, departure, fixture) and the map it reuses. |
| [`kerusi-state-1.0.schema.json`](kerusi-state-1.0.schema.json) | `KerusiState` | §5.1 | A complete availability snapshot. Sparse: a seat absent from `seats` is `available`. |
| [`kerusi-statedelta-1.0.schema.json`](kerusi-statedelta-1.0.schema.json) | `KerusiStateDelta` | §5.2 | An incremental update for a push transport. Every entry in `changes` is an explicit change; absence means *unchanged*. |

The schemas are one half of a conformant validator. The other half — the
whole-document and cross-collection rules of §4–§5 that JSON Schema cannot
express — is [`validator.mjs`](validator.mjs), which runs the schema check
first and the semantic rules after it. See
[What the validator enforces](#what-the-validator-enforces).

| File | Purpose |
|---|---|
| [`validator.mjs`](validator.mjs) | The validator: schemas (via ajv) then semantic rules. Its only dependency is ajv. |
| [`semantic-rules.mjs`](semantic-rules.mjs) | The semantic rules alone. Dependency-free, per §8's `@kerusi/schema`. |
| [`kerusi-1.0.d.ts`](kerusi-1.0.d.ts) | TypeScript interfaces transcribed from §4–§5. Declarations only; they enforce nothing at runtime. |

Each schema carries a `version` member (`"1.0.0-draft.15"`) naming the spec
revision it tracks: `1.0.0-draft.<rev>`, where `<rev>` is the latest revision
in the spec's §11 changelog, and the package version follows it. Documents
themselves still declare `"kerusi": "1.0"` throughout the draft, so the schema
version is how a tool says which draft revision it validates. That member is
Kerusi metadata, not a JSON Schema keyword — see
[Running under ajv](#running-under-ajv).

## Using them

```bash
npm install
```

```bash
npx ajv-cli validate --spec=draft2020 --strict=false -c ajv-formats -s schema/kerusi-map-1.0.schema.json -d examples/cinema-hallA.map.kerusi.json
```

`--strict=false` and `-c ajv-formats` are both needed; see
[Running under ajv](#running-under-ajv). Run `npm install` first — `ajv-cli` and
`ajv-formats` are devDependencies of this repo, and resolving `ajv-formats` from
a bare `npx` cache fails.

Programmatically:

```js
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ strict: true, strictRequired: false });
addFormats(ajv);
ajv.addKeyword({ keyword: 'version', metaSchema: { type: 'string' } });

const validateMap = ajv.compile(mapSchema);
if (!validateMap(doc)) console.error(validateMap.errors);
```

Or through the validator, which does the ajv setup below for you and then
applies the semantic rules the schema cannot reach:

```js
import { createValidator } from './schema/validator.mjs';

const kerusi = createValidator();
const { valid, errors, warnings } = kerusi.validate(doc, 'map');
for (const e of errors) console.error(`${e.path || '/'} [${e.rule}, §${e.spec}] ${e.message}`);
for (const w of warnings) console.warn(`${w.path || '/'} [${w.rule}, §${w.spec}] ${w.message}`);
```

Every error carries a `rule` code, the spec section it comes from, a
JSON Pointer (RFC 6901) to the offending node, and a message. Both stages run
on every document and neither stops at the first failure, so one call reports
everything it can see:

```
/sections/0/seats/3/type [seat-type-unresolved, §4.6] seat "A4" has type "recliner", which the map's legend does not declare
/priceTiers/1/price/currency [map-currency-mixed, §4.9] currency "USD" differs from "MYR", first used at /priceTiers/0/price/currency; exactly one currency applies to the whole map
```

`warnings` holds what §4 says a validator SHOULD report but MUST NOT reject a
document for — seats whose footprints overlap (§4.3.1), and seats outside their
section's `bounds` (§4.1). They have the same shape as errors and never affect
`valid`. State, session and delta documents have none.

`updatedAt` monotonicity (§5.2) is a property of a stream rather than of one
document, so it has its own entry point, which validates each delta and then
the sequence:

```js
const { valid, errors } = kerusi.validateDeltaStream(deltasInReceiptOrder);
```

[`semantic-rules.mjs`](semantic-rules.mjs) exports the same rules with no
dependency on ajv — `checkMap`, `lintMap` (the warnings), `checkDeltaStream`,
and the helpers a renderer or editor needs anyway: `sectionOrder` (§4.1.1),
`rowOrder` (§4.2.1), `seatSizeOf` (§4.5), `areNeighbours` (§4.3.5), and
`guidePoint` and `isOnGuide` (§4.2.3) — for a consumer that validates against
the schemas by other means.

### Running under ajv

Three settings matter:

- **`version`.** Ajv's strict mode rejects unknown keywords, so register
  `version` as above (or compile with `strict: false`). It carries no
  validation behaviour.
- **`strictRequired`.** The state and delta schemas express "exactly one of
  `sessionId`/`mapId`" with `not: { required: [...] }`. Ajv's `strictRequired`
  would demand those properties be re-declared inside each negated subschema,
  so turn it off. It
  is off under ajv's defaults and only becomes an issue when `strict: true` is
  set.
- **`format`.** `date-time` on `updatedAt`, `holdExpires`, `startsAt`, and
  `endsAt` is only enforced when `ajv-formats` is registered. Without it those
  members are validated as plain strings — which silently drops the §5.1.1
  requirement, so register it.

## What these schemas enforce

- Required members and value types for every object in §4–§5.
- `kerusi: "1.0"` on all four document types (§7).
- `additionalProperties: false` everywhere (§8) — see
  [Deliberate deviations](#deliberate-deviations).
- The canvas (§4.5): `canvas` with a positive `width` and `height`, and a
  positive `seatSize` on the map and on any section that overrides it.
- Positions (§4.3.1, §4.4.1): every seat and every element carries `x` and `y`,
  each at least 0. The upper bound — the canvas's `width` and `height` —
  belongs to the document, so the validator checks it.
- Adjacency (§4.3.5): `col` is a positive integer, and a seat with `col` also
  has `row`.
- Elements (§4.4.1): positive `width`/`height`, and no `row` or `col`.
- Row shapes (§4.2.3): exactly one of `line`, `arc`, `circle`, each with all its
  members, points as `[x, y]` pairs, a positive `radius`, and `cols` as two
  positive integers.
- `Section.bounds` (§4.1) with a positive `width` and `height`.
- `Money.amount` as an integer in minor units, and `Money.currency` as a
  three-letter uppercase ISO 4217 code (§4.8).
- Enumerated values: `SeatStatus.status`, `Accessibility.transferArmrest`,
  `Direction.axis`.
- Timestamps as RFC 3339 `date-time` (§5.1.1) on `updatedAt`, `holdExpires`,
  `startsAt`, and `endsAt` — seconds present, explicit offset or `Z`. Note that
  per RFC 3339 §5.6 some validators still accept a space in place of `T`.
- Exactly one of `sessionId`/`mapId` on `KerusiState` and `KerusiStateDelta`
  (§5.1–§5.2).

The schemas deliberately impose **no lower bound** on `legend`, `sections`, or
`Section.seats`: §4 declares all three REQUIRED but states no minimum, so a
section that holds only elements — a stage or a screen with no seats of its own
— is valid, and a map whose sections hold no seats needs no seat types.

## Deliberate deviations

Two places where a schema cannot be a neutral transcription of the spec. Each
is also recorded in a `$comment` at the point where it applies.

- **`additionalProperties: false` is a producer-side gate.** §8 says
  implementation-specific data belongs under `metadata`, never as a bare
  top-level member, but §2 and §7 say a *consumer* MUST NOT reject a document
  over unrecognized members. These schemas take the producer's side. A consumer
  that wants §7's tolerance should validate against a copy with
  `additionalProperties` relaxed, or treat an `additionalProperties` error as a
  warning.
- **`domain` is a plain string, not an enum.** §4 makes it non-normative and
  forbids rejecting a document over its value, so an enum would reject a
  conformant document whose domain is not on the list. The seven suggested
  values are kept as `examples`. `Section.directions` (§4.10) is left
  unconstrained beyond its shape for the same reason.

## What the validator enforces

JSON Schema cannot express cross-collection references or whole-document
invariants. Each of the rules below is normative and a conformant validator
MUST enforce it (§4.6, §7), and a document can violate any of them and still
pass the schemas — so [`semantic-rules.mjs`](semantic-rules.mjs) enforces them
in code, and [`validator.mjs`](validator.mjs) runs both stages together. Every
rule is also recorded in a `$comment` at the point in the schema where it
applies.

| Rule | Spec | Enforced as | Fixture |
|---|---|---|---|
| `Seat.type` resolves against `legend[].id` | §4.6 | `seat-type-unresolved` | [`dangling-seat-type`](../examples/validator-only/dangling-seat-type.map.kerusi.json) |
| `Seat.priceTier` and `SeatType.defaultPriceTier` resolve against `priceTiers[].id` | §4.6, §4.9 | `seat-price-tier-unresolved`, `seat-type-default-price-tier-unresolved` | [`dangling-price-tier`](../examples/validator-only/dangling-price-tier.map.kerusi.json) |
| `Seat.row` resolves against `Section.rows[].id`, when `rows` is present | §4.6 | `seat-row-unresolved` | [`dangling-row`](../examples/validator-only/dangling-row.map.kerusi.json) |
| `Seat.companions[]` resolve to other seats **in the same section**, and are fully symmetric | §4.6 | `companion-unresolved`, `companion-self-reference`, `companion-asymmetric`, `companion-group-incomplete` | [`asymmetric-companions`](../examples/validator-only/asymmetric-companions.map.kerusi.json) |
| Every seat and element lies on the canvas: `x` ≤ `canvas.width`, `y` ≤ `canvas.height` | §4.3.1, §4.4.1 | `seat-outside-canvas`, `element-outside-canvas` | [`seat-outside-canvas`](../examples/validator-only/seat-outside-canvas.map.kerusi.json), [`element-outside-canvas`](../examples/validator-only/element-outside-canvas.map.kerusi.json) |
| No two seats in a section share a `row` and `col` | §4.3.5 | `seat-row-col-duplicate` | [`duplicate-row-col`](../examples/validator-only/duplicate-row-col.map.kerusi.json) |
| A row shape's `cols` runs from first to last, not backwards | §4.2.3 | `row-shape-cols-reversed` | [`row-shape-cols-reversed`](../examples/validator-only/row-shape-cols-reversed.map.kerusi.json) |
| One currency across the whole map | §4.9 | `map-currency-mixed` | [`mixed-currencies`](../examples/validator-only/mixed-currencies.map.kerusi.json) |
| `Seat.id` uniqueness across the whole map | §4.3 | `seat-id-duplicate` | [`duplicate-seat-ids`](../examples/validator-only/duplicate-seat-ids.map.kerusi.json) |
| `Section.id` and `Element.id` uniqueness across the whole map | §4.6 | `section-id-duplicate`, `element-id-duplicate` | [`duplicate-section-ids`](../examples/validator-only/duplicate-section-ids.map.kerusi.json), [`duplicate-element-ids`](../examples/validator-only/duplicate-element-ids.map.kerusi.json) |
| `RowMeta.id` uniqueness within its section | §4.6 | `row-id-duplicate` | [`duplicate-row-ids`](../examples/validator-only/duplicate-row-ids.map.kerusi.json) |
| `SeatType.id` and `PriceTier.id` uniqueness within the map | §4.6 | `seat-type-id-duplicate`, `price-tier-id-duplicate` | [`duplicate-seat-type-ids`](../examples/validator-only/duplicate-seat-type-ids.map.kerusi.json), [`duplicate-price-tier-ids`](../examples/validator-only/duplicate-price-tier-ids.map.kerusi.json) |
| `updatedAt` strictly increasing across a delta stream | §5.2 | `delta-updated-at-not-increasing`, via `validateDeltaStream` | stream cases in [`test/semantic-cases.mjs`](test/semantic-cases.mjs) |

The validator also reports two **warnings**, which §4 says a validator SHOULD
report and MUST NOT reject a document for. They are returned in `warnings`,
never in `errors`, and never affect `valid`:

| Condition | Spec | Reported as | Covered by |
|---|---|---|---|
| Two seats' footprints overlap — a square of the applicable `seatSize`, turned by `rotation`. Seats that only touch do not; seats in different sections can, since they share one canvas | §4.3.1 | `seat-overlap`, once per pair, at the later seat | [`test/semantic-cases.mjs`](test/semantic-cases.mjs) |
| A seat lies outside its section's `bounds` | §4.1 | `seat-outside-section-bounds` | [`test/semantic-cases.mjs`](test/semantic-cases.mjs) |

Two notes on scope:

- **Row shapes are not validated against seats.** A seat may lie anywhere
  relative to its row's guide — moving one off its line is the point (§4.2.3) —
  and a seat's `col` may fall outside its row shape's `cols`, in which case it
  simply has no guide point. `guidePoint` and `isOnGuide` are exported for
  editors, not used to judge a document.
- **Cross-document** checking remains out of scope. Whether a `KerusiState`'s
  seat keys match `Seat.id` in the referenced map (§3) needs both documents and
  a way to resolve `sessionId` to a `mapId`; the validator takes one document
  (or one stream) at a time.

## Examples and tests

[`../examples/`](../examples) holds the corpus. Files use the `.kerusi.json`
extension §8 registers, with the document type as a suffix ahead of it
(`*.map.kerusi.json`, `*.session.kerusi.json`, `*.state.kerusi.json`,
`*.statedelta.kerusi.json`) so the test harness can pick the right schema from
the filename. That type suffix is a convention of this corpus, not part of the
registered extension.

- `examples/` — documents that MUST validate, and that draw no warning: every
  map in §6 of the spec; a cinema whose screen headroom and cross-aisle are
  just space on the canvas; a stadium stand exercising `directions`,
  locale-map labels, a row with no seats, a labelled gap and unpriced seats;
  and a map with a stage-only section carrying no seats.
- `examples/invalid/` — documents that MUST NOT validate: missing required
  members (`canvas`, `seatSize`, `legend`, a seat's or an element's `x`/`y`), a
  wrong `kerusi` version, a bare top-level vendor field, a zero-width canvas, a
  zero `seatSize`, a negative coordinate, a `col` of 0 and a `col` without a
  `row`, an element addressed by `row`/`col`, a zero-width element, row shapes
  with two kinds, an unknown kind or a missing member, the removed `layout` and
  `aspectRatio` members, a lowercase currency, a fractional `Money.amount`, an
  ISO 8601 timestamp that is not RFC 3339, and state/delta documents with both
  or neither of `sessionId`/`mapId`.
- `examples/validator-only/` — documents that **pass** these schemas but that a
  conformant validator MUST reject: dangling `type`/`priceTier`/`row`
  references, asymmetric `companions`, a seat and an element off the canvas,
  two seats sharing a row and column, a row shape whose `cols` run backwards,
  mixed currencies, and a duplicate id of each kind — seat, section, element
  (across two sections), row, seat type and price tier. At least one per row of
  the first table above, and the fixture set the validator is tested against.

Run the corpus through both stages of the validator:

```bash
npm install && npm test
```

[`test/validate-examples.mjs`](test/validate-examples.mjs) is the single entry
point. It asserts that `examples/` passes both stages with no warnings, that
every document in `examples/invalid/` is caught by the *schema* stage (a document only the
semantic rules reject belongs in `validator-only/` instead), and that each
`validator-only/` document passes the schema and then produces exactly the rule
code and JSON Pointer expected of it — not merely that it failed somehow. It
finishes with [`test/semantic-cases.mjs`](test/semantic-cases.mjs), which covers
what a corpus of single files cannot: the accepting side of each rule, the
warnings, the guide points and neighbours of §4.2.3 and §4.3.5, the section and
row ordering of §4.1.1 and §4.2.1, and delta-stream monotonicity.
