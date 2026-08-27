# The Kerusi Seat Map and Availability Format

**A vendor-neutral standard for describing seat maps and seat availability**

| | |
|---|---|
| Version | 1.0.0-draft |
| Status | Draft — open for comment |
| Date | 2026-08-21 |
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
   - [5.4 Multi-leg and Multi-day Bookings (Non-Normative)](#54-multi-leg-and-multi-day-bookings-non-normative)
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
- **Reading direction is a rendering concern.** `Seat.col` is an abstract
  adjacency ordinal — "this seat is next to that one" — not a guarantee of
  left-to-right screen position, the same way `x`/`y` coordinates carry no
  assumption about which edge of the canvas is "first." A consumer
  rendering for a right-to-left locale reverses the visual order in which
  it lays out ascending `col` values (or mirrors `x`), while adjacency and
  navigation order are unaffected, because nothing in this specification
  ties `col` to a screen direction. `KerusiMap.locale` (§4) is the existing
  hint a consumer uses to choose a rendering direction; no separate
  RTL-specific field is needed, consistent with this format defining no
  rendering technology.

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
  rows?: RowMeta[];               // Optional row registry (labels, order, empty rows).
                                    //   NOT a container — see §4.2.
  directions?: Direction[];       // Optional human-facing axis labels — see §4.10.
  seats: Seat[];                  // REQUIRED. Flat list; order is not significant.
  elements?: Element[];           // Non-bookable features: screens, stages, aisles, stairs.
  metadata?: Record<string, unknown>;
}
```

### 4.2 RowMeta

`RowMeta` is purely descriptive: a place to attach a label, a display
order, or row-level metadata (for example, "this row is
wheelchair-accessible"). It is **not** an array that seats live inside —
seats remain in the section's flat `seats` list (§4.1), and a row does
not own them.

`Section.rows` as a whole is OPTIONAL. A section MAY omit it entirely, in
which case a seat's `row` is an opaque free-text label and the section's
rows are exactly those its seats reference (§4.6). When `rows` **is**
present, it is the section's **complete, ordered row registry**: §4.6
already requires every `Seat.row` to resolve against it, so no seat can
occupy a row the registry does not declare, and the registry therefore
defines the section's rows rather than merely annotating them.

```ts
interface RowMeta {
  id: string;                    // REQUIRED.
  label?: string;
  index?: number;                 // Ordering key among rows in the section (§4.2.1).
                                    //   An ordering key, not a position.
  metadata?: Record<string, unknown>;
}
```

#### 4.2.1 Row order

Where a section declares `rows`, its rows are ordered as follows, and two
conformant consumers MUST derive the same order from the same document:

1. Rows declaring `index` come first, sorted by `index` ascending.
2. Rows with no `index` follow, in declaration order.
3. Rows sharing an `index` keep their declaration order relative to one
   another.

`index` is an **ordering key, not a position**. Rows declared at `index`
0 and `index` 11 with nothing between them are adjacent — two rows, not
twelve — and renumbering every row in a section changes nothing about its
layout. Vertical space is expressed by declaring a row (§4.2.2), never by
leaving a numeric hole in `index`.

If any row in a section declares `index`, every row in that section
SHOULD declare one. A partially indexed set is still deterministic under
the rule above, but is harder for a human to read.

#### 4.2.2 Empty rows

A `RowMeta` that no seat references is an **empty row**. It is valid, and
it still occupies a slot in the section's row order: an empty row
reserves the vertical space that one row of seats would occupy.

This is the row-axis counterpart to a skipped column (§4.3.2). It is how
a grid-addressed section expresses space **above its first row** — the
throw between a cinema screen and row A — and space **between two rows** —
a cross-aisle, a barrier, a step. An `Element` that needs to occupy that
space is positioned in the empty row like any other row-addressed element
(§4.4.1); §6.7 works the case end to end.

An empty row reserves space in a `"grid"` section, and for row-addressed
elements in a `"mixed"` one. In a `"freeform"` section every position
comes from `x`/`y` (§4.5), so an empty row reserves nothing there; it
remains valid as a declared label, and a validator MUST NOT reject it.

Empty rows are whole rows. Reserving a fraction of a row's height is a
rendering concern this specification does not address, consistent with
§2: a document states how many rows of space are reserved, and a renderer
decides what a row is worth in pixels.

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
                                     //   | ... . Non-exclusive.
  accessibility?: Accessibility;   // Structured accessibility properties (§4.3.4).
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

The row axis carries the same vocabulary, with one asymmetry that follows
from the data model rather than from a gap in it: columns are *numbered*,
so an unoccupied column is expressed by omitting its number, whereas rows
are *named* (`RowMeta.id`), so there is no skipped row number to leave
out. An unoccupied row is therefore expressed by **declaring** it and
giving it no seats (§4.2.2). Both axes then offer the same two options —
space that is merely absent, and labelled space that is an `Element`.

#### 4.3.3 `type` versus `attributes`

`type` is mutually exclusive: a seat has exactly one `type`, and pricing
and legend/rendering category are determined by it. `attributes` are
zero or more non-exclusive descriptive tags (e.g. `"aisle"`, `"window"`,
`"exit-row"`) that MUST NOT independently affect price. If a category of
seat requires its own price point, it MUST be modeled as a distinct
`SeatType`, not as an `attribute`.

#### 4.3.4 Accessibility

A free-text `attributes` tag such as `"wheelchair"` can flag a seat as
accessible in some sense, but cannot express *which* sense — a wheelchair
user may need to know specifically whether a seat's armrest lifts for a
lateral transfer, or whether the space is reachable by aisle chair,
independently of whether it needs to be booked alongside a companion seat.
These are distinct, structured needs that a single free-text tag cannot
carry without implementers inventing incompatible tag vocabularies. `Seat`
therefore accepts an optional structured `accessibility` object:

```ts
interface Accessibility {
  wheelchairAccessible?: boolean;   // Seat or space usable by a wheelchair user.
  transferArmrest?: "left" | "right" | "both" | "fixed" | "none";
  aisleChairCompatible?: boolean;   // Reachable via aisle-chair transfer.
  companionRequired?: boolean;      // Occupant is expected to need an adjacent
                                      //   companion seat. Pair with Seat.companions
                                      //   (§4.6) to link the actual companion seat.
}
```

All members are OPTIONAL, consistent with the progressive-enhancement
principle (§2): a map with no accessibility needs to express simply omits
`accessibility` on every seat. The free-text `"wheelchair"` `attributes`
tag remains valid for simple cases and MUST NOT be rejected, but
`accessibility.wheelchairAccessible` is the structured, machine-checkable
source of truth when both are present on the same seat.

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

#### 4.4.1 Element positioning and sizing

An `Element` is subject to the same strict positioning constraint as its
section's seats (§4.5), for the same reason: a section whose elements may
be addressed differently from its seats cannot be laid out
deterministically by two independent renderers.

- In a `"grid"` section, an `Element` MUST be positioned by `row` and/or
  `col`, and MUST NOT carry `x` or `y`.
- In a `"freeform"` section, an `Element` MUST be positioned by `x` and
  `y`, and MUST NOT carry `col`. It MAY still carry `row` as a label.
- In a `"mixed"` section, an `Element` MAY use either; where both are
  present, `x`/`y` governs visual placement (§4.3.1).

`width` and `height` are interpreted according to that same mode:

- **Grid.** `width` is a **column span** and `height` is a **row span**,
  both counted in cells from the element's `col` and `row`. Each MUST be
  a positive integer, and each defaults to `1`. An element with
  `height: 3` occupies its own row plus the two rows following it in the
  section's row order (§4.2.1) — ordinarily empty rows declared for that
  purpose (§4.2.2). If `col` is omitted, the element spans the section's
  full column extent and `width` is ignored; this is the usual form for a
  screen or a stage.
- **Freeform.** `width` and `height` are percentages of the section's
  width and height on the canvas whose proportions `Section.aspectRatio`
  fixes (§4.5), matching the percentage interpretation of `x` and `y`.

Grid spans are **dimensionless cell counts**, exactly as `col` is. Giving
them a normative meaning does not give grid mode geometry and does not
qualify the renderer-agnostic principle of §2: a document says how many
cells an element occupies, and a renderer decides what a cell measures.

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
  carry `row`; in a grid section `row` is not merely a label, since it
  places the seat on the row axis in the order defined by §4.2.1.
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
actual proportions. It defaults to `"1:1"` when omitted. It has no
effect on grid-addressed seats, nor on the grid `width`/`height` spans of
§4.4.1, which are dimensionless cell counts; it governs percentage-based
positions and percentage-based element sizing only.

### 4.6 Referential integrity

The following fields are references into another list within the same
document:

| Field | Resolves against |
|---|---|
| `Seat.row` | `RowMeta.id`, when `Section.rows` is present |
| `Element.row` | `RowMeta.id`, when `Section.rows` is present |
| `Seat.type` | `SeatType.id` in `KerusiMap.legend` |
| `Seat.priceTier` | `PriceTier.id` in `KerusiMap.priceTiers` |
| `Seat.companions[]` | other `Seat.id` values within the same section |

A document in which any of these references fails to resolve is
**invalid**. A conformant validator MUST reject such a document rather
than allow a renderer to silently drop or mis-price the affected seat.
The sole exception is `row`: if a section declares no `rows` array at
all, `Seat.row` and `Element.row` are treated as opaque free-text labels
with nothing to resolve against, and are always valid.

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

Elements are validated on the same footing. A validator MUST reject an
`Element` whose positioning fields do not match its section's layout mode
(§4.4.1), and, in a `"grid"` section, an `Element` whose `width` or
`height` is not a positive integer, or whose row span extends past the
last row in the section's row order (§4.2.1). Each of these would
otherwise leave two renderers to disagree about where an element sits or
how much space it occupies — the element-side equivalent of the seat rule
above.

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

### 4.10 Direction labels (optional)

`Seat` already addresses a seat along up to four axes: `row`, `col`,
`x`, and `y` (§4.3). None of these carry any inherent real-world
meaning beyond adjacency and position — `col: 4` is simply "next to
`col: 3`," the same way `Section.layout` deliberately says nothing about
which edge of the screen is "first" (§2). Some domains nonetheless have
a genuine physical or geographic direction associated with one or more
of these axes that is useful to surface to a shopper or to
domain-specific tooling: which end of a train a row is closer to, or
which compass direction a block of stadium or open-air seating faces
(relevant for sun and lighting). `Section.directions` is an OPTIONAL,
purely descriptive way to attach that meaning, without requiring it:

```ts
interface Direction {
  axis: "row" | "col" | "x" | "y";  // REQUIRED. Which addressing axis (§4.3)
                                       //   this label pair describes.
  low: string | Record<string, string>;   // REQUIRED. Label for the low end —
                                             //   ascending row/col order starting
                                             //   from the section's first row/col,
                                             //   or x/y = 0.
  high: string | Record<string, string>;  // REQUIRED. Label for the high end —
                                             //   descending row/col order, or
                                             //   x/y = 100.
}
```

For `axis: "row"`, "low" and "high" refer to the direction of increasing
`RowMeta.index` (or declaration order in `Section.rows`, when `index` is
absent) — the row order of §4.2.1; for `axis: "col"`, to increasing `col`
values. Both are consistent with the row/col ordering already defined in
§4.2–§4.3 — no new ordering concept is introduced.

A section MAY declare a `Direction` for as many or as few of the four
axes as are physically meaningful — a train carriage typically only
labels one (`row`, "front of train" / "back of train"), while an
open-air court or stand may label two (`x`, "west" / "east"; `y`,
"south" / "north"). A section with no relevant real-world direction
simply omits `directions` entirely, consistent with the
progressive-enhancement principle (§2).

`directions` is **non-normative and purely informational**: like
`KerusiMap.domain` (§4), it MUST NOT be used by a validator to reject a
document, and it MUST NOT be relied upon by a renderer to decide layout
or screen placement. In particular, it does not reopen or modify the
rendering-direction principle of §2 — a `Direction` label describes what
an axis *means* in the physical world (which end faces which way), not
which edge of the screen a consumer draws it on; that mapping remains
entirely a rendering decision, exactly as it already is for `col` and
`x`/`y` without any `Direction` present. Two conformant renderers may
therefore agree on every `Direction` label in a document while still
choosing to draw the section mirrored relative to one another, and both
remain conformant.

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

This specification intentionally does not define hold *duration*,
extension, queueing, or how a race between two shoppers for the same
`"held"` seat is resolved. Those policies differ too much by domain — a
cart timeout, a contact-center-mediated hold, and a waitlist all behave
differently — to standardize usefully without excluding legitimate
booking-engine designs. Kerusi's role is limited to carrying the
resulting `holdExpires` timestamp, which is sufficient for any renderer
to show a consistent countdown regardless of what policy produced it.

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

This discard-and-refetch rule is the mechanism that *prevents* silent
drift, not a residual risk of the delta model: an accumulate-forever
consumer with no gap detection is the version of this design that would
drift silently, and this specification does not define that version. A
producer SHOULD nonetheless keep gaps rare in practice — for example by
sending periodic heartbeat deltas (an empty or no-op `changes` object
with an advancing `updatedAt`) and by keeping `updatedAt` strictly
monotonic per session/map per connection — since every discard-and-refetch
costs a full snapshot round-trip even though it is always safe.

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

### 5.4 Multi-leg and Multi-day Bookings (Non-Normative)

A connecting flight and a season ticket both feel, from a shopper's
perspective, like a single booking that spans multiple maps or multiple
dates. This specification deliberately does not add a construct for
that: each leg of an itinerary, and each date of a season, is its own
physical configuration and its own event — a connecting flight's two
legs may well use different airframes, and a stadium's Tuesday game and
Saturday game are different `KerusiSession`s over the same `KerusiMap`.
Modeling either case as a single map or a single session with a validity
range would conflate data that is structurally independent (seat layout
per leg/venue) with data that is structurally repeated (occupancy per
event), and would break the "rarely changes, cacheable" property that
makes `KerusiMap` reusable in the first place (§3).

A multi-leg or multi-day booking is therefore represented as multiple
ordinary `KerusiSession`/`KerusiState` pairs — one per leg or date, each
exactly as described in §5.1–§5.3 — correlated by the booking engine's
own itinerary or season-ticket record. Kerusi has no opinion on, and
carries no data about, that correlation; it is scoped to describing one
physical configuration and its occupancy at a time, the same way a
`KerusiMap` has no opinion on which airline or venue produced it.

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
          "id": "A3", "label": "3", "row": "A", "x": 32, "y": 19, "rotation": -3, "type": "standard",
          "accessibility": { "wheelchairAccessible": true, "transferArmrest": "left", "aisleChairCompatible": true }
        },
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

### 6.6 Direction labels (train and tennis court)

The train's rows run front-to-back; only one axis is physically
meaningful. A tennis court's seating faces the court from all sides, so
both spatial axes carry a compass direction relevant to sun and
lighting:

```json
{
  "id": "coach-b",
  "layout": "grid",
  "rows": [
    { "id": "1", "index": 0 },
    { "id": "2", "index": 1 }
  ],
  "directions": [
    { "axis": "row", "low": "front of train", "high": "back of train" }
  ],
  "seats": [
    { "id": "1A", "row": "1", "col": 1, "type": "standard" },
    { "id": "2A", "row": "2", "col": 1, "type": "standard" }
  ]
}
```

```json
{
  "id": "court1-east-stand",
  "layout": "freeform",
  "directions": [
    { "axis": "x", "low": "west", "high": "east" },
    { "axis": "y", "low": "south", "high": "north" }
  ],
  "seats": [
    { "id": "E1", "x": 10, "y": 50, "type": "standard" }
  ]
}
```

### 6.7 Grid cinema with screen headroom

The cinema in §6.2 is freeform, where vertical space costs nothing: the
screen sits at `y: 2` and row A at `y: 19`. This is the same kind of room
addressed as a grid, where space has to be declared. Four rows carry no
seats — `screen-1` and `screen-2` hold the screen, `throw` is the gap
between the screen and the front row, and `cross-aisle` is a walkway
between rows B and C. Column 3 is the centre aisle, omitted as in §6.1.

```json
{
  "kerusi": "1.0",
  "id": "cinema3-hallB",
  "name": "Hall B",
  "domain": "cinema",
  "legend": [
    { "id": "standard", "label": "Standard", "defaultPriceTier": "regular" }
  ],
  "priceTiers": [
    { "id": "regular", "price": { "amount": 1500, "currency": "MYR" } }
  ],
  "sections": [
    {
      "id": "stalls",
      "layout": "grid",
      "rows": [
        { "id": "screen-1", "index": 0 },
        { "id": "screen-2", "index": 1 },
        { "id": "throw", "index": 2 },
        { "id": "A", "label": "A", "index": 3 },
        { "id": "B", "label": "B", "index": 4 },
        { "id": "cross-aisle", "index": 5 },
        { "id": "C", "label": "C", "index": 6 }
      ],
      "elements": [
        {
          "id": "screen", "kind": "screen", "label": "SCREEN",
          "row": "screen-1", "height": 2
        }
      ],
      "seats": [
        { "id": "A1", "label": "1", "row": "A", "col": 1, "type": "standard" },
        { "id": "A2", "label": "2", "row": "A", "col": 2, "type": "standard" },
        { "id": "A3", "label": "3", "row": "A", "col": 4, "type": "standard" },
        { "id": "B1", "label": "1", "row": "B", "col": 1, "type": "standard" },
        { "id": "B2", "label": "2", "row": "B", "col": 2, "type": "standard" },
        { "id": "B3", "label": "3", "row": "B", "col": 4, "type": "standard" },
        { "id": "C1", "label": "1", "row": "C", "col": 1, "type": "standard" }
      ]
    }
  ]
}
```

Every row above is a real row: a consumer materializes seven of them in
`index` order, four with no seats (§4.2.2). The screen occupies the first
two because `height: 2` is a row span, and it spans the full width of the
section because `col` is omitted (§4.4.1). None of this is a renderer
setting — the same document produces the same vertical arrangement in any
conformant renderer.

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
- materializes every row a section declares, including rows no seat
  references, in the order defined by §4.2.1 (§4.2.2);
- enforces the element positioning and sizing rules of §4.4.1, including
  grid span integrality and row-span bounds (§4.6);
- applies the price-resolution order of §4.9; and
- ignores unrecognized members rather than rejecting the document
  because of them (§2).

**Validators MUST enforce `Section.layout` consistency at v1.0** — this
is not deferred to a future minor version. A `KerusiMap` with a
layout-inconsistent section is invalid from the first stable release.

A validator implementation SHOULD be published as a JSON Schema per
version (§8) so that conformance can be checked mechanically rather than
by inspection of this document.

Rejecting a document with a dangling `row`/`type`/`priceTier`/`companions`
reference, or a layout-inconsistent section (§4.6), is deliberately
strict rather than lenient: silently dropping or mis-pricing the affected
seat instead would hide a producer/consumer sync bug behind a
customer-facing symptom, at exactly the point where it is most expensive
to diagnose. This specification does not relax that rule, but
implementers are not required to discover it at render time — a producer
SHOULD validate a `KerusiMap` before publishing it (e.g. in CI, against
the JSON Schema above), and a gateway or intermediary SHOULD treat a
validation failure as an alertable condition rather than degrade
silently, so that referential or layout drift is caught long before it
reaches a renderer.

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
  acceptable for the domain. Where it is not, mitigation is a
  deployment-layer decision this specification does not mandate but
  implementers should weigh: aggregating or batching transitions instead
  of streaming each one individually, rate-limiting public polling
  endpoints, and requiring authentication on a real-time `KerusiStateDelta`
  feed rather than exposing it to anonymous consumers.
- **Referential-integrity validation (§4.6) is a data-quality control,
  not a security boundary.** Rejecting a document with a dangling
  reference prevents a renderer from mis-pricing or silently dropping a
  seat; it does not substitute for authorization checks on who may
  produce or update a `KerusiState`.

## 10. Open Issues for the 1.0 Release

The following questions remain unresolved and MUST be settled before
this specification exits draft status:

- **Labelled gaps.** Should `Element` gain a dedicated `"gap"`/`"aisle"`
  convention beyond a free-text `kind`, for recurring cases like
  "STAIRS" printed mid-row? Rev 12 settled what an `Element` may do with
  space — its `width`/`height` units are now normative in both modes
  (§4.4.1) — so what remains open here is the `kind` vocabulary, not the
  geometry underneath it.
- **Normative status of `domain`.** Whether `domain` (§4) remains purely
  informational, or whether a future revision uses it to select
  domain-specific required fields.

Four items previously listed here have been resolved as of rev 10 (§11)
rather than left open indefinitely: multi-leg/multi-day bookings
(resolved out of scope by design, §5.4), accessibility (resolved with
`Seat.accessibility`, §4.3.4), right-to-left row direction (resolved as
a rendering concern with no data-model change, §2), and hold/expiry
semantics (resolved as intentionally delegated to the booking engine,
§5.1).

## 11. Changelog

- **1.0.0-draft, rev 12** — Made the grid axis vocabulary symmetric, so a
  grid-addressed section can express vertical space. A `RowMeta` that no
  seat references is now an **empty row** occupying a slot in the
  section's row order (§4.2.2) — which is what reserves the throw between
  a cinema screen and its front row, or a cross-aisle between two rows.
  Previously a grid section could address space on the column axis (a
  skipped `col`, §4.3.2) and not on the row axis at all, so §4.3.2 could
  mandate an `Element` for labelled space that grid mode gave that
  `Element` nowhere to occupy. §4.2.1 states the row-ordering rule this
  depends on, and restates that `index` is an ordering key, not a
  position. Grid `Element.width`/`height` — previously undefined units, an
  independent interop hole in the same paragraph — are now normatively
  **column and row spans** (§4.4.1), and an `Element` is now bound to its
  section's positioning mode exactly as its seats are (§4.4.1, §4.6),
  closing a cross-mode placement the document neither permitted nor
  forbade. Added §6.7, a grid cinema, because the only cinema example was
  freeform and therefore never exercised the failing case.

  Two alternatives were considered and rejected. Making `RowMeta.index`
  positional in grid mode is the most symmetric fix available, but it
  reinterprets an existing field, would silently insert ten empty rows
  between §6.2's rows at `index` 0 and 11, and would leave `index` meaning
  different things in different layout modes. A `Section.headroom`/
  `padding` field is a renderer hint in a format §2 keeps
  renderer-agnostic, and would solve only the top margin, leaving
  mid-section space unrepresentable.

  The row-registry and span rules are additive: no previously valid
  document changes meaning. Binding an `Element` to its section's
  positioning mode is a new restriction, and follows the rev 9 precedent
  that established the same constraint for seats.
- **1.0.0-draft, rev 11** — Added `Section.directions` (§4.10): an
  OPTIONAL, non-normative way to attach a human-facing label to one or
  more of a section's four addressing axes (`row`, `col`, `x`, `y`) —
  "front of train" / "back of train" for a vehicle whose rows run in a
  physical direction, or compass directions for open-air seating where
  sun and lighting depend on orientation. A section that has no such
  real-world direction simply omits it. This does not reopen the §2
  rendering-direction principle: a `Direction` label describes what an
  axis means physically, not which screen edge a renderer draws it on.
- **1.0.0-draft, rev 10** — Reviewed every item raised against the draft
  and resolved four, rather than adding fields reflexively:
  - Added `Seat.accessibility` (§4.3.4): structured
    `wheelchairAccessible`, `transferArmrest`, `aisleChairCompatible`, and
    `companionRequired` fields, since a free-text `"wheelchair"` tag
    cannot express which accessibility need applies. The free-text tag
    remains valid for simple cases.
  - Added §5.4, resolving multi-leg/multi-day bookings as explicitly
    out of scope: each leg or date is its own `KerusiSession`/
    `KerusiState` pair, correlated by the booking engine, not by Kerusi.
  - Resolved right-to-left row direction as a rendering concern requiring
    no data-model change (§2): `col` is an adjacency ordinal, not a
    screen-direction guarantee, and `locale` already carries the
    necessary hint.
  - Resolved hold/expiry semantics (§5.1) as intentionally delegated to
    the booking engine; Kerusi carries only the resulting `holdExpires`
    timestamp.
  - Reframed `KerusiStateDelta` gap-handling (§5.2) as the drift
    *prevention* mechanism rather than a residual risk, and added a
    non-normative heartbeat recommendation to keep gaps rare.
  - Added non-normative guidance: validate-before-publish and alert-on-
    validation-failure recommendations for the existing strict
    referential-integrity and layout-consistency rules (§7); public
    real-time feed mitigation options for activity-leakage risk (§9).
  - The "mixed" layout requiring every seat to carry both `col` and
    `x`/`y` (raised as a complexity concern) is not changed here: rev 9
    (below) already made this an intentional, justified strictness
    trade-off — deterministic cross-renderer layout in exchange for
    some per-seat data overhead — mirroring the referential-integrity
    rationale above.
  - Single-currency-per-map (§4.9) and `metadata` handling (§9) were
    reviewed and kept unchanged — both were already correctly scoped.
  - §10 now lists two open issues instead of six.
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
