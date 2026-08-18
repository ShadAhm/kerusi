# The Kerusi Seat Map and Availability Format

**A vendor-neutral standard for describing seat maps and seat availability**

| | |
|---|---|
| Version | 1.0.0-draft |
| Status | Draft — open for comment |
| Date | 2026-08-18 |
| Editor | Shad |

---

## Abstract

Kerusi (Malay for "chair") defines a vendor-neutral, domain-agnostic data
format for describing the physical layout of seats and their real-time
availability. It is a data format, not a library, a protocol, or a
rendering technology. Any renderer (canvas, SVG, DOM grid) may consume
a conformant Kerusi document, and any backend (cinema, airline, theatre,
stadium, bus, or train booking system) may produce one.

This document is the normative specification for Kerusi version 1.0.

## Status of This Document

This is a **draft** specification, version `1.0.0-draft`. It is open for
public comment and subject to change prior to a final 1.0 release. A list
of open questions that must be resolved before the format is declared
stable appears in §10. Implementers should treat all interfaces described
here as provisional until the draft status is lifted.

## Conventions and Terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL
NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and
**OPTIONAL** in this document are to be interpreted as described in RFC
2119 / RFC 8174, when, and only when, they appear in all capitals as
shown here.

The terms **map**, **section**, **row**, **seat**, and **element** refer
to the corresponding Kerusi document types and objects defined in §4,
unless otherwise qualified.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Design Principles](#2-design-principles)
3. [Document Types](#3-document-types)
4. [The KerusiMap Document](#4-the-kerusimap-document)
5. [The KerusiState and KerusiStateDelta Documents](#5-the-kerusistate-and-kerusistatedelta-documents)
6. [Examples (Non-Normative)](#6-examples-non-normative)
7. [Conformance](#7-conformance)
8. [Registration and Interchange Conventions](#8-registration-and-interchange-conventions)
9. [Security and Privacy Considerations](#9-security-and-privacy-considerations)
10. [Open Issues for the 1.0 Release](#10-open-issues-for-the-10-release)
11. [Changelog](#11-changelog)

---

## 1. Introduction

Every booking application reinvents the same three concepts — rows,
seats, and availability — in slightly incompatible shapes. This makes
seat-picker UI components non-reusable across domains, even though "a
grid of selectable things, some of which are unavailable" is
structurally the same problem in a cinema, an aircraft cabin, a theatre,
a stadium, a bus, or a train.

Existing seat-picker implementations typically use nested row-based
models: a top-level list of rows, each holding an array of seat-or-gap
nodes, where a seat's position is implicit in its slot within that
array. This works for a straight, rectangular grid, but breaks down the
moment a layout needs a curved row, an irregular gap, or a section that
does not fit a grid at all.

Kerusi improves on this pattern in four ways, each developed fully in
the sections that follow:

1. It **separates layout from availability** into two document types —
   a cacheable `KerusiMap` and a frequently-updated `KerusiState` —
   rather than one mutable structure (§3).
2. It **excludes client-local selection state** from the wire format;
   whether a given user has highlighted a seat is session state, never
   transmitted as part of a Kerusi document (§2).
3. It **adds sections, pricing, seat types, companion seats, and
   non-seat elements** required once a layout exceeds a single room
   (§4).
4. It **supports freeform (x/y) positioning** alongside row/column
   addressing, for curved rows, stadium bowls, and cabin layouts that do
   not fit a strict grid (§4.3).

This makes the format equally usable by a canvas or SVG renderer, a
booking backend, and a static build-time cache, without any of them
sharing a single library's internal representation.

## 2. Design Principles

This specification is governed by the following principles. Where a
principle and a specific normative rule in §4–§5 appear to conflict, the
specific rule governs.

- **Domain-agnostic core, domain-specific labels.** A seat is a seat
  whether it is 14C on an aircraft or J12 in a cinema. Domain-specific
  meaning (aisle, exit row, wheelchair-accessible, recliner) is carried
  in `type` and `attributes`, not in per-industry schema variants.
- **Static/dynamic split.** A `KerusiMap` describes structure and MUST
  NOT be relied upon to reflect current booking status. A `KerusiState`
  describes booking status and MUST be fetched or synchronized
  separately and more frequently.
- **Renderer-agnostic.** This specification defines no rendering
  technology. It defines coordinates for freeform layouts; it does not
  define how those coordinates are drawn.
- **Progressive enhancement.** A minimal `KerusiMap` (rows of seats and
  nothing else) MUST be valid. Pricing, sections, companion seats, and
  freeform coordinates are optional layers.
- **Forward-compatible extensibility.** Every object type defined by
  this specification accepts an optional `metadata` member for
  implementation-specific data. A conformant consumer MUST ignore any
  member it does not recognize, both within `metadata` and at the top
  level of any object, so that a future minor-version addition does not
  break an existing parser.
- **English field names.** Field names (keys) are English regardless of
  locale, consistent with the practice of other interchange formats such
  as JSON:API and OpenAPI. Human-facing label values MAY be localized
  (§4.2).

## 3. Document Types

Kerusi defines four document types. A conformant document MUST declare
its type implicitly through its required members, and MUST include a
`kerusi` member giving the specification version it conforms to (e.g.
`"1.0"`).

| Document | Contains | Rate of change | Typical use |
|---|---|---|---|
| `KerusiMap` | Sections, rows, seats, pricing tiers, seat types, non-seat elements — a physical venue or vehicle configuration | Rare — only when the physical layout changes | Fetched once, cached long-term, potentially bundled at build time |
| `KerusiSession` (optional) | A single event, showing, or departure bound to a given map | Rare, effectively immutable once created | One per event; permits many events to reuse one `KerusiMap` (§5.3) |
| `KerusiState` | Per-seat status (`available`/`held`/`booked`/`blocked`) and hold expiry, scoped to a session or map | Continuous | Polled, subscribed to, or refetched on interaction |
| `KerusiStateDelta` | The same per-seat status shape as `KerusiState`, but every entry is an explicit, individual change | Pushed | Real-time transport (WebSocket, SSE) layered on top of a held `KerusiState` (§5.2) |

A `KerusiMap` MUST describe a physical configuration, not an event: "Hall
A" or "a two-class 737-800" is fetched once and reused by every showtime
or flight that uses that room or airframe layout. `KerusiSession` is the
optional join between a specific event and a map; see §5.3 for when it
is required and when it may be omitted.

A conformant renderer merges a `KerusiState` onto a `KerusiMap` by
matching `Seat.id` at render time. This specification does not define
the merge algorithm beyond this matching rule.

---

## 4. The KerusiMap Document

```ts
interface KerusiMap {
  kerusi: "1.0";               // REQUIRED. Spec version this document conforms to.
  id: string;                  // REQUIRED. Unique id for this map (e.g. "cinema3-hallA").
  name?: string;                // Human label, e.g. "Hall A".
  domain?: string;               // Free-text hint: "cinema" | "flight" | "theatre"
                                  //   | "stadium" | "bus" | "train" | "custom".
                                  //   Non-normative; informational only.
  locale?: string;              // BCP-47 language tag. Default: "en".
  legend: SeatType[];           // REQUIRED. Vocabulary of seat types used in this map.
  priceTiers?: PriceTier[];     // Named price tiers, referenced by id.
  sections: Section[];          // REQUIRED.
  metadata?: Record<string, unknown>;
}
```

`domain` is explicitly **non-normative**: a consumer MUST NOT reject a
document, and MUST NOT alter required-field validation, on the basis of
its `domain` value. It exists for tooling and analytics only. (Whether a
future version elevates `domain` to a normative, schema-selecting field
is an open question — see §10.)

### 4.1 Section

A section holds a **flat list of seats**, not a grid of rows containing
seats. This is what makes curves, offsets, and irregular gaps
representable: a seat's position is a property of the seat, not a slot
in a shared array.

```ts
interface Section {
  id: string;                    // REQUIRED.
  label?: string | Record<string, string>;  // String, or locale map:
                                    //   { "en": "Orchestra", "ms": "Orkestra" }.
  index?: number;                 // Display order among sections.
  layout?: "grid" | "freeform" | "mixed";  // Strict positioning constraint — see §4.5.
  aspectRatio?: string;           // "width:height", e.g. "16:9". Meaningful only for
                                    //   freeform/mixed sections. Default: "1:1".
  rows?: RowMeta[];               // Optional row metadata (labels, order). NOT a container.
  seats: Seat[];                  // REQUIRED. Flat list; order is not significant.
  elements?: Element[];           // Non-bookable features: screens, stages, aisles, stairs.
  metadata?: Record<string, unknown>;
}
```

### 4.2 RowMeta

`RowMeta` is purely descriptive: a place to attach a label, a display
order, or row-level metadata (for example, "this row is
wheelchair-accessible"). It is **not** an array that seats live inside.
A `RowMeta` entry is entirely OPTIONAL — a seat MAY carry a free-text
`row` value with no corresponding `RowMeta` declared, if localized
labels or explicit ordering are not required.

```ts
interface RowMeta {
  id: string;                    // REQUIRED.
  label?: string;
  index?: number;                 // Display order among rows in the section.
  metadata?: Record<string, unknown>;
}
```

### 4.3 Seat

```ts
interface Seat {
  id: string;                     // REQUIRED. Globally unique within the KerusiMap.
  label?: string;                  // Display label, e.g. "12" or "12A". Defaults to id.
  row?: string;                    // References RowMeta.id, or a free-text row label.
  col?: number;                    // Grid column within the row.
  x?: number;                      // 0–100, percent of section width (see aspectRatio).
  y?: number;                      // 0–100, percent of section height.
  rotation?: number;               // Degrees. Allows one seat to tilt independently
                                     //   of its neighbours, for curved or staggered rows.
  type: string;                    // REQUIRED. References a SeatType.id in the map's legend.
  priceTier?: string;              // References a PriceTier.id.
  price?: Money;                   // Literal override; takes precedence over priceTier.
  companions?: string[];           // ids of other seats that must be booked together
                                     //   (couple/sofa seats, family bays).
  attributes?: string[];           // Free tags: "aisle" | "window" | "extra-legroom"
                                     //   | "wheelchair" | ... . Non-exclusive.
  metadata?: Record<string, unknown>;
}
```

#### 4.3.1 Positioning requirement

A `Seat` MUST specify `col`, or `x` and `y`, or both, as required by its
enclosing `Section.layout` mode — see §4.5 for the normative rule. A
`Seat` MUST NOT specify neither.

Per-seat mixing of positioning methods (for example, a mostly-straight
row with one seat displaced around a structural obstruction, giving only
that seat `x`/`y` coordinates while its neighbours use `col`) is
permitted only in a section whose `layout` is `"mixed"`, since that mode
requires *every* seat in the section to carry both `col` and `x`/`y`
(§4.5). A section that is not declared or inferred as `"mixed"` MUST use
one positioning method uniformly across all of its seats.

When both `col` and `x`/`y` are present on the same seat, `x`/`y` is
**authoritative for visual placement**. `col` remains meaningful in that
case for logical adjacency — "the seat to the left of this one,"
keyboard or screen-reader navigation order, and accessibility tooling —
even when the seat has been visually displaced off-grid.

#### 4.3.2 No filler objects

Empty space is never represented by a placeholder seat or node. In a
grid-addressed row, an aisle is simply a skipped column number
(`col: 1, 2, 4, 5` is a one-seat gap after column 2). In a freeform row
there is nothing to fill in the first place: seats that do not exist are
simply absent from `seats`. A gap that requires a visible label (for
example, "STAIRS," a marked wheelchair bay, or a deliberately wide
aisle) MUST instead be represented as an `Element` (§4.4).

#### 4.3.3 `type` versus `attributes`

`type` is mutually exclusive: a seat has exactly one `type`, and pricing
and legend/rendering category are determined by it. `attributes` are
zero or more non-exclusive descriptive tags (e.g. `"aisle"`, `"window"`,
`"exit-row"`) that MUST NOT independently affect price. If a category of
seat requires its own price point, it MUST be modeled as a distinct
`SeatType`, not as an `attribute`.

### 4.4 Element

Non-bookable features that still require rendering: screens, stages,
exits, lavatories, staircases, or a gap that requires a label rather
than mere absence. An `Element` is positioned the same way a seat is —
`row`+`col` or `x`/`y` — so it may sit inside a row's flow or float
independently on the section canvas.

```ts
interface Element {
  id: string;                     // REQUIRED.
  kind: string;                    // REQUIRED. "screen" | "stage" | "exit" | "lavatory"
                                     //   | "gap" | "aisle" | implementation-defined.
  label?: string;
  row?: string;
  col?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  metadata?: Record<string, unknown>;
}
```

### 4.5 Positioning modes

`Section.layout` is a **strict, validated constraint**, not a rendering
hint: every seat in a section MUST conform to that section's declared or
inferred `layout` mode. This guarantees that two independent renderers
consuming the same `KerusiMap` produce the same layout, rather than each
guessing at how to interpret a section's seats from their positional
fields alone.

There are three modes:

- **`"grid"`** — every seat MUST have `col`. No seat in the section may
  have `x` or `y`. Because `Section.seats` is a flat, unordered list
  (§4.1), `col` MUST be given explicitly on every seat — it is never
  inferred from a seat's position within the array. A seat MAY still
  carry `row`, as a label (§4.2, §4.3.1).
- **`"freeform"`** — every seat MUST have both `x` and `y`. No seat in
  the section may have `col`. A seat MAY still carry a free-text `row`
  value purely as a label — for grouping or accessibility announcement,
  e.g. "Row L, seat 1" — since `row` alone carries no positional
  information and therefore does not participate in this constraint.
- **`"mixed"`** — every seat MUST have `col` **and** both `x` and `y`.
  This is the only mode in which a single seat may combine grid and
  freeform addressing; per §4.3.1, `x`/`y` governs visual placement and
  `col` remains available for logical adjacency.

If `Section.layout` is omitted, a validator MUST infer it from the
section's seats:

- If every seat has `col` and no seat has `x` or `y`, the section is
  inferred as `"grid"`.
- If every seat has both `x` and `y`, and no seat has `col`, the section
  is inferred as `"freeform"`.
- Any other combination is inconsistent — for example, some seats
  carrying only `col` while others carry only `x`/`y`, or a section
  where some but not all seats have both. A section with no declared
  `layout` MUST NOT mix positioning styles across its seats this way; a
  validator MUST reject such a document (§4.6). Inference never produces
  `"mixed"` — a section that intentionally requires every seat to carry
  both `col` and `x`/`y` MUST declare `layout: "mixed"` explicitly.

Placing a seat's position on the seat itself, rather than deriving it
from the seat's slot in a nested array, is what makes curves, offsets,
and irregular gaps representable: non-seat space no longer requires a
filler node to hold a column position open, and no seat is constrained
to share a straight line with its row-mates. Curved rows, staggered
rows, and displaced seats are all expressible as seats with independent
`x`/`y` values, in a section declared or inferred `"freeform"` (or
`"mixed"`, if some seats in the same section also need grid addressing).

`x` and `y` are always in the range 0–100, but 0–100 of *what shape*
becomes significant the moment `rotation` or an `Element`'s
`width`/`height` is used: a seat rotated 45° on a square canvas will
render at a visually different angle once stretched onto a 2:1 hall.
`Section.aspectRatio` (`"width:height"`, e.g. `"16:9"`) fixes the
canvas's proportions so that percentage coordinates, rotation degrees,
and element sizing carry consistent meaning regardless of the venue's
actual proportions. It defaults to `"1:1"` when omitted, and has no
effect on grid-addressed seats.

### 4.6 Referential integrity

The following fields are references into another list within the same
document:

| Field | Resolves against |
|---|---|
| `Seat.row` | `RowMeta.id`, when `Section.rows` is present |
| `Seat.type` | `SeatType.id` in `KerusiMap.legend` |
| `Seat.priceTier` | `PriceTier.id` in `KerusiMap.priceTiers` |
| `Seat.companions[]` | other `Seat.id` values within the same section |

A document in which any of these references fails to resolve is
**invalid**. A conformant validator MUST reject such a document rather
than allow a renderer to silently drop or mis-price the affected seat.
The sole exception is `row`: if a section declares no `rows` array at
all, `Seat.row` is treated as an opaque free-text label with nothing to
resolve against, and is always valid.

`companions` references MUST be **symmetric**: if seat A lists seat B in
`companions`, seat B MUST list seat A in return; for a group larger than
a pair, every member MUST list every other member. A conformant
validator MUST reject a `companions` set that is not fully mutual. This
prevents a multi-seat booth from silently ending up partially linked
because one seat's array drifted out of sync with the others.

`Section.layout` consistency is a related structural-integrity rule: **a
validator MUST reject any `Section` where seats do not conform to the
declared or inferred `layout` mode** defined in §4.5. Like a dangling
reference, a layout-inconsistent section cannot be rendered
deterministically — different consumers would disagree on how to
interpret the same seat data.

### 4.7 SeatType (legend entry)

```ts
interface SeatType {
  id: string;                     // REQUIRED. e.g. "standard" | "recliner"
                                     //   | "wheelchair" | "business".
  label?: string | Record<string, string>;
  color?: string;                  // Suggested render color, hex. Non-normative hint.
  defaultPriceTier?: string;
}
```

### 4.8 PriceTier and Money

```ts
interface PriceTier {
  id: string;                     // REQUIRED.
  label?: string;
  price: Money;                    // REQUIRED.
}

interface Money {
  amount: number;                  // REQUIRED. Minor units (e.g. cents), to avoid
                                     //   floating-point error.
  currency: string;                 // REQUIRED. ISO 4217, e.g. "MYR", "USD".
}
```

### 4.9 Price resolution

For a given seat, price resolution MUST proceed in the following order,
stopping at the first match:

1. `Seat.price` — a literal override.
2. The `PriceTier` referenced by `Seat.priceTier`.
3. The `PriceTier` referenced by `SeatType.defaultPriceTier` (via
   `Seat.type`).
4. None of the above: the seat is **unpriced**. This is a valid,
   terminal state — general admission, lecture halls, and free events
   legitimately carry no price.

A `KerusiMap` MUST NOT mix currencies across seats; exactly one
`currency` value applies to the whole map. Conversion into a shopper's
local currency is a presentation-layer concern, performed at render
time, and is out of scope for this specification.

---

## 5. The KerusiState and KerusiStateDelta Documents

### 5.1 KerusiState

```ts
interface KerusiState {
  kerusi: "1.0";                   // REQUIRED.
  sessionId?: string;               // Matches KerusiSession.id. RECOMMENDED when the
                                      //   referenced map is reused across many events (§5.3).
  mapId?: string;                   // Matches KerusiMap.id directly, for documents with
                                      //   no separate session concept.
                                      //   Exactly one of sessionId/mapId MUST be present.
  updatedAt: string;                // REQUIRED. ISO 8601 timestamp.
  seats: Record<string, SeatStatus>;  // REQUIRED. Keyed by Seat.id. Only non-default
                                        //   entries need be included (see below).
}

interface SeatStatus {
  status: "available" | "held" | "booked" | "blocked";  // REQUIRED.
  holdExpires?: string;             // ISO 8601. Meaningful only when status === "held".
  metadata?: Record<string, unknown>;
}
```

A seat absent from `KerusiState.seats` MUST be interpreted as
`"available"`. This sparse convention keeps state documents small for
large venues: a 500-seat hall with 12 sold seats is a 12-entry object,
not a 500-entry one.

`status: "blocked"` denotes any seat withheld from sale by the venue —
a broken seat, a staff hold, a roped-off row — and is distinct from
`"booked"` (sold) and `"held"` (temporarily reserved during an
in-progress checkout, e.g. held in a cart for a bounded interval).

### 5.2 KerusiStateDelta — incremental updates

`KerusiState`'s sparse convention (absence implies `"available"`) is
valid only for a complete snapshot. Over a push transport (WebSocket,
Server-Sent Events) a producer must also be able to express "this seat,
previously held, is available again" — which cannot be expressed by
omission, since omission in a delta means "no change," not "available."
`KerusiStateDelta` is a distinct document type defined for this case:

```ts
interface KerusiStateDelta {
  kerusi: "1.0";                    // REQUIRED.
  sessionId?: string;                // Same either/or rule as KerusiState.
  mapId?: string;
  updatedAt: string;                 // REQUIRED. ISO 8601, strictly increasing per
                                       //   session/map, so a consumer can detect and
                                       //   discard an out-of-order delta.
  changes: Record<string, SeatStatus>;  // REQUIRED. Keyed by Seat.id. Every entry IS a
                                          //   change; there is no default. An explicit
                                          //   { "status": "available" } entry signals a
                                          //   seat reverting. A seat's absence from
                                          //   `changes` means "unchanged" — the opposite
                                          //   of KerusiState's sparse rule.
}
```

A consumer maintaining live state MUST apply deltas on top of the last
known `KerusiState` (or the accumulated result of prior deltas), ordered
by `updatedAt`. A consumer that detects a gap in `updatedAt` sequencing,
or receives an out-of-order delta, SHOULD discard its accumulated state
and re-fetch a full `KerusiState` rather than risk silent drift.

### 5.3 KerusiSession — reusing a map across events

A `KerusiMap` describing "Hall A" or a two-class 737-800 configuration
SHOULD NOT be re-issued for every showtime or every flight date — the
seats have not moved. Availability, however, is per-event: the 7pm and
9:30pm showings in the same hall have entirely independent booked
seats. `KerusiSession` is the join between the two:

```ts
interface KerusiSession {
  kerusi: "1.0";                    // REQUIRED.
  id: string;                        // REQUIRED. Unique session id, e.g.
                                       //   "MH123-2026-08-17" or
                                       //   "hallA-2026-08-17T19:30".
  mapId: string;                     // REQUIRED. References the reusable KerusiMap.id.
  label?: string;                     // e.g. "Dune: Part Three — 7:30pm",
                                        //   "MH123, 17 Aug 2026".
  startsAt?: string;                   // ISO 8601 — showtime / departure / event start.
  endsAt?: string;
  metadata?: Record<string, unknown>;
}
```

`KerusiState` and `KerusiStateDelta` reference the session, not the map,
via `sessionId`, when a session exists (§6.5). `KerusiSession` is
entirely OPTIONAL: an application with a genuine one-map-one-event
relationship (a single permanent exhibit, a fixed office floor plan) MAY
omit `KerusiSession` and have `KerusiState` reference `mapId` directly
(§6.4).

---

## 6. Examples (Non-Normative)

The examples in this section illustrate, but do not extend or restrict,
the normative rules in §4–§5.

### 6.1 Minimal generic map (bus, 2+2 layout)

```json
{
  "kerusi": "1.0",
  "id": "bus-42-2026-08-17",
  "domain": "bus",
  "legend": [{ "id": "standard", "label": "Standard" }],
  "sections": [
    {
      "id": "main",
      "seats": [
        { "id": "1A", "row": "1", "col": 1, "type": "standard" },
        { "id": "1B", "row": "1", "col": 2, "type": "standard" },
        { "id": "1C", "row": "1", "col": 4, "type": "standard" },
        { "id": "1D", "row": "1", "col": 5, "type": "standard" }
      ]
    }
  ]
}
```

Column 3 is simply absent — that is the aisle. No filler entry is
required (§4.3.2).

### 6.2 Cinema with curved rows and companion (couple) seats

Freeform positioning handles the curve; `companions` links two seats
sold as a single unit.

```json
{
  "kerusi": "1.0",
  "id": "cinema3-hallA",
  "name": "Hall A",
  "domain": "cinema",
  "legend": [
    { "id": "standard", "label": "Standard", "defaultPriceTier": "regular" },
    { "id": "recliner-couple", "label": "Couple Recliner", "defaultPriceTier": "premium" }
  ],
  "priceTiers": [
    { "id": "regular", "price": { "amount": 1500, "currency": "MYR" } },
    { "id": "premium", "price": { "amount": 4500, "currency": "MYR" } }
  ],
  "sections": [
    {
      "id": "main",
      "layout": "freeform",
      "rows": [
        { "id": "A", "label": "A", "index": 0 },
        { "id": "L", "label": "L (Love Seats)", "index": 11 }
      ],
      "elements": [
        { "id": "screen", "kind": "screen", "label": "Screen", "x": 50, "y": 2, "width": 80, "height": 3 }
      ],
      "seats": [
        { "id": "A1", "label": "1", "row": "A", "x": 20, "y": 20, "rotation": -5, "type": "standard" },
        { "id": "A2", "label": "2", "row": "A", "x": 26, "y": 19, "rotation": -3, "type": "standard" },
        {
          "id": "L1", "label": "1", "row": "L", "x": 60, "y": 70,
          "type": "recliner-couple", "companions": ["L2"]
        },
        {
          "id": "L2", "label": "2", "row": "L", "x": 66, "y": 70,
          "type": "recliner-couple", "companions": ["L1"]
        }
      ]
    }
  ]
}
```

Each seat's own `rotation` allows `A1` and `A2` to follow the curve of
the screen independently — they are not constrained to share an angle
merely because they belong to the same row.

### 6.3 Flight with cabin classes and exit row

This map is a reusable **aircraft configuration** — its `id` names the
airframe/layout, not a specific flight date. See §6.5 for how an actual
flight reuses it via a `KerusiSession`.

```json
{
  "kerusi": "1.0",
  "id": "b738-2class-v1",
  "name": "Boeing 737-800, 2-class",
  "domain": "flight",
  "legend": [
    { "id": "economy", "label": "Economy", "defaultPriceTier": "eco" },
    { "id": "business", "label": "Business", "defaultPriceTier": "biz" }
  ],
  "priceTiers": [
    { "id": "eco", "price": { "amount": 0, "currency": "MYR" } },
    { "id": "biz", "price": { "amount": 0, "currency": "MYR" } }
  ],
  "sections": [
    {
      "id": "business",
      "label": "Business",
      "seats": [
        { "id": "1A", "row": "1", "col": 1, "type": "business", "attributes": ["window"] },
        { "id": "1C", "row": "1", "col": 2, "type": "business", "attributes": ["aisle"] },
        { "id": "1D", "row": "1", "col": 4, "type": "business", "attributes": ["aisle"] },
        { "id": "1F", "row": "1", "col": 5, "type": "business", "attributes": ["window"] }
      ]
    },
    {
      "id": "economy",
      "label": "Economy",
      "seats": [
        { "id": "12A", "row": "12", "col": 1, "type": "economy", "attributes": ["window", "exit-row"] },
        { "id": "12B", "row": "12", "col": 2, "type": "economy", "attributes": ["exit-row"] },
        { "id": "12C", "row": "12", "col": 3, "type": "economy", "attributes": ["aisle", "exit-row"] }
      ]
    }
  ]
}
```

### 6.4 Matching state (direct `mapId`)

```json
{
  "kerusi": "1.0",
  "mapId": "cinema3-hallA",
  "updatedAt": "2026-08-17T09:14:00Z",
  "seats": {
    "A1": { "status": "booked" },
    "L1": { "status": "held", "holdExpires": "2026-08-17T09:24:00Z" },
    "L2": { "status": "held", "holdExpires": "2026-08-17T09:24:00Z" }
  }
}
```

This uses the direct `mapId` shorthand — appropriate for a single-event
setup, but a hall with multiple showtimes per day SHOULD scope state to
a session instead, so `KerusiMap` remains cacheable across all of them.

### 6.5 Reusing a map across sessions (flight)

One `KerusiSession` per actual flight date reuses the `b738-2class-v1`
map from §6.3 — the airframe layout is unchanged flight to flight; only
occupancy differs:

```json
{
  "kerusi": "1.0",
  "id": "MH123-2026-08-17",
  "mapId": "b738-2class-v1",
  "label": "MH123, 17 Aug 2026",
  "startsAt": "2026-08-17T21:15:00+08:00"
}
```

```json
{
  "kerusi": "1.0",
  "sessionId": "MH123-2026-08-17",
  "updatedAt": "2026-08-17T09:14:00Z",
  "seats": {
    "1A": { "status": "booked" }
  }
}
```

Tomorrow's MH123 receives its own `KerusiSession` and `KerusiState`, but
both reference the same cached `b738-2class-v1` map.

---

## 7. Conformance

A document claiming conformance to this specification:

- MUST include a `kerusi` member whose value identifies the version of
  this specification it conforms to (`"1.0"` for this draft).
- MUST satisfy every MUST/MUST NOT/REQUIRED rule stated in §4–§5 for its
  document type.
- MUST NOT be rejected by a conformant consumer solely on the basis of
  unrecognized members, provided all REQUIRED members are present and
  valid (§2).

A producer is conformant if every document it emits satisfies the above.
A consumer (renderer, validator, or intermediary) is conformant if it:

- correctly merges a `KerusiState` onto a `KerusiMap` by `Seat.id`
  (§3);
- enforces the referential-integrity rules of §4.6, including
  `companions` symmetry;
- enforces `Section.layout` consistency (§4.5–§4.6), rejecting any
  section whose seats do not conform to their declared or inferred
  `layout` mode;
- applies the price-resolution order of §4.9; and
- ignores unrecognized members rather than rejecting the document
  because of them (§2).

**Validators MUST enforce `Section.layout` consistency at v1.0** — this
is not deferred to a future minor version. A `KerusiMap` with a
layout-inconsistent section is invalid from the first stable release.

A validator implementation SHOULD be published as a JSON Schema per
version (§8) so that conformance can be checked mechanically rather than
by inspection of this document.

## 8. Registration and Interchange Conventions

- **File extension:** `.kerusi.json` for standalone map, session, state,
  or delta files.
- **Media type:** `application/vnd.kerusi+json`, with an OPTIONAL `type`
  parameter (`type=map`, `type=session`, `type=state`, or
  `type=delta`) for HTTP APIs, following the pattern established by
  `application/vnd.api+json`.
- **Schema validation:** a JSON Schema SHOULD be published per document
  type per version (e.g. `kerusi-map-1.0.schema.json`,
  `kerusi-state-1.0.schema.json`) so implementations can validate
  without parsing this document by hand.
- **Suggested package namespaces:** `@kerusi/schema` (JSON Schema plus
  TypeScript types, no runtime dependencies), `@kerusi/react`,
  `@kerusi/angular`, `@kerusi/svg-renderer` (a reference renderer,
  framework-agnostic).
- **Custom fields:** implementation-specific data MUST be placed under
  `metadata`, never as a bare top-level member, to preserve
  forward-compatibility as this specification adds normative fields in
  future revisions.

## 9. Security and Privacy Considerations

This specification defines a data format, not a transport or
authorization mechanism, and takes no position on how a `KerusiMap` or
`KerusiState` document is authenticated, encrypted in transit, or
access-controlled. Implementers should note the following when building
a system around this format:

- **No personally identifiable information belongs in a `KerusiMap` or
  `KerusiState`.** Both document types describe seats and abstract
  booking status; neither carries passenger names, payment details, or
  other booking-holder identity. Implementations that need to associate
  a hold or booking with an identity should do so in a separate,
  access-controlled system and use `Seat.id` purely as a foreign key.
- **`metadata` is an extension point, not a safe default for sensitive
  data.** Because `metadata` is explicitly permitted to carry
  arbitrary implementation-specific content (§2, §8), and because
  conformant consumers are required to ignore fields they do not
  recognize rather than reject the document, an implementer MUST NOT
  assume `metadata` contents are inspected or filtered by any generic
  Kerusi tooling. Any value placed in `metadata` should be treated as
  reaching every consumer of the document.
- **`KerusiState` and `KerusiStateDelta` reveal booking activity, not
  identity.** A live feed of `held`/`booked` transitions can still leak
  information — for example, purchasing velocity or the size of a
  travelling party inferable from `companions`. Systems exposing a
  public real-time feed should consider whether that inference is
  acceptable for the domain.
- **Referential-integrity validation (§4.6) is a data-quality control,
  not a security boundary.** Rejecting a document with a dangling
  reference prevents a renderer from mis-pricing or silently dropping a
  seat; it does not substitute for authorization checks on who may
  produce or update a `KerusiState`.

## 10. Open Issues for the 1.0 Release

The following questions remain unresolved and MUST be settled before
this specification exits draft status:

- **Multi-leg/multi-day bookings.** A flight with a connection, or a
  season-ticket seat spanning many games: should this be modeled as one
  map with a `validFor` range, or as separate maps entirely?
- **Accessibility.** Is `"wheelchair"` as a free-text `attributes` tag
  sufficient, or does accessibility require first-class fields —
  companion-seat requirements, transfer-armrest presence, aisle-chair
  access?
- **Labelled gaps.** Should `Element` gain a dedicated `"gap"`/`"aisle"`
  convention beyond a free-text `kind`, for recurring cases like
  "STAIRS" printed mid-row?
- **Right-to-left row direction**, for locales where seat numbering
  runs in the opposite direction from the examples in this document.
- **Normative status of `domain`.** Whether `domain` (§4) remains purely
  informational, or whether a future revision uses it to select
  domain-specific required fields.
- **Hold/expiry semantics.** Whether hold-expiry behavior (§5.1) should
  be normatively defined by this specification, or remain entirely
  delegated to the booking engine, with Kerusi only carrying the
  resulting `holdExpires` timestamp.

## 11. Changelog

- **1.0.0-draft, rev 9** — `Section.layout` is now a strict, validated
  constraint rather than a rendering hint (§4.5): a declared or inferred
  `"grid"`, `"freeform"`, or `"mixed"` mode governs which positional
  fields every seat in the section MUST and MUST NOT carry, and a
  validator MUST reject a section whose seats do not conform (§4.6,
  §7). Per-seat mixing of `col` and `x`/`y` outside a uniform section is
  now permitted only under an explicit `"mixed"` declaration (§4.3.1).
  This is a breaking change from rev 1–8 behavior, where `layout` was
  advisory only. Also removed the former `angularJs.keruC` migration
  section and the library-specific framing in §1, since this is a spec,
  not documentation for a specific prior implementation; §8–§11 are
  renumbered down from §9–§12 as a result.
- **1.0.0-draft, rev 8** — Added `KerusiSession` (§5.3): a `KerusiMap`
  is now explicitly a reusable physical configuration, and a session is
  the thin, optional join to a specific event/showtime/flight date.
  `KerusiState`/`KerusiStateDelta` accept either `sessionId`
  (recommended for reused maps) or `mapId` directly (for genuine
  one-map-one-event applications) — exactly one of the two.
- **1.0.0-draft, rev 7** — Added `KerusiStateDelta` (§5.2), a separate
  document type for push/incremental updates. Unlike `KerusiState`'s
  absent-means-available convention, every entry in a delta's `changes`
  map is an explicit change, and omission means "unchanged."
- **1.0.0-draft, rev 6** — Retained `companions: string[]` as mutual
  references (rather than switching to a shared `groupId`), and added a
  symmetry requirement: every seat in a companion group must list every
  other member, and a validator must reject a set that is not fully
  mutual.
- **1.0.0-draft, rev 5** — Defined precedence when a seat has both
  `col` and `x`/`y`: `x`/`y` governs visual placement; `col` remains
  available for logical adjacency (navigation, accessibility tooling).
- **1.0.0-draft, rev 4** — Added `Section.aspectRatio`
  (`"width:height"`, default `"1:1"`) so freeform `x`/`y` percentages,
  `rotation`, and `Element` sizing remain undistorted on non-square
  venues.
- **1.0.0-draft, rev 3** — Resolved four open nuances: §4.6
  (referential integrity — dangling `row`/`type`/`priceTier`/
  `companions` references are invalid), a `type`-versus-`attributes`
  dividing line in §4.3.3, §4.9 (price-resolution order plus
  one-currency-per-map rule), and an explicit unknown-field-tolerance
  requirement in §2.
- **1.0.0-draft, rev 2** — Seats moved from nested `Row.cells[]` arrays
  to a flat `Section.seats[]` list, with rows demoted to optional
  `RowMeta` (labels/order only). Removed the dedicated `Gap` cell type;
  ordinary empty space is now an omitted `col`, and only *labelled*
  gaps require an `Element`. This directly resolved two limits of a
  pure-grid model: a filler node was previously required to hold column
  alignment for non-seat space, and every seat's position was
  implicitly locked to its slot in a straight array, which could not
  express curved, staggered, or individually offset seats.
- **1.0.0-draft, rev 1** — Initial draft.
