# RFC comment: make freeform the only positioning model

| | |
|---|---|
| Against | Kerusi v1.0.0-draft, rev 13 (`1d9c496`) |
| Raised from | kerusiweb 2.2.0 (`5683975`) and SeatMaps Easy (`9e0e665`): the designer and the booking seat picker |
| Status | Comment, for discussion before any spec text is drafted (README, "Contributing") |
| Date | 2026-10-14 |

Part 1 is the comment on the spec. Part 2 is the impact of acting on it, repo by repo. The
measurements in both come from running kerusiweb's own layout code (`buildRenderModel`,
`computeSectionLayout`, `buildNavigationGraph`) on the corpus and on small test maps.

`L` numbers are lines of `RFC/kerusi-standard_v1.0.0-draft.md` at rev 13. Bare kerusiweb file
names are under `projects/core/src/`; SeatMaps Easy paths are under `web/src/` unless they start
with `api/` or `docs/`.

---

## Part 1: the comment

### Summary

Positioning every seat and element by `x`/`y` would make Kerusi simpler and more
deterministic than it is with three modes. The proposal:

1. **`x` and `y` are REQUIRED on every `Seat` and every `Element`.**
2. **The `"grid"` and `"mixed"` modes are removed, and so is layout inference** (§4.5).
   `Section.layout` stays as an optional member whose only value is `"freeform"`, so every
   freeform document written today stays valid unchanged.
3. **`row` and `col` stay, but they no longer position anything.** `row` is a label and a
   grouping, and `Section.rows` is still its registry and order (§4.2, §4.2.1). `col` becomes an
   OPTIONAL ordering within a seat's row, which is what §4.3.1 already says it is for once
   `x`/`y` is present.
4. **Freeform gets the three things grid has been covering for:** a seat's size, the point
   `x`/`y` refers to, and the rotation pivot. They are needed whatever is decided about grid
   (see "Needed whatever is decided" below), but freeform-only can't ship without them.
