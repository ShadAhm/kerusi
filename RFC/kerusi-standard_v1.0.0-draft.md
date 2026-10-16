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
4. It **places every seat on one canvas** and records which seats are
   neighbours separately, so curved rows, round tables, stadium bowls,
   and cabin layouts are drawn the same by every renderer without giving
   up row-and-seat adjacency (§4.3, §4.5).

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
  technology. It defines one canvas per map, where every seat sits on it
  and how large a seat is (§4.5); it does not define how that canvas is
  drawn — in pixels, colours, or symbols.
- **Progressive enhancement.** A minimal `KerusiMap` (seats with
  positions on a canvas, and nothing else) MUST be valid. Rows and
  adjacency, row shapes, pricing, multiple sections, and companion seats
  are optional layers.
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
  adjacency ordinal — "this seat is next to that one" (§4.3.5) — not a
  guarantee of left-to-right screen position, the same way the canvas's
  `x` axis carries no assumption about which end of a venue is its
  "start." A consumer rendering for a right-to-left locale mirrors the
  canvas, or reverses ascending `col` values in a view built from rows
  (§4.5.1), while adjacency and navigation order are unaffected, because
  nothing in this specification ties `col` to a screen direction. `KerusiMap.locale` (§4) is the existing
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
  canvas: Canvas;               // REQUIRED. The one drawing surface (§4.5).
  seatSize: number;             // REQUIRED. A seat's footprint, in canvas units (§4.5).
  legend: SeatType[];           // REQUIRED. Vocabulary of seat types used in this map.
  priceTiers?: PriceTier[];     // Named price tiers, referenced by id.
  sections: Section[];          // REQUIRED.
  metadata?: Record<string, unknown>;
}

interface Canvas {
  width: number;                // REQUIRED. Positive. Canvas units.
  height: number;               // REQUIRED. Positive. Same scale as width.
}
```

`domain` is explicitly **non-normative**: a consumer MUST NOT reject a
document, and MUST NOT alter required-field validation, on the basis of
its `domain` value. It exists for tooling and analytics only. (Whether a
future version elevates `domain` to a normative, schema-selecting field
is an open question — see §10.)

### 4.1 Section

A section is a **named zone on the map's canvas** (§4.5), not a canvas
of its own. It holds a **flat list of seats**, not a grid of rows
containing seats. This is what makes curves, offsets, and irregular gaps
representable: a seat's position is a property of the seat, not a slot
in a shared array.

```ts
interface Section {
  id: string;                    // REQUIRED. Unique within the KerusiMap (§4.6).
  label?: string | Record<string, string>;  // String, or locale map:
                                    //   { "en": "Orchestra", "ms": "Orkestra" }.
  index?: number;                 // Ordering key among sections (§4.1.1).
                                    //   An ordering key, not a position.
  seatSize?: number;              // Overrides KerusiMap.seatSize here (§4.5).
  bounds?: Bounds;                // The section's extent on the canvas. Does not
                                    //   affect drawing.
  rows?: RowMeta[];               // Optional row registry (labels, order, shapes).
                                    //   NOT a container — see §4.2.
  directions?: Direction[];       // Optional human-facing axis labels — see §4.10.
  seats: Seat[];                  // REQUIRED. Flat list; order is not significant.
  elements?: Element[];           // Non-bookable features: screens, stages, aisles, stairs.
  metadata?: Record<string, unknown>;
}

interface Bounds {
  x: number;                      // REQUIRED. Left edge, in canvas units.
  y: number;                      // REQUIRED. Top edge, in canvas units.
  width: number;                  // REQUIRED. Positive.
  height: number;                 // REQUIRED. Positive.
}
```

Every section in a map is placed on the same canvas, so two sections can
sit side by side — rows in front of a stage, and tables along one wall —
and where a section is drawn is simply where its seats and elements are.

`bounds` is OPTIONAL. It records the rectangle a section occupies, for a
consumer that zooms to a section, draws a thumbnail, or outlines a
section beside a legend. It does not affect drawing. A section's seats
SHOULD lie inside its `bounds`, and a validator SHOULD report one that
does not (§4.6). Two sections' bounds MAY overlap.

#### 4.1.1 Section order

A map's sections are ordered as follows, and two conformant consumers
MUST derive the same order from the same document:

1. Sections declaring `index` come first, sorted by `index` ascending.
2. Sections with no `index` follow, in declaration order.
3. Sections sharing an `index` keep their declaration order relative to
   one another.

`index` is an **ordering key, not a position**, exactly as it is for rows
(§4.2.1). Sections declared at `index` 0 and `index` 5 with nothing
between them are adjacent in the order — two sections, not six — and
renumbering every section in a map changes nothing.

Section order is the order in which a consumer presents a map's
sections: in a list, a legend, or a section picker. It carries no
geometry: where a section is drawn follows from the positions of its
seats and elements on the canvas (§4.5), never from its `index`.

If any section in a map declares `index`, every section in that map
SHOULD declare one. A partially indexed set is still deterministic under
the rule above, but is harder for a human to read.

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
  id: string;                    // REQUIRED. Unique within its section (§4.6).
  label?: string;
  index?: number;                 // Ordering key among rows in the section (§4.2.1).
                                    //   An ordering key, not a position.
  shape?: RowShape;               // A guide to the row's intended form, for
                                    //   editors (§4.2.3). Never moves a seat.
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
0 and `index` 11 with nothing between them are consecutive — two rows,
not twelve — and renumbering every row in a section changes nothing.
Row order says which row comes first in a list, an announcement, or a
view built from rows (§4.5.1). It never places a seat: that is `x`/`y`
alone (§4.3.1).

If any row in a section declares `index`, every row in that section
SHOULD declare one. A partially indexed set is still deterministic under
the rule above, but is harder for a human to read.

#### 4.2.2 Empty rows

A `RowMeta` that no seat references is an **empty row**. It is valid, and
a validator MUST NOT reject it: a producer may keep a label from a
venue's own plan, such as a walkway, or a shaped row whose seats are yet
to be placed. An empty row **reserves no space**. Space on the canvas is
simply space: the throw between a cinema screen and row A is the distance
between the screen element and row A's seats, and a cross-aisle is the
distance between two rows' seats (§6.7). No row needs to exist to hold
it open.

#### 4.2.3 Row shapes

```ts
type RowShape =                   // Exactly one member.
  | { line:   { from: Point; to: Point; cols: [number, number] } }
  | { arc:    { center: Point; radius: number; start: number; sweep: number;
                cols: [number, number] } }
  | { circle: { center: Point; radius: number; start: number; cols: [number, number] } };

type Point = [number, number];    // [x, y], in canvas units (§4.5).
```

`RowMeta.shape` is OPTIONAL, and holds exactly one of:

- **`line`** — a straight row from `from` to `to`.
- **`arc`** — part of a circle round `center`, of positive `radius`,
  starting at angle `start` and turning through `sweep` degrees.
- **`circle`** — a whole circle round `center`, of positive `radius`, the
  first seat at angle `start`: seats round a table.

`cols` is `[first, last]`, the columns the shape spans: positive integers,
with `first` not greater than `last`. Angles are in degrees on the canvas
axes — 0° points right (+x), 90° points down (+y) — and a positive
`sweep` turns clockwise on screen.

A shape is a **guide**. It records the form a row was laid out in, so
that any editor, not only the one that wrote it, can reopen the row as a
line, an arc, or a table, and re-space it. It MUST NOT move any seat: a
renderer ignores it, and a seat's `x`/`y` is always where that seat is
drawn (§4.3.1).

A seat belongs to a row **only** through `Seat.row`. A shape never
decides membership: moving a seat away from its row's guide never changes
its row, and moving it near another row's guide never adds it to that
row.

**Guide point.** For a seat with `col` = *k* in a row whose shape has
`cols` = [*a*, *b*], where *a* ≤ *k* ≤ *b*:

- `line`: `from + (to − from) × (k − a) / (b − a)`, or `from` itself when
  *a* = *b*;
- `arc`: the point on the circle at angle
  `start + sweep × (k − a) / (b − a)`, or at `start` when *a* = *b*;
- `circle`: the point on the circle at angle
  `start + 360 × (k − a) / (b − a + 1)`;

where the point on the circle at angle θ is
`(center.x + radius × cos θ, center.y + radius × sin θ)`. A column outside
[*a*, *b*] has no guide point. A skipped `col` leaves its guide point
empty, so an aisle in a curved row keeps its width (§4.3.2).

A seat is **on its guide** when it lies within `seatSize / 4` of its
guide point, using the seat size that applies to its section (§4.5).
Only editors use this. When an editor changes a guide — its radius, its
sweep, its column count — it SHOULD move every seat on the guide to its
new guide point, and SHOULD leave every seat off the guide where it is.
One seat moved off a curve therefore no longer costs the curve.

A row MAY have a shape and no seats on its guide. An editor then treats
it as a plain row, and MAY drop the shape.

### 4.3 Seat

```ts
interface Seat {
  id: string;                     // REQUIRED. Globally unique within the KerusiMap.
  label?: string;                  // Display label, e.g. "12" or "12A". Defaults to id.
  row?: string;                    // References RowMeta.id, or a free-text row label.
  col?: number;                    // Positive integer. Adjacency within the row
                                     //   (§4.3.5); requires row. Never places the seat.
  x: number;                       // REQUIRED. Centre, in canvas units (§4.3.1).
  y: number;                       // REQUIRED. Centre, in canvas units.
  rotation?: number;               // Degrees, clockwise on screen, about the seat's
                                     //   centre. Lets one seat tilt independently of
                                     //   its neighbours, for curved or staggered rows.
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

#### 4.3.1 Position and footprint

`Seat.x` and `Seat.y` are REQUIRED. They are the centre of the seat's
footprint, in canvas units (§4.5), and MUST lie within the canvas:
`0 ≤ x ≤ canvas.width` and `0 ≤ y ≤ canvas.height`. A validator MUST
reject a seat without them, or outside the canvas.

A seat's **footprint** is a square whose side is the seat size that
applies to its section (§4.5), centred on `x`/`y` and turned by
`rotation` degrees clockwise on screen about that centre. The footprint
is the whole of a seat's geometry: two conformant renderers draw the same
seat at the same place, at the same size, and at the same angle.

Two seats whose footprints overlap are almost certainly a producer error,
though not one that makes the document ambiguous. A validator SHOULD
report such seats, and MUST NOT reject the document because of them.
Footprints that merely touch — seats placed exactly one seat size apart —
do not overlap.

`x`/`y` is the only thing that places a seat. `row`, `col`, and a row's
shape never do (§4.2.3, §4.3.5).

#### 4.3.2 No filler objects

Empty space is never represented by a placeholder seat or node. Seats
that do not exist are simply absent from `seats`, and the canvas is empty
where they would have been. Within a row, an aisle is also a skipped
column number (`col: 1, 2, 4, 5` is a one-seat gap after column 2), which
is what tells a consumer that the seats either side of it are not
neighbours (§4.3.5). Space between rows needs nothing at all: it is the
distance between one row's seats and the next row's on the canvas
(§4.2.2). A gap that requires a visible label (for example, "STAIRS," a
marked wheelchair bay, or a deliberately wide aisle) MUST instead be
represented as an `Element` (§4.4).

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

#### 4.3.5 Neighbours

`Seat.row` and `Seat.col` are OPTIONAL, and say only which seats are next
to which. `col` is a positive integer, and a seat with `col` MUST also
have `row`. Within a section, no two seats may share the same `row` and
`col`; a validator MUST reject a section in which they do.

Two seats are **neighbours** exactly when they are in the same section
and the same row, and their `col`s differ by 1. Nothing else implies
adjacency: not distance on the canvas, not labels, not order in `seats`.
A skipped `col` is an aisle, so `col: 2` and `col: 4` are not neighbours
however close together they are drawn, and a seat with no `row` or no
`col` has no neighbours.

Adjacency is what a consumer uses to find "4 seats together," to move
keyboard focus to the seat next door, and to tell a screen-reader user
that seat L5 is next to L4. It is independent of drawing: `row` and `col`
MUST NOT affect where a seat is drawn in the canonical view (§4.5), and a
seat moved off its row's line keeps both its row and its neighbours.

### 4.4 Element

Non-bookable features that still require rendering: screens, stages,
exits, lavatories, staircases, or a gap that requires a label rather
than mere absence. An `Element` is placed on the canvas exactly as a
seat is, by its centre.

```ts
interface Element {
  id: string;                     // REQUIRED. Unique within the KerusiMap (§4.6).
  kind: string;                    // REQUIRED. "screen" | "stage" | "exit" | "lavatory"
                                     //   | "gap" | "aisle" | implementation-defined.
  label?: string;
  x: number;                       // REQUIRED. Centre, in canvas units (§4.4.1).
  y: number;                       // REQUIRED. Centre, in canvas units.
  width?: number;                  // Canvas units. Default: the applicable seatSize.
  height?: number;                 // Canvas units. Default: the applicable seatSize.
  rotation?: number;               // Degrees, clockwise on screen, about the centre.
  metadata?: Record<string, unknown>;
}
```

#### 4.4.1 Element position and size

`Element.x` and `Element.y` are REQUIRED. They are the centre of the
element, in canvas units, and MUST lie within the canvas, as a seat's do
(§4.3.1). `width` and `height` are in canvas units and MUST be positive.
A missing `width` or `height` defaults to the seat size that applies to
the element's section (§4.5). `rotation` turns the element clockwise on
screen about its centre.

An element occupies a `width` × `height` rectangle. What is drawn inside
it — a screen, a stage, the word "STAIRS" — is a rendering decision, as
§2 leaves it. An element has no `row` and no `col`: it is never placed by
reference to a row, and it has no neighbours.

### 4.5 The canvas

`KerusiMap.canvas` is REQUIRED: `{ "width": number, "height": number }`,
both positive. Its units are abstract, with the **same scale on both
axes** — one unit across is one unit down — so a rotation, a circle, or an
element's size means the same thing in a wide hall as in a square one.
The origin is the top-left corner, `x` grows to the right, and `y` grows
downwards.

`KerusiMap.seatSize` is REQUIRED: a positive number of canvas units, the
side of every seat's square footprint (§4.3.1). A section MAY override it
with its own `seatSize`, which then applies to that section's seats and
to the default size of its elements (§4.4.1) — business-class seats
larger than economy ones, for instance. Within one section, every seat
is the same size.

Every seat, element, and section in a map is placed on this one canvas.
A renderer's **canonical view** draws the whole canvas: every seat at its
`x`/`y` with its footprint, and every element at its `x`/`y` with its
size. A renderer chooses the scale from canvas units to its own, and MAY
crop, zoom, pan, or mirror the whole drawing (§2). It MUST NOT otherwise
move, resize, or reflow anything in the canonical view, and it does no
layout arithmetic of its own: no cell sizes, no row spacing, no
percentages. Two conformant renderers consuming the same `KerusiMap`
therefore produce the same drawing, down to the size of a seat, and
whether two seats overlap or how many seats fit across a room is a
question the document answers, not the renderer.

Placing a seat's position on the seat itself, rather than deriving it
from the seat's slot in a nested array, is what makes curves, offsets,
and irregular gaps representable: non-seat space needs no filler node,
no seat has to share a straight line with its row-mates, and a seat moved
off its row's line stays in that row (§4.2.3). One placement rule covers
every layout — a plain grid, a curved row, a round table, a stadium bowl,
an aircraft cabin — and a seat's three kinds of information are kept
apart so that they can never contradict one another:

| Question | Answered by | Used by |
|---|---|---|
| Where is the seat drawn? | `x`, `y`, `rotation`, `seatSize` (§4.3.1) | Every renderer |
| Which seats are next to it? | `row`, `col` (§4.3.5) | Selection, keyboard and screen-reader navigation |
| What shape was its row meant to have? | `RowMeta.shape` (§4.2.3) | Editors only |

#### 4.5.1 Other views (non-normative)

The canonical view draws every seat at its `x`/`y`. A renderer MAY also
offer views built from `row` and `col` alone: a reflowed grid for a
narrow phone screen, a list or table for assistive technology, or a
"rows" view of a large venue. In such a view shaped rows are
straightened, seats off their guide go back in line, and aisles — skipped
`col`s — remain as gaps; rows follow the row order of §4.2.1. Seats with
no `row` appear only in the canonical view, or in a separate list. This
keeps the main benefit of the former grid mode — letting the viewer
choose the layout — as an option beside the canonical drawing rather
than the only drawing there is.

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

**Positions and adjacency** are validated on the same footing, because
each failure below would otherwise leave two consumers to disagree about
where a seat is or which seats are next to it. A conformant validator
MUST reject a document in which:

- a seat or an element has no `x` or `y`, or lies outside the canvas
  (§4.3.1, §4.4.1);
- a seat carries a `col` that is not a positive integer, or a `col`
  without a `row` (§4.3.5);
- two seats in one section share the same `row` and `col` (§4.3.5); or
- a row shape's `cols` names a first column after its last (§4.2.3).

A validator SHOULD report, and MUST NOT reject a document for, seats
whose footprints overlap (§4.3.1) and seats outside their section's
`bounds` (§4.1). Either is likely a producer error, but neither leaves
the document ambiguous.

**Identifier uniqueness.** A reference is only well-defined if its target
is: an id that appears twice resolves to two objects, and a consumer is
left to pick one. Every `id` within a `KerusiMap` is therefore unique
within the scope below:

| Identifier | Unique within |
|---|---|
| `Seat.id` | the whole `KerusiMap`, across all sections (§4.3) |
| `Section.id` | the whole `KerusiMap` |
| `Element.id` | the whole `KerusiMap`, across all sections |
| `SeatType.id` | `KerusiMap.legend` |
| `PriceTier.id` | `KerusiMap.priceTiers` |
| `RowMeta.id` | its own section's `rows` |

`RowMeta.id` is scoped to its section because rows are: `Seat.row`
resolves only against its own section's registry, so two
sections may each declare a row `"A"`. Each kind of identifier is its own
namespace — a seat and an element MAY share an id, as MAY a seat type and
a price tier — since no field references more than one kind.

A conformant validator MUST reject a document that repeats an identifier
within its scope. A duplicate `SeatType.id` or `PriceTier.id` makes the
seat references that land on it ambiguous, and with them a seat's price
(§4.9): two seat types `"standard"` declaring different
`defaultPriceTier`s leave two renderers free to charge different amounts
for the same seat. A duplicate `Section.id` or `Element.id` is not a
reference target within this document, but it is the key by which
anything outside the document — an availability panel, a per-section
rendering override, an analytics event — identifies the object, and the
same ambiguity follows.

### 4.7 SeatType (legend entry)

```ts
interface SeatType {
  id: string;                     // REQUIRED. Unique within the KerusiMap (§4.6).
                                     //   e.g. "standard" | "recliner"
                                     //   | "wheelchair" | "business".
  label?: string | Record<string, string>;
  color?: string;                  // Suggested render color, hex. Non-normative hint.
  defaultPriceTier?: string;
}
```

### 4.8 PriceTier and Money

```ts
interface PriceTier {
  id: string;                     // REQUIRED. Unique within the KerusiMap (§4.6).
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

`Seat` already describes a seat along up to four axes: `row`, `col`,
`x`, and `y` (§4.3). None of these carry any inherent real-world
meaning beyond adjacency and position — `col: 4` is simply "next to
`col: 3`," the same way the canvas (§4.5) says nothing about which
compass direction its `x` axis points in (§2). Some domains nonetheless have
a genuine physical or geographic direction associated with one or more
of these axes that is useful to surface to a shopper or to
domain-specific tooling: which end of a train a row is closer to, or
which compass direction a block of stadium or open-air seating faces
(relevant for sun and lighting). `Section.directions` is an OPTIONAL,
purely descriptive way to attach that meaning, without requiring it:

```ts
interface Direction {
  axis: "row" | "col" | "x" | "y";  // REQUIRED. Which axis (§4.3) this
                                       //   label pair describes.
  low: string | Record<string, string>;   // REQUIRED. Label for the low end —
                                             //   ascending row/col order starting
                                             //   from the section's first row/col,
                                             //   or x/y = 0.
  high: string | Record<string, string>;  // REQUIRED. Label for the high end —
                                             //   descending row/col order, or
                                             //   x = canvas.width, y = canvas.height.
}
```

For `axis: "row"`, "low" and "high" refer to the direction of increasing
`RowMeta.index` (or declaration order in `Section.rows`, when `index` is
absent) — the row order of §4.2.1; for `axis: "col"`, to increasing `col`
values. Both are consistent with the row/col ordering already defined in
§4.2–§4.3 — no new ordering concept is introduced. For `axis: "x"` and
`axis: "y"`, the axes are those of the map's one canvas (§4.5), which
every section shares; whether these two should therefore be declared on
the map rather than on each section is open (§10).

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
  updatedAt: string;                // REQUIRED. RFC 3339 timestamp (§5.1.1).
  seats: Record<string, SeatStatus>;  // REQUIRED. Keyed by Seat.id. Only non-default
                                        //   entries need be included (see below).
}

interface SeatStatus {
  status: "available" | "held" | "booked" | "blocked";  // REQUIRED.
  holdExpires?: string;             // RFC 3339 (§5.1.1). Meaningful only when
                                      //   status === "held".
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

#### 5.1.1 Timestamp format

Every timestamp in this specification — `KerusiState.updatedAt`,
`SeatStatus.holdExpires`, `KerusiStateDelta.updatedAt`,
`KerusiSession.startsAt`, and `KerusiSession.endsAt` — MUST be an **RFC 3339
`date-time`**: the calendar-date profile of ISO 8601, with seconds present and
an explicit UTC offset or `Z`, for example `2026-08-17T09:14:00Z` or
`2026-08-17T21:15:00+08:00`.

ISO 8601 as a whole is broader than this, and admits forms that are ambiguous
or awkward to parse interoperably — seconds omitted (`2026-08-17T09:14Z`),
the basic format without separators (`20260817T091400Z`), ordinal and week
dates, and local times carrying no offset at all. A consumer receiving a
timestamp it cannot parse cannot show a correct hold countdown or order a
delta stream, so this specification narrows the requirement to the profile
every mainstream date library and JSON Schema validator already implements as
`format: "date-time"`. A producer emitting any other ISO 8601 form is
non-conformant, and a validator MUST reject the document.

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
  updatedAt: string;                 // REQUIRED. RFC 3339 (§5.1.1), strictly increasing per
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
  startsAt?: string;                   // RFC 3339 (§5.1.1) — showtime / departure /
                                        //   event start.
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
  "canvas": { "width": 252, "height": 60 },
  "seatSize": 40,
  "legend": [{ "id": "standard", "label": "Standard" }],
  "sections": [
    {
      "id": "main",
      "seats": [
        { "id": "1A", "row": "1", "col": 1, "x": 30, "y": 30, "type": "standard" },
        { "id": "1B", "row": "1", "col": 2, "x": 78, "y": 30, "type": "standard" },
        { "id": "1C", "row": "1", "col": 4, "x": 174, "y": 30, "type": "standard" },
        { "id": "1D", "row": "1", "col": 5, "x": 222, "y": 30, "type": "standard" }
      ]
    }
  ]
}
```

Every seat is drawn at its `x`/`y` as a 40-unit square (§4.3.1). Column 3
is simply absent — that is the aisle: nothing is drawn at `x: 126`, and
`1B` and `1C` are not neighbours (§4.3.5). No filler entry is required
(§4.3.2).

### 6.2 Cinema with a curved row and companion (couple) seats

Row A is laid out on an arc, and records it as its shape; `companions`
links two seats sold as a single unit.

```json
{
  "kerusi": "1.0",
  "id": "cinema3-hallA",
  "name": "Hall A",
  "domain": "cinema",
  "canvas": { "width": 1000, "height": 800 },
  "seatSize": 40,
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
      "rows": [
        {
          "id": "A",
          "label": "A",
          "index": 0,
          "shape": { "arc": { "center": [500, -300], "radius": 520, "start": 100, "sweep": -20, "cols": [1, 3] } }
        },
        {
          "id": "L",
          "label": "L (Love Seats)",
          "index": 11,
          "shape": { "line": { "from": [480, 700], "to": [520, 700], "cols": [1, 2] } }
        }
      ],
      "elements": [
        { "id": "screen", "kind": "screen", "label": "Screen", "x": 500, "y": 30, "width": 800, "height": 20 }
      ],
      "seats": [
        { "id": "A1", "label": "1", "row": "A", "col": 1, "x": 410, "y": 212, "rotation": 10, "type": "standard" },
        { "id": "A2", "label": "2", "row": "A", "col": 2, "x": 500, "y": 220, "rotation": 0, "type": "standard" },
        {
          "id": "A3",
          "label": "3",
          "row": "A",
          "col": 3,
          "x": 590,
          "y": 212,
          "rotation": -10,
          "type": "standard",
          "accessibility": { "wheelchairAccessible": true, "transferArmrest": "left", "aisleChairCompatible": true }
        },
        {
          "id": "L1",
          "label": "1",
          "row": "L",
          "col": 1,
          "x": 480,
          "y": 700,
          "type": "recliner-couple",
          "companions": ["L2"]
        },
        {
          "id": "L2",
          "label": "2",
          "row": "L",
          "col": 2,
          "x": 520,
          "y": 700,
          "type": "recliner-couple",
          "companions": ["L1"]
        }
      ]
    }
  ]
}
```

Each seat is drawn where its `x`/`y` puts it, and its own `rotation` lets
`A1`, `A2` and `A3` face the screen independently — they are not
constrained to share an angle merely because they share a row. The arc
does not place them: it records that row A was laid out on a circle of
radius 520 round `[500, -300]`, so that an editor can reopen the row as
an arc. Each seat lies on its guide point (§4.2.3) — `A2`'s, for
instance, is at 90°, straight below the centre. Rows A and L sit at
`index` 0 and 11, which orders them and places nothing (§4.2.1).

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
  "canvas": { "width": 300, "height": 240 },
  "seatSize": 40,
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
      "seatSize": 50,
      "bounds": { "x": 0, "y": 20, "width": 300, "height": 80 },
      "seats": [
        { "id": "1A", "row": "1", "col": 1, "x": 50, "y": 60, "type": "business", "attributes": ["window"] },
        { "id": "1C", "row": "1", "col": 2, "x": 106, "y": 60, "type": "business", "attributes": ["aisle"] },
        { "id": "1D", "row": "1", "col": 4, "x": 194, "y": 60, "type": "business", "attributes": ["aisle"] },
        { "id": "1F", "row": "1", "col": 5, "x": 250, "y": 60, "type": "business", "attributes": ["window"] }
      ]
    },
    {
      "id": "economy",
      "label": "Economy",
      "bounds": { "x": 0, "y": 140, "width": 300, "height": 80 },
      "seats": [
        {
          "id": "12A",
          "row": "12",
          "col": 1,
          "x": 54,
          "y": 180,
          "type": "economy",
          "attributes": ["window", "exit-row"]
        },
        { "id": "12B", "row": "12", "col": 2, "x": 98, "y": 180, "type": "economy", "attributes": ["exit-row"] },
        {
          "id": "12C",
          "row": "12",
          "col": 3,
          "x": 142,
          "y": 180,
          "type": "economy",
          "attributes": ["aisle", "exit-row"]
        }
      ]
    }
  ]
}
```

The two cabins are two sections on one canvas (§4.5), business above
economy, each with `bounds` a consumer can zoom to (§4.1). Business seats
are larger: the section's `seatSize` of 50 overrides the map's 40.

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
lighting. Both are sections, shown without the maps around them; the
court's map has a 1600 × 900 canvas.

```json
{
  "id": "coach-b",
  "rows": [
    { "id": "1", "index": 0 },
    { "id": "2", "index": 1 }
  ],
  "directions": [
    { "axis": "row", "low": "front of train", "high": "back of train" }
  ],
  "seats": [
    { "id": "1A", "row": "1", "col": 1, "x": 30, "y": 30, "type": "standard" },
    { "id": "2A", "row": "2", "col": 1, "x": 30, "y": 78, "type": "standard" }
  ]
}
```

```json
{
  "id": "court1-east-stand",
  "directions": [
    { "axis": "x", "low": "west", "high": "east" },
    { "axis": "y", "low": "south", "high": "north" }
  ],
  "seats": [
    { "id": "E1", "x": 160, "y": 450, "type": "standard" }
  ]
}
```

### 6.7 Rows, a round table, and a balcony

A town hall with a stage, one straight row with a centre aisle, a round
table, a wheelchair space, and a curved balcony. The two sections share
the canvas (§4.5).

```json
{
  "kerusi": "1.0",
  "id": "town-hall",
  "name": "Town Hall",
  "canvas": { "width": 1600, "height": 900 },
  "seatSize": 40,
  "legend": [
    { "id": "std", "label": "Standard", "defaultPriceTier": "regular" },
    { "id": "wheelchair", "label": "Wheelchair space", "defaultPriceTier": "regular" }
  ],
  "priceTiers": [{ "id": "regular", "price": { "amount": 2500, "currency": "MYR" } }],
  "sections": [
    {
      "id": "stalls",
      "label": "Stalls",
      "index": 0,
      "bounds": { "x": 280, "y": 60, "width": 1180, "height": 680 },
      "rows": [
        { "id": "A", "label": "A", "shape": { "line": { "from": [320, 400], "to": [1088, 400], "cols": [1, 9] } } },
        {
          "id": "T1",
          "label": "Table 1",
          "shape": { "circle": { "center": [1300, 300], "radius": 70, "start": -90, "cols": [1, 4] } }
        }
      ],
      "elements": [
        { "id": "stage", "kind": "stage", "label": "Stage", "x": 800, "y": 126, "width": 800, "height": 90 }
      ],
      "seats": [
        { "id": "A1", "row": "A", "col": 1, "x": 320, "y": 400, "type": "std" },
        { "id": "A2", "row": "A", "col": 2, "x": 416, "y": 400, "type": "std" },
        { "id": "A3", "row": "A", "col": 3, "x": 512, "y": 400, "type": "std" },
        { "id": "A4", "row": "A", "col": 4, "x": 608, "y": 400, "type": "std" },
        { "id": "A6", "row": "A", "col": 6, "x": 800, "y": 400, "type": "std" },
        { "id": "A7", "row": "A", "col": 7, "x": 896, "y": 400, "type": "std" },
        { "id": "A8", "row": "A", "col": 8, "x": 992, "y": 400, "type": "std" },
        { "id": "A9", "row": "A", "col": 9, "x": 1100, "y": 440, "type": "std" },
        {
          "id": "T1-1",
          "row": "T1",
          "col": 1,
          "x": 1300,
          "y": 230,
          "type": "std",
          "companions": ["T1-2", "T1-3", "T1-4"]
        },
        {
          "id": "T1-2",
          "row": "T1",
          "col": 2,
          "x": 1370,
          "y": 300,
          "type": "std",
          "companions": ["T1-1", "T1-3", "T1-4"]
        },
        {
          "id": "T1-3",
          "row": "T1",
          "col": 3,
          "x": 1300,
          "y": 370,
          "type": "std",
          "companions": ["T1-1", "T1-2", "T1-4"]
        },
        {
          "id": "T1-4",
          "row": "T1",
          "col": 4,
          "x": 1230,
          "y": 300,
          "type": "std",
          "companions": ["T1-1", "T1-2", "T1-3"]
        },
        { "id": "S1", "x": 1408, "y": 702, "type": "wheelchair" }
      ]
    },
    {
      "id": "balcony",
      "label": "Balcony",
      "index": 1,
      "bounds": { "x": 440, "y": 580, "width": 720, "height": 220 },
      "rows": [
        {
          "id": "L",
          "label": "L",
          "shape": { "arc": { "center": [800, 60], "radius": 640, "start": 120, "sweep": -60, "cols": [1, 7] } }
        }
      ],
      "seats": [
        { "id": "L1", "row": "L", "col": 1, "x": 480, "y": 614, "type": "std" },
        { "id": "L2", "row": "L", "col": 2, "x": 581, "y": 661, "type": "std" },
        { "id": "L3", "row": "L", "col": 3, "x": 689, "y": 690, "type": "std" },
        { "id": "L4", "row": "L", "col": 4, "x": 800, "y": 700, "type": "std" },
        { "id": "L5", "row": "L", "col": 5, "x": 930, "y": 760, "type": "std" },
        { "id": "L6", "row": "L", "col": 6, "x": 1019, "y": 661, "type": "std" },
        { "id": "L7", "row": "L", "col": 7, "x": 1120, "y": 614, "type": "std" }
      ]
    }
  ]
}
```

Each of the three kinds of information about a seat is read from its own
fields, and none of them overrides another:

- **Where each seat is drawn** is its `x`/`y` and nothing else. The stage
  is an element 800 × 90 units in size, and the space between it and row
  A is just space: no row is declared to hold it open (§4.2.2).
- **Which seats are neighbours** is `row` and `col` alone (§4.3.5). Row A
  has no column 5, so `A4` and `A6` are not neighbours, and its line
  leaves a gap there, at `x: 704` — the aisle. `A9` has been moved off the
  line, down and to the right; it is still in row A and still next to
  `A8`. `S1` has no `row` or `col`, so it has no neighbours at all. The
  table's four seats are one row, `T1`, and one companion group (§4.6).
- **What shape each row was meant to have** is its `shape`, which only an
  editor reads (§4.2.3). `A1`–`A8` are on row A's line, and `A9`, about
  42 units from its guide point at `x: 1088`, is off it. The table's
  seats sit 90° apart round its circle, starting straight above the
  centre. Balcony seat `L5` was dragged off the arc — its guide point is
  at about `(911, 690)`. An editor that widens the arc moves the other six
  seats to their new guide points and leaves `L5` where it is.

`T1-1` sits above the table's centre, at −90°, and `L4` below the
balcony arc's centre, at 90°, because angles are measured on the canvas
axes, with `y` pointing down.

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
  `companions` symmetry and identifier uniqueness;
- enforces the position and adjacency rules of §4.6, rejecting any seat
  or element without a position or outside the canvas, and any section in
  which two seats share a `row` and `col`;
- draws its canonical view as §4.5 defines it, every seat at its `x`/`y`
  with the footprint of §4.3.1, and never moves a seat because of its
  `row`, its `col`, or its row's shape (§4.2.3, §4.3.5);
- derives adjacency only as §4.3.5 defines it;
- orders a map's sections as defined by §4.1.1, and a section's rows as
  defined by §4.2.1;
- applies the price-resolution order of §4.9; and
- ignores unrecognized members rather than rejecting the document
  because of them (§2).

**Validators MUST enforce seat positions at v1.0** — this is not
deferred to a future minor version. A `KerusiMap` with a seat that has no
position, or a position off its canvas, is invalid from the first stable
release.

A validator implementation SHOULD be published as a JSON Schema per
version (§8) so that conformance can be checked mechanically rather than
by inspection of this document.

Rejecting a document with a dangling `row`/`type`/`priceTier`/`companions`
reference, a duplicate identifier, a seat off the canvas, or two seats
sharing a row and column (§4.6), is deliberately strict rather than
lenient: silently dropping or mis-pricing the affected
seat instead would hide a producer/consumer sync bug behind a
customer-facing symptom, at exactly the point where it is most expensive
to diagnose. This specification does not relax that rule, but
implementers are not required to discover it at render time — a producer
SHOULD validate a `KerusiMap` before publishing it (e.g. in CI, against
the JSON Schema above), and a gateway or intermediary SHOULD treat a
validation failure as an alertable condition rather than degrade
silently, so that referential or positional drift is caught long before it
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
  "STAIRS" printed mid-row? Rev 15 settled an `Element`'s geometry — it is
  placed and sized in canvas units, as a seat is (§4.4.1) — so what
  remains open here is the `kind` vocabulary, not the geometry underneath
  it. A `"table"` kind, for drawing a tabletop under a `circle` row
  (§4.2.3), would belong in that vocabulary.
- **Map-level directions.** Every section now shares one canvas (§4.5),
  so an `x` or `y` `Direction` (§4.10) describes the whole map, yet it is
  still declared per section, and two sections may disagree about which
  way the same axis faces. Whether `x`/`y` directions should move to
  `KerusiMap`, leaving `row`/`col` directions on `Section`.
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

- **1.0.0-draft, rev 15** — Replaced the three positioning modes with one
  canvas. Every seat is positioned, rows say which seats are neighbours,
  and row shapes record a row's intended form for editors.

  **Why.** `Section.layout` placed seats in three ways — `"grid"`,
  `"freeform"`, `"mixed"` — each with its own rules for seats, elements,
  empty rows, spans, and `aspectRatio`, and building a map editor and a
  booking app on the format showed that they do not compose. `"mixed"`
  could not express the case it existed for: displacing one seat around
  an obstruction meant inventing `x`/`y` for every other seat, and a
  `col` for seats that had none. A grid had no defined shape, since a
  renderer decided what a cell measured, so a map designer's canvas could
  only approximate the booking page. Freeform seats had a position and no
  size, and three implementations drew the same section at three seat
  sizes. `x` and `y` were percentages of different lengths, so rotations
  and element sizes needed `aspectRatio` to mean anything. Sections had
  an order and no position, so "rows in front of a stage, tables along one
  wall" could not be two sections side by side. And a curved row or a
  round table survived a round trip only in an editor's private
  `metadata`.

  **What changed.** Three kinds of information about a seat are now kept
  apart, so that they cannot contradict one another (§4.5):

  - *Where a seat is drawn.* `KerusiMap.canvas` and `KerusiMap.seatSize`
    are REQUIRED (§4.5): one canvas per map in units with the same scale
    both ways, and a square footprint for every seat, which a section MAY
    override. `Seat.x` and `Seat.y` are REQUIRED, in canvas units, and MUST
    lie on the canvas (§4.3.1); `rotation` is clockwise on screen.
    Renderers do no layout arithmetic, so two of them draw the same map
    identically, and whether seats overlap — which a validator SHOULD now
    report — is checkable from the document.
  - *Which seat is next to which.* `row` and `col` are OPTIONAL, `col` is
    a positive integer that requires `row`, and no two seats in a section
    share both (§4.3.5). Two seats are neighbours exactly when they share
    a section and a row and their `col`s differ by 1; a skipped `col` is
    an aisle. Neither field ever places a seat.
  - *What shape a row was meant to have.* `RowMeta.shape` is an OPTIONAL
    `line`, `arc`, or `circle` with a column range (§4.2.3). It is a guide
    for editors: it never moves a seat and never decides a seat's row, and
    a seat within `seatSize / 4` of its guide point is "on its guide," so
    an editor can re-space a curve while leaving one seat moved off it
    alone.

  Sections are named zones on the shared canvas rather than canvases of
  their own, with an OPTIONAL `bounds` for zooming and thumbnails (§4.1).
  `Element.x` and `Element.y` are REQUIRED, `width` and `height` are in
  canvas units and default to the seat size, and elements carry no `row`
  or `col` (§4.4.1). `Direction` labels for `x` and `y` now end at
  `canvas.width` and `canvas.height` rather than 100 (§4.10). §4.5.1 notes
  that a renderer MAY still offer views built from rows alone — a
  reflowed grid on a phone, a list for assistive technology — beside the
  canonical drawing. Every example in §6 is rewritten, and §6.7 is now a
  hall with an aisle, a seat moved off its row, a round table, and a
  curved balcony.

  **Removed.** `Section.layout`, its three modes, and the inference rules
  of the former §4.5; `Section.aspectRatio`; placing seats and elements by
  `row`/`col`, and element `width`/`height` as cell spans; `Element.row`
  and `Element.col`; and the empty rows of rev 12 that reserved vertical
  space. An empty row remains valid as a label but reserves nothing
  (§4.2.2): space is simply space on the canvas.

  **Questions settled.** This is a draft revision of 1.0 rather than a
  2.0, since 1.0 has not left draft and its only consumers are the
  editor's own. `seatSize` is a single number — a square seat — until a
  real case for wider seats (sofas, wheelchair bays, sleeper berths)
  appears. `bounds` is included now, as the one thing a consumer needs to
  zoom to a section. `seatSize / 4` is the guide tolerance. No
  section-level "block" shape is added: a `line` per row is enough to
  reopen a block of rows. Whether `x`/`y` directions move to the map is
  left open (§10).

  **Migrating a rev 14 map** (non-normative). A freeform section: choose a
  canvas with its `aspectRatio` (16:9 → 1600 × 900), then
  `x' = x / 100 × width` and `y' = y / 100 × height`, scaling element
  sizes the same way. A grid section: lay its cells out once with a fixed
  pitch — a 28-unit seat with a 6-unit gap reproduces a common renderer's
  current drawing — write the result as `x`/`y`, keep `row` and `col` as
  adjacency, and optionally give each row a `line` shape across its
  columns. A mixed section: as freeform, keeping `col` where it meant
  something and dropping it where it was only there to pass validation.
  Several sections: place them on one canvas in `index` order, stacked as
  they were drawn before, so that the drawing does not change, and
  optionally give each `bounds`. Arcs and tables kept in `metadata` become
  `arc` and `circle` shapes.

  This is a breaking change: no rev 14 map is valid under rev 15 without
  migration.
- **1.0.0-draft, rev 14** — Closed two gaps around sections.

  **Section order.** `Section.index` carried only an interface comment,
  "Display order among sections", so nothing said where unindexed
  sections go, what two sections sharing an `index` do, or whether a gap
  in `index` means anything. New §4.1.1 applies the §4.2.1 row rule to
  sections unchanged: indexed sections first by `index` ascending,
  unindexed ones after in declaration order, ties in declaration order,
  and `index` an ordering key rather than a position. This is the reading
  implementations already took, and it is additive: no previously valid
  document changes meaning.

  **Identifier uniqueness.** Only `Seat.id` was required to be unique
  within a map. §4.6 now states a scope for every id in a `KerusiMap`:
  `Section.id`, `Element.id`, `SeatType.id` and `PriceTier.id` are unique
  within the map, and `RowMeta.id` within its section, matching the
  section scoping of row references. `SeatType.id`, `PriceTier.id` and
  `RowMeta.id` are reference targets, so a duplicate made a reference
  resolve twice, a case the "fails to resolve" rule did not cover; and a
  seat type declared twice with different `defaultPriceTier`s made a
  seat's price ambiguous under §4.9. Validators already disagreed here,
  with at least one rejecting duplicate section and element ids by
  citing sections that did not say so. `Element.id` is scoped to the whole
  map, like `Seat.id`, rather than to its section; this is the stricter
  choice, chosen so that every map-level id follows one rule.

  The uniqueness rules are a restriction on producers, not an additive
  change. A duplicate id of any of these kinds is almost certainly a
  producer bug, and none of the examples in §6 contains one.
- **1.0.0-draft, rev 13** — Narrowed the timestamp requirement from "ISO
  8601" to an **RFC 3339 `date-time`**, stated once in a new §5.1.1 and
  referenced from every timestamp field (`KerusiState.updatedAt`,
  `SeatStatus.holdExpires`, `KerusiStateDelta.updatedAt`,
  `KerusiSession.startsAt`, `KerusiSession.endsAt`). "ISO 8601" admits forms
  — seconds omitted, basic format, ordinal and week dates, local times with
  no offset — that a consumer cannot reliably parse, and a consumer that
  cannot parse `holdExpires` cannot show a correct countdown, nor order a
  delta stream by `updatedAt` (§5.2). The narrowing also closes a gap between
  this document and the JSON Schemas published under §8, whose
  `format: "date-time"` has always meant RFC 3339: previously a producer could
  satisfy the prose and fail the schema.

  This is a restriction on producers, not an additive change. A document whose
  timestamps were already `2026-08-17T09:14:00Z` — the form every example in
  §6 uses — is unaffected.
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