5. **Grid→`x`/`y` conversion is published once**, as an informative appendix and a helper in
   `@kerusi/schema` (#8), so lattice-native producers (bus, rail, aircraft) all convert the same
   way.

The case in one line: §4.5's promise that "two independent renderers ... produce the same
layout" can only hold for freeform, and only once freeform defines a seat's size (A below). Grid
is deterministic as a topology, not as a picture, and mixed mode allows placements that have no
defined geometry at all.

### Evidence from implementation

#### 1. Grid fixes the order of seats, not the picture

§4.5 (L446) says strict modes guarantee "two independent renderers ... produce the same
layout". §4.4.1 (L437) and §6.7 (L1086) then leave the size of a cell to the renderer. In
practice the two consumers in this ecosystem draw the same grid document in different shapes:

| Consumer | How it draws a grid section |
|---|---|
| kerusiweb (`section-layout.ts:102`) | Fixed 28-unit cell, 6-unit gap, half-cell padding. Section sized from its own rows and columns; `aspectRatio` ignored. |
| SeatMaps Easy designer (`designer/layout/geometry.ts:85`) | Square cells sized to fit the room's `aspectRatio`; seat = 0.8 of a cell. |

Both are conformant, because §4.5 (L500) says `aspectRatio` "has no effect on grid-addressed
seats". The effect on a product:

- SeatMaps Easy had to document that a room's chosen shape doesn't reach the booking page while
  the room holds only rows (`docs/designer.md`, "Rooms set out in rows"). The designer and the
  customer see different proportions.
- Its fit-to-screen behaviour for tall rooms (BOOK-14) skips grid sections, since only freeform
  and mixed have a shape to fit (`booking/roomFit.ts:27`). All three development sample events
  use grid seed maps, so none of them gets it.

Grid doesn't even fix the order in every case. A grid section with no `rows` registry has no
defined row order: §4.1 (L209) says the order of `seats` "is not significant", and §4.2.1 (L243)
orders rows only "where a section declares `rows`". kerusiweb stacks such rows in the order they
first appear in `seats` (`build-render-model.ts:165`); another renderer could sort the labels
and draw row "10" above row "2". Both would be conformant. A freeform section never has this
problem, because `y` is the order.

#### 2. Mixed mode allows placements that have no geometry

§4.4.1 (L420) lets an element in a mixed section be positioned by `row`/`col` alone, and §4.2.2
(L274) says empty rows reserve space "for row-addressed elements in a mixed one". But a mixed
section is placed by `x`/`y` (§4.3.1), and nothing in the spec says where row N or column C is on
that canvas. kerusiweb, whose conformance report covers every §7 requirement, falls back to the
section's centre (`section-layout.ts:226`). Both corpus documents that use this render wrong:

| Corpus file | What the author meant | What kerusiweb 2.2.0 draws |
|---|---|---|
| `mixed-row-only-element` | A full-width SCREEN across the top two rows, above row A (seats at `y` ≈ 60) | A 60 × 11 box in the middle of a 1000 × 563 canvas (x 470–530, y 276–287) |
| `stadium-mixed` | STAIRS in the `walkway` row at column 3, beside seats at `x` 10–16 | A 60 × 34 box at x 47–53%, the middle of the stand |

kerusiweb isn't the problem here: the spec gives it nothing to implement. SeatMaps Easy avoids the
case by writing `x`/`y` on everything in a mixed room and refusing to open maps that don't
(`docs/designer.md`, "Saved maps").

#### 3. SeatMaps Easy only uses grid as a starting state

The designer writes `layout: "grid"` in exactly one case: the Rows tool in an empty room. Placing
anything else converts the section to mixed with `asMixed` (`designer/layout/mixed.ts:99`). That
function is a grid→`x`/`y` conversion: rows re-spaced at 1.25 seats, full-width elements given
the whole column span, refusals when the rows don't fit. So the product already converts grid
away, and the format carries both forms of the same seats.

Mixed mode also requires `col` on every seat (§4.5, L464). The designer meets that by reading
the number at the end of the seat id (`columnOf`). The value exists to satisfy the rule, not
because the designer has any column data.

#### 4. Most spec revisions have been about grid and freeform living together

Rev 2 (flat seat list), rev 5 (`col` versus `x`/`y` precedence), rev 9 (strict modes), rev 10
(the mixed-mode complexity concern, kept), rev 12 (empty rows and cell spans, from #4). Rev 12
added a whole mechanism (the row registry as geometry, cell spans, the row-span bound) to give
grid vertical space, which freeform already gets from `y`.

#### 5. The modes drive much of the validation

- 5 of the 17 rule codes in `semantic-rules.mjs` exist for the modes:
  `layout-inference-inconsistent`, `seat-layout-mismatch`, `element-layout-mismatch`,
  `element-span-invalid`, `element-row-span-overrun`.
- About 220 of the map schema's 717 lines are the per-mode `allOf` branches.
- The two validators already disagree on one case. For a section with no seats and no `layout`,
  kerusiweb infers `grid` (`kerusi-layout-mode.ts:59`), while the reference validator calls it
  indeterminate and checks nothing (`semantic-rules.mjs:60`).

#### 6. `width` and `height` have two units

They are cell spans in grid, percentages in freeform, and in mixed it depends on whether that
element has `x`/`y`. One field name covers two measurement systems.

### What freeform-only has to add

Grid has been covering for gaps in freeform. Removing it exposes them.

#### A. A seat's size (blocking)

The spec gives a freeform seat a position but no size. A grid seat gets one for free: its cell.
Today three consumers pick three sizes:

| Consumer | A freeform seat's edge |
|---|---|
| kerusiweb core, no `seatSize` passed (`section-layout.ts:214`) | 5% of the section's shorter side |
| kerusiweb React and Angular bindings (default `seatSize` 28 on a 1000-wide viewBox) | 2.8% of width |
| SeatMaps Easy designer (`geometry.ts:71`) | 2.5% of width |

In a square room the first is twice the third. So whether two seats overlap depends on the
renderer, which is exactly the disagreement rev 9 made the modes strict to prevent. It gets
worse under freeform-only: a bus converted from grid (5:1, seats 20% of the width apart) drawn
with 2.8% seats is a row of dots.

Proposal: `Section.seatSize?: number`, the edge of a seat's square footprint as a percentage of
the section's width, with a stated default (2.5, near what's drawn today). Whether a `SeatType`
needs its own size (a wheelchair space, a sofa) is an open question below.

#### B. The anchor point and the rotation pivot (blocking)

§4.3 (L292) and §4.4 make `x`/`y` percentages but never say of which point. kerusiweb and
SeatMaps Easy both use the centre, and §6.2's screen (`x` 50, `width` 80) only fits if it is the
centre. Proposed text:

> `x`/`y` is the centre of the seat's or element's footprint. `rotation` is in degrees, turning
> from the +`x` axis toward the +`y` axis, about that centre.

Defining the direction of rotation by the axes, not by "clockwise", means it stays correct when a
renderer mirrors `x` for a right-to-left locale (§2), as long as it negates `rotation` when it
does.

#### C. Elements

Elements need `x`/`y` (already true in freeform, §4.4.1), and either a stated default for
`width`/`height` or a requirement to give them. kerusiweb defaults to 6%; nothing says so.

#### D. Seat order without geometry

`col` is the seat order keyboards and screen readers use (§4.3.1). If it's absent, renderers
fall back on heuristics. kerusiweb groups by `row` labels, else by `y`, then orders by `x`
(`navigation-order.ts`, documented as a heuristic). That gets round tables wrong: SeatMaps Easy's
tables are circles of seats, and ordering by `x` zigzags across the table. So `col` should stay
as an OPTIONAL ordering with no geometry, and renderers fall back to `x` when it is missing.

### Needed whatever is decided

If grid stays, these still need fixing:

1. **Mixed mode's elements placed by `row`/`col`** (evidence 2). Either define where a row and a
   column sit on a mixed canvas, or require `x`/`y` on every element in a mixed section.
2. **Row order in a grid section without a `rows` registry** (evidence 1). Either define it
   (first appearance in `seats`, which means `seats` order becomes significant), or require
   `rows` in every grid section with more than one row.
3. **A seat's size** (A).
4. **The anchor point and the rotation pivot** (B).

### Objections, and replies

**"Use freeform instead" is a real cost: hand-computing percentages for hundreds of seats in a
regular lattice, and losing grid's validation** (#4, "Anticipating the obvious objection").
The computation is the six-line conversion in the appendix below. It is written once, in
`@kerusi/schema`, not by each producer. In practice tools write seat maps, not people. And grid's
validation was about integrality of `col` and spans; under freeform-only it becomes "`x` and `y`
are present and between 0 and 100", which is simpler.

**Lattice-native producers lose a format with no geometry.** This is the real cost. Airline and
rail seat maps arrive as row plus column letter, with aisles as column breaks. Today such a
producer can leave proportions to the renderer. Under this proposal it has to choose an aspect
ratio and a seat size, even if only through the helper's defaults. The conversion makes that
mechanical; it doesn't remove it.

**It breaks a minimal document.** §2's "rows of seats and nothing else" becomes "seats with
coordinates and nothing else". Every seat gains two numbers.

**It is a breaking change at rev 14.** The draft status (§"Status of This Document") allows it.
The known implementations are kerusiweb (would need a major release) and SeatMaps Easy (not
launched; see Part 2).

**The alternative: keep grid, drop mixed.** This removes evidence 2 and the `col`-on-every-seat
rule. But it keeps two geometry systems, `aspectRatio` ignored for grid, §4.2.2 and the spans,
and SeatMaps Easy's mismatch between designer and booking page. A renderer still implements two
layouts. It is the fallback if the cost to lattice-native producers is judged too high.

### Proposed changes, section by section

| § | Today | Proposed |
|---|---|---|
| §1 item 4 (L90) | Freeform "alongside" row/column addressing | Every seat is placed by `x`/`y` on a canvas of declared proportions; `row` and `col` remain as labels and order |
| §2, progressive enhancement (L115) | Minimal map = rows of seats | Minimal map = seats with coordinates |
| §2, reading direction (L128) | `col` is an ordering, not a screen direction | Unchanged. Add: mirroring `x` negates `rotation` |
| §4.1 (L203–204) | `layout?: "grid" \| "freeform" \| "mixed"`; `aspectRatio` "meaningful only for freeform/mixed" | `layout?: "freeform"`, kept as an extension point; add `seatSize?: number`; `aspectRatio` always applies |
| §4.2, §4.2.1 | Row registry and order | Unchanged: they order labels, reading and keyboard navigation |
| §4.2.2 (L261) | Empty rows reserve vertical space | Removed. An empty `RowMeta` stays valid and reserves nothing; space is `y` |
| §4.3 (L292) | `col`, `x`, `y` all optional | `x`, `y` REQUIRED; `col` is an ordering within the row, with no geometry |
| §4.3.1 (L308) | Positioning per mode | `x`/`y` places, `col` orders. The per-mode rules go |
| §4.3.2 (L328) | Skipped columns, declared empty rows | Seats that don't exist are absent; space with a label is an `Element`. The row/column asymmetry paragraph goes |
| §4.4, §4.4.1 (L384, L409) | `row`+`col` or `x`/`y`; spans in grid | `x`/`y` REQUIRED; `width`/`height` are percentages with a default; `row` only as a label; `col` removed from `Element` |
| §4.5 (L442) | Three modes, inference | Becomes "Coordinates": `aspectRatio`, anchor point, rotation, `seatSize` |
| §4.6 (L532–546) | Layout consistency, span and row-span rules | Removed. Reference resolution, including `Element.row`, stays |
| §4.10 (L610) | Axes `row`, `col`, `x`, `y` | Unchanged: `row` and `col` still have an order |
| §6.1, §6.3, §6.6 | Grid documents | Rewritten with `x`/`y` (see the bus in the appendix) |
| §6.7 (L1029) | Grid cinema with headroom | Removed; §6.2 already shows a cinema |
| §7 (L1111–1124) | Enforce layout consistency, materialize empty rows, enforce spans; "Validators MUST enforce `Section.layout` consistency at v1.0" | Those three bullets and the paragraph go. Add: reject a seat or element without `x` and `y` |
| §10 | Labelled gaps; `domain` | Both unchanged (labelled gaps keeps its `kind` vocabulary question); add the open questions below |
| §11 | | A rev 14 entry, marked breaking, citing this comment |
| New appendix | | Converting a grid to coordinates (informative), below |

### Appendix: converting a grid to coordinates (informative)

For a grid with `R` rows in §4.2.1 order (empty rows included; with no registry, the order rows
first appear in `seats`, as kerusiweb draws them) and columns `cMin..cMax`, `C = cMax − cMin + 1`:

- `aspectRatio` = `C:R` (reduced), so every cell is square
- a seat in row index `r`, column `c`: `x = (c − cMin + 0.5) / C × 100`, `y = (r + 0.5) / R × 100`
- `seatSize = 80 / C` (a seat fills 80% of its cell)
- an element at row index `r` spanning `h` rows, and column `c` spanning `w` columns:
  `x = (c − cMin + w/2) / C × 100`, `y = (r + h/2) / R × 100`, `width = w / C × 100`,
  `height = h / R × 100`. With no `col`: `x = 50`, `width = 100`.
- `row` and `col` stay on the seats, as a label and an ordering.

§6.1's bus (columns 1, 2, 4, 5; one row) becomes:

```json
{
  "id": "main",
  "aspectRatio": "5:1",
  "seatSize": 16,
  "seats": [
    { "id": "1A", "row": "1", "col": 1, "x": 10, "y": 50, "type": "standard" },
    { "id": "1B", "row": "1", "col": 2, "x": 30, "y": 50, "type": "standard" },
    { "id": "1C", "row": "1", "col": 4, "x": 70, "y": 50, "type": "standard" },
    { "id": "1D", "row": "1", "col": 5, "x": 90, "y": 50, "type": "standard" }
  ]
}
```

The aisle is still just absence: there is no seat at `x` 50.

### Open questions for the editor

1. **`Section.layout`: keep as `"freeform"` only, or remove it?** Keeping it is recommended. The
   schema sets `additionalProperties: false` on `Section`, so removing the member would make every
   document that declares `"freeform"` today fail the schema. It also leaves room to add a mode in
   a later version.
2. **Accept `"mixed"` as a deprecated alias during the draft?** Not recommended. The fix is a
   one-word edit, since mixed seats already carry `x`/`y` and `col` stays valid.
3. **`seatSize` per section only, or also per `SeatType`?** Per section covers every map in the
   corpus and in SeatMaps Easy. Per type would serve wheelchair spaces and sofas.
4. **Is the conversion appendix informative or normative?** Informative is recommended: it is one
   good way to convert, not the only one.

---

## Part 2: impact analysis

### kerusi: spec, schema, corpus

| Area | Change | Size |
|---|---|---|
| RFC | The table above | Net removal, roughly 150–200 lines; §6.7 and §4.2.2 go whole |
| `kerusi-map-1.0.schema.json` | Per-mode `allOf` branches replaced by `required: ["x", "y"]` on Seat and Element; `layout` enum `["freeform"]`; `seatSize` added; `width`/`height` become plain percentages | About 220 of 717 lines removed |
| `semantic-rules.mjs` | `inferLayout`, `effectiveLayout` and the 5 mode rule codes go; `rowOrder` stays, renderers use it for reading order | 5 of 17 rule codes |
| `kerusi-1.0.d.ts` | `Seat.x`/`y` and `Element.x`/`y` required; `layout?: "freeform"`; `seatSize` | Small |
| Corpus | 19 of 28 map fixtures use seats with `col` only, mostly because it's the shortest valid seat, and need `x`/`y` added. Mode-specific fixtures are deleted: `cinema-hallB-grid`, `mixed-row-only-element`, `grid-element-fractional-span`, `grid-element-with-xy`, `grid-seat-with-xy`, `mixed-element-fractional-span`, `mixed-seat-missing-xy`, `inferred-layout-inconsistent`, `element-rowspan-overruns`. `stadium-mixed` keeps its seats, but its STAIRS needs `x`/`y`. `freeform-seat-with-col` becomes **valid** and moves to `examples/`. New invalid fixtures: a seat without `y`, an element without `x`/`y`, `seatSize` out of range | Mechanical, scriptable with the conversion |
| Tests | `test/semantic-cases.mjs` (26 grid mentions) | Mostly deleted |
| README | The "Freeform and grid positioning" bullet | One line |
| #8 (`@kerusi/schema`) | The natural home for the conversion helper (`fromGrid`) | New, small |

### kerusiweb

| Area | Change |
|---|---|
| `section-layout.ts` | `computeGridLayout`, `columnExtent`, `gridSpan` deleted (about 110 lines). The freeform path reads `Section.seatSize`. The `seatGap` input (used only by grid) goes from both bindings, and `seatSize` becomes a fallback percentage rather than viewBox units: an API change |
| `kerusi-layout-mode.ts` (192 lines) | Shrinks to "every seat and element has `x` and `y`" |
| `kerusi-validator.ts` | The `section-layout-*`, `element-layout-mismatch`, `element-span-invalid` and `element-row-span-overrun` rules go |
| `navigation-order.ts` | `gridBands` becomes "bands by row label, ordered by `col` when present, else `x`". Keyboard order for existing mixed documents is unchanged |
| **Right-to-left** | **An existing bug that becomes the main path.** Only grid sections are mirrored (`colX`). Freeform and mixed are not, but their arrow keys are still swapped. Measured with `locale: "ar"`: in a freeform row with A1 drawn at x 100 and A2 at x 200, ArrowLeft from A1 goes to A2, the seat drawn on its right. Grid is correct. Under freeform-only, mirroring `x` and negating `rotation` has to move into the freeform layout, or RTL loses layout mirroring altogether |
| Demos | 3 of the 5 scenarios (aircraft, cinema, train) are grid; converted with the appendix |
| Docs | README's "All three positioning modes" row, `docs/kerusi.md`'s modes tour, the conformance report's §4.5 table |
| Tests | 13 spec files mention grid; `kerusi-layout-mode.spec.ts` (35 mentions) is mostly deleted |
| Release | Breaking: 3.0.0. Recommended: keep a `lowerGrid()` adapter in core for one major release, so 2.x documents still render (converted on load) while producers move |

### SeatMaps Easy

The product hasn't launched (`docs/deploy.md`: "the host is not chosen yet"), so no production
maps need migrating. Booking, pricing, holds, checkout and RSVP read seat ids, seat types and
prices, none of which change, so they are untouched.

| Area | Change |
|---|---|
| Rows tool (`designer/layout/grid.ts:63`, `generateGrid`) | Writes rows with `x`/`y` in every room, as `addBlock` already does in rooms that aren't empty. **Needs a decision:** keep **Update rows** for a room holding only rows (the designer has to remember the block, for example in `RowMeta.metadata` as arc rows already do), or drop it (rows can be moved straight away, as in mixed rooms today) |
| Grid→mixed conversion (`mixed.ts:99` `asMixed`, `becomesMixed`, the grid branch of `roomFor`) | Deleted, along with the "The rows are now seats you can move" message and the "rows too big to fit at that spacing" refusal |
| Grid drawing (`geometry.ts:85` `gridOf`, `placeGridSeat`, `placeGridElement`) | Deleted; the designer draws one way, the same as kerusiweb |
| `layout !== 'grid'` guards | Removed in `element.ts`, `PropertiesPanel.tsx`, `arc.ts`, `table.ts`, `freeform.ts` |
| `withColumns` / `columnOf` | Kept but optional: `col` is no longer required, though it still gives tables a sensible reading order |
| **Seat limits** | **A regression to avoid.** A room holding only rows takes up to 40 rows × 50 seats (500 seats at most) today, because the renderer sizes grid cells. At the designer's fixed seat (2.5% of width) a Wide room fits 32 seats across and 18 rows down, so layouts like 25 rows × 20 seats would be refused. With `Section.seatSize` (A), the designer can shrink seats to fit instead. This is SeatMaps Easy's reason why A is blocking |
| Serializer (`kerusi/deserialize.ts`, `model/types.ts`) | The `if (!source.layout) throw` and the mixed branch change; `SectionLayout` becomes `'freeform'` |
| Vendored Kerusi files (`kerusi/vendor/`, `api/src/SeatMapsEasy.Booking/Kerusi/`) | Copied again from the new rev. Until then the vendored schema rejects `seatSize` (`additionalProperties: false`), so the spec has to land first |
| Booking picker (`booking/roomFit.ts:27`) | The condition becomes "exactly one section", so the BOOK-14 fit applies to every designer map and to the sample events |
| Seed maps (`api/src/SeatMapsEasy.Cloud/seed/maps/`) | All 3 are grid; converted with the appendix |
| Development databases | Saved mixed maps: `"mixed"` → `"freeform"`. Saved grid maps: converted, or reset the database |
| API (`KerusiDocuments.cs`, `KerusiMapValidator.cs`) | `Layout` and `Col` stay optional; the comment about layout inference goes |
| Docs | `designer.md` (Modes, "Rooms set out in rows", "Grid mode (DSGN-2)", "Mixed rooms (DSGN-7)", "Saved maps"), `booking-flow.md` (the BOOK-14 sentence on grid sections), `kerusi.md`; the decisions of 2026-10-04 and 2026-10-11 superseded through `record-decision` |
| What the product gains | The room's shape shows on the booking page for every map. The designer and the booking page draw the same proportions. The grid→mixed conversion step, and its refusals, disappear |

### Order of work

1. **kerusi:** rev 14, schema, corpus, and the conversion helper (#8). Nothing downstream can
   move until `seatSize` is in the schema.
2. **kerusiweb 3.0:** freeform only, `seatSize`, RTL mirroring for freeform, and optionally the
   `lowerGrid()` adapter.
3. **SeatMaps Easy:** move to `@kerusiweb/*@^3` and the new schema, change the designer, convert
   the seeds, record the decision.

### Disclosure

Raised from kerusiweb and SeatMaps Easy, which implement this format. The SeatMaps Easy
designer's grid→mixed conversion (`asMixed`) is in effect the conversion this proposal asks
`@kerusi/schema` to publish once, for every producer.
