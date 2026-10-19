/**
 * TypeScript interfaces for the Kerusi seat map and availability format,
 * v1.0.0-draft, rev 17 — a transcription of the declarations in sections 4
 * and 5 of RFC/kerusi-standard_v1.0.0-draft.md.
 *
 * Section 8 names `@kerusi/schema` (JSON Schema plus TypeScript types, no
 * runtime dependencies) as the package these belong in. Types are declarations
 * only: they carry no runtime cost and enforce nothing on a parsed document.
 * The rules that a document must satisfy — including every rule the structural
 * type system cannot state — are enforced by the schemas in this directory and
 * by ./validator.mjs.
 *
 * Where a rule cannot be expressed in the type system, it is noted at the
 * member it applies to rather than silently dropped.
 */

/** A label that is either a plain string or a locale map keyed by BCP-47 tag. */
export type LocalizableString = string | Record<string, string>;

// --- Section 4: the KerusiMap document -------------------------------------

/** The reusable physical configuration: canvas, legend, price tiers, sections (section 4). */
export interface KerusiMap {
  /** The version of the specification this document conforms to. */
  kerusi: '1.0';
  /** Unique id for this map, e.g. "cinema3-hallA". */
  id: string;
  /** Human label, e.g. "Hall A". */
  name?: string;
  /**
   * Free-text hint: "cinema" | "flight" | "theatre" | "stadium" | "bus" |
   * "train" | "custom". Explicitly non-normative — a consumer MUST NOT reject a
   * document, and MUST NOT alter required-field validation, on its basis.
   */
  domain?: string;
  /** BCP-47 language tag. Default: "en". */
  locale?: string;
  /**
   * The one drawing surface every seat, element and section is placed on
   * (section 4.5). Unitless, with the same scale on both axes.
   */
  canvas: Canvas;
  /**
   * A seat's footprint: a square of this side, in canvas units, centred on the
   * seat's x/y and turned by its rotation (section 4.5). Positive. A section
   * MAY override it.
   */
  seatSize: number;
  /** Vocabulary of seat types used in this map; `Seat.type` resolves against it. */
  legend: SeatType[];
  /** Named price tiers, referenced by id. */
  priceTiers?: PriceTier[];
  /** How the whole venue may be booked (section 4.12). Default: "seats". */
  booking?: BookingMode;
  /** Venue hire: a literal whole price, over `wholePriceTier` (section 4.9.1). */
  wholePrice?: Money;
  /** References a `PriceTier.id`: the whole venue's price (section 4.9.1). */
  wholePriceTier?: string;
  sections: Section[];
  metadata?: Record<string, unknown>;
}

/**
 * The map's canvas (section 4.5). Both dimensions positive. The origin is the
 * top-left corner, x grows to the right and y grows downwards.
 */
export interface Canvas {
  width: number;
  height: number;
}

/** A rectangle on the canvas: top-left corner and size, in canvas units. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** [x, y] in canvas units. */
export type Point = [number, number];

/**
 * A named zone on the map's canvas (section 4.1) — not a canvas of its own.
 * Holds a flat list of seats, not a grid of rows containing seats.
 */
export interface Section {
  /** Unique within the KerusiMap (section 4.6). */
  id: string;
  /** String, or locale map: { "en": "Orchestra", "ms": "Orkestra" }. */
  label?: LocalizableString;
  /**
   * Ordering key among sections (section 4.1.1) — an ordering key, not a
   * position. Indexed sections come first, ascending; unindexed ones follow in
   * declaration order; ties keep declaration order.
   */
  index?: number;
  /** Overrides `KerusiMap.seatSize` for this section's seats and elements. */
  seatSize?: number;
  /**
   * The section's extent on the canvas, for zooming to a section, thumbnails
   * and legends. Does not affect drawing; the section's seats SHOULD lie
   * inside it.
   */
  bounds?: Bounds;
  /**
   * Optional row registry — labels, order, shapes. NOT a container: seats stay
   * in `seats` (section 4.2). When present it is the section's complete,
   * ordered row registry, and every `Seat.row` MUST resolve against it.
   */
  rows?: RowMeta[];
  /** Optional, purely informational human-facing axis labels (section 4.10). */
  directions?: Direction[];
  /** Flat list; order is not significant. */
  seats: Seat[];
  /** Non-bookable features: screens, stages, aisles, stairs. */
  elements?: Element[];
  /** Pieces of furniture and sets of seats that belong together (section 4.11). */
  groups?: Group[];
  /** How this section — a room or zone — may be booked (section 4.12). Default: "seats". */
  booking?: BookingMode;
  /** Room hire: a literal whole price, over `wholePriceTier` (section 4.9.1). */
  wholePrice?: Money;
  /** References a `PriceTier.id`: the whole section's price (section 4.9.1). */
  wholePriceTier?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Purely descriptive row metadata (section 4.2). A `RowMeta` that no seat
 * references is valid and reserves no space (section 4.2.2).
 */
export interface RowMeta {
  /** Unique within its section; another section MAY reuse it (section 4.6). */
  id: string;
  label?: string;
  /**
   * Ordering key among rows in the section (section 4.2.1) — an ordering key,
   * not a position. Rows at index 0 and 11 with nothing between them are
   * adjacent.
   */
  index?: number;
  /**
   * The form the row was laid out in, for editors (section 4.2.3). A guide
   * only: it MUST NOT move any seat, renderers ignore it, and it never decides
   * which row a seat is in.
   */
  shape?: RowShape;
  metadata?: Record<string, unknown>;
}

/**
 * Exactly one of `line`, `arc` or `circle` (section 4.2.3). Angles are in
 * degrees on the canvas axes — 0 points right, 90 points down — and `cols` is
 * [first, last], with first not exceeding last.
 */
export type RowShape =
  | { line: { from: Point; to: Point; cols: [number, number] } }
  | {
      arc: {
        center: Point;
        radius: number;
        start: number;
        /** Positive turns clockwise on screen. */
        sweep: number;
        cols: [number, number];
      };
    }
  | { circle: { center: Point; radius: number; start: number; cols: [number, number] } };

export interface Seat {
  /** Unique within the whole KerusiMap, not merely within its section. */
  id: string;
  /** Display label, e.g. "12" or "12A". Defaults to id. */
  label?: string;
  /**
   * References `RowMeta.id` when the section declares `rows`; free text
   * otherwise. The only way a seat joins a row (section 4.2.3).
   */
  row?: string;
  /**
   * Positive integer adjacency ordinal within `row`, which it requires. Seats
   * in the same section and row whose cols differ by 1 are neighbours; a
   * skipped col is an aisle (section 4.3.5). No two seats in a section share a
   * row and col. Never affects where the seat is drawn.
   */
  col?: number;
  /** Centre of the footprint, in canvas units, 0 to `canvas.width` (section 4.3.1). */
  x: number;
  /** Centre of the footprint, in canvas units, 0 to `canvas.height`. */
  y: number;
  /**
   * Degrees, clockwise on screen, about the seat's centre. At 0 the seat faces
   * up the canvas, towards y = 0, with its back towards +y (section 4.3.1).
   */
  rotation?: number;
  /** References a `SeatType.id` in the map's legend. */
  type: string;
  /** References a `PriceTier.id`. */
  priceTier?: string;
  /** Literal override; takes precedence over `priceTier` (section 4.9). */
  price?: Money;
  /**
   * Retired in rev 17 (section 4.12.4): seats booked together are a `Group`
   * with `booking: "whole"`. A validator rejects a seat that carries it.
   */
  companions?: never;
  /**
   * Free, non-exclusive tags: "aisle" | "window" | "extra-legroom" | … .
   * MUST NOT independently affect price (section 4.3.3).
   */
  attributes?: string[];
  accessibility?: Accessibility;
  metadata?: Record<string, unknown>;
}

/** Structured accessibility properties (section 4.3.4). All members OPTIONAL. */
export interface Accessibility {
  /** Seat or space usable by a wheelchair user. */
  wheelchairAccessible?: boolean;
  transferArmrest?: 'left' | 'right' | 'both' | 'fixed' | 'none';
  /** Reachable via aisle-chair transfer. */
  aisleChairCompatible?: boolean;
  /**
   * Occupant is expected to need an adjacent companion seat. Link the actual
   * companion seat with a group booked whole (sections 4.11 and 4.12).
   */
  companionRequired?: boolean;
}

/**
 * A non-bookable feature that still requires rendering (section 4.4), placed on
 * the canvas exactly as a seat is (section 4.4.1).
 */
export interface Element {
  /** Unique within the whole KerusiMap, not merely within its section (section 4.6). */
  id: string;
  /** "screen" | "stage" | "exit" | "lavatory" | "gap" | "aisle" | implementation-defined. */
  kind: string;
  label?: string;
  /** Centre, in canvas units, 0 to `canvas.width`. */
  x: number;
  /** Centre, in canvas units, 0 to `canvas.height`. */
  y: number;
  /** Canvas units. Default: the applicable seatSize. */
  width?: number;
  /** Canvas units. Default: the applicable seatSize. */
  height?: number;
  /** Degrees, clockwise on screen, about the element's centre. */
  rotation?: number;
  metadata?: Record<string, unknown>;
}

/**
 * A named set of seats in one section that belong to one piece of furniture or
 * one booking (section 4.11). Groups don't nest; a seat belongs to at most one.
 */
export interface Group {
  /** Unique within the whole KerusiMap, across all sections (section 4.6). */
  id: string;
  /**
   * What the group is. Informational: it chooses how the piece is drawn and how
   * its seats are named, and MUST NOT affect price, validation or booking.
   */
  kind: GroupKind | (string & {});
  /** e.g. "Table 3", "Pew 12". */
  label?: LocalizableString;
  /** Seat ids in this group's section. At least one, each once. */
  seats: string[];
  /** The piece's own footprint, drawn under its seats. */
  shape?: GroupShape;
  /** How this group may be booked (section 4.12). Default: "seats". */
  booking?: BookingMode;
  /** A table or sofa price: a literal whole price, over `wholePriceTier` (section 4.9.1). */
  wholePrice?: Money;
  /** References a `PriceTier.id`: the whole group's price (section 4.9.1). */
  wholePriceTier?: string;
  metadata?: Record<string, unknown>;
}

/** The registered group kinds (section 4.11). */
export type GroupKind = 'table' | 'sofa' | 'loveseat' | 'pew' | 'bench' | 'booth' | 'box' | 'companion';

/**
 * Exactly one of `rect` or `circle`, in canvas units (section 4.11). A `rect`
 * is centred on its x/y and turned by `rotation`, as an element is.
 */
export type GroupShape =
  | { rect: { x: number; y: number; width: number; height: number; rotation?: number } }
  | { circle: { center: Point; radius: number } };

/**
 * How a level — the map, a section, a group — may be booked (section 4.12).
 * "seats": the level adds nothing. "whole": its seats are booked only all
 * together. "either": as "seats", and the whole level is also offered as one
 * booking.
 */
export type BookingMode = 'seats' | 'whole' | 'either';

/**
 * The registered seat forms (section 4.7.1). `sofa` and `bench` are one place
 * on a sofa or a pew, not the whole piece of furniture.
 */
export type SeatForm =
  | 'chair'
  | 'armchair'
  | 'stool'
  | 'recliner'
  | 'beanbag'
  | 'cushion'
  | 'wheelchair-space'
  | 'sofa'
  | 'bench';

/** A legend entry (section 4.7). */
export interface SeatType {
  /** Unique within the legend (section 4.6). e.g. "standard" | "recliner" | "wheelchair" | "business". */
  id: string;
  label?: LocalizableString;
  /** Suggested render color, hex. Non-normative hint. */
  color?: string;
  /**
   * What one place of this type looks like (section 4.7.1); `"chair"` when
   * absent. A drawing hint: it never affects price, adjacency or the
   * footprint. Any other non-empty string is implementation-defined and drawn
   * as a chair by a consumer that does not know it.
   */
  form?: SeatForm | (string & {});
  /** References a `PriceTier.id` (section 4.9 step 3). */
  defaultPriceTier?: string;
}

export interface PriceTier {
  /** Unique within the KerusiMap (section 4.6). */
  id: string;
  label?: string;
  price: Money;
}

export interface Money {
  /** Minor units (e.g. cents), to avoid floating-point error. */
  amount: number;
  /** ISO 4217, e.g. "MYR", "USD". Exactly one currency applies to a whole map. */
  currency: string;
}

/**
 * An optional, purely descriptive label pair for one axis (section 4.10).
 * Non-normative: it MUST NOT be used by a validator to reject a document, nor
 * relied upon by a renderer to decide layout.
 */
export interface Direction {
  axis: 'row' | 'col' | 'x' | 'y';
  /** Label for the low end — ascending row/col order from the first row/col, or x/y = 0. */
  low: LocalizableString;
  /** Label for the high end — descending row/col order, or x = canvas.width / y = canvas.height. */
  high: LocalizableString;
}

// --- Section 5: state, deltas and sessions ---------------------------------

/**
 * A complete availability snapshot (section 5.1). Sparse: a seat absent from
 * `seats` MUST be interpreted as "available".
 */
export interface KerusiState {
  kerusi: '1.0';
  /** Matches `KerusiSession.id`. Exactly one of sessionId/mapId MUST be present. */
  sessionId?: string;
  /** Matches `KerusiMap.id` directly, for documents with no session concept. */
  mapId?: string;
  /** RFC 3339 date-time (section 5.1.1). */
  updatedAt: string;
  /** Keyed by `Seat.id`. Only non-default entries need be included. */
  seats: Record<string, SeatStatus>;
}

export interface SeatStatus {
  status: 'available' | 'held' | 'booked' | 'blocked';
  /** RFC 3339 date-time. Meaningful only when status === "held". */
  holdExpires?: string;
  metadata?: Record<string, unknown>;
}

/**
 * An incremental update for a push transport (section 5.2). Every entry in
 * `changes` IS a change; a seat's absence means "unchanged" — the opposite of
 * `KerusiState`'s sparse rule.
 */
export interface KerusiStateDelta {
  kerusi: '1.0';
  sessionId?: string;
  mapId?: string;
  /**
   * RFC 3339 date-time, strictly increasing per session/map, so a consumer can
   * detect and discard an out-of-order delta.
   */
  updatedAt: string;
  changes: Record<string, SeatStatus>;
}

/** The optional join between one event and the map it reuses (section 5.3). */
export interface KerusiSession {
  kerusi: '1.0';
  /** e.g. "MH123-2026-08-17" or "hallA-2026-08-17T19:30". */
  id: string;
  /** References the reusable `KerusiMap.id`. */
  mapId: string;
  /** e.g. "Dune: Part Three — 7:30pm", "MH123, 17 Aug 2026". */
  label?: string;
  /** RFC 3339 date-time — showtime / departure / event start. */
  startsAt?: string;
  endsAt?: string;
  /**
   * This event's booking-mode overrides (sections 4.12.1 and 5.3). Keys MUST
   * name a section or group of the session's map.
   */
  bookingModes?: {
    map?: BookingMode;
    /** By `Section.id`. */
    sections?: Record<string, BookingMode>;
    /** By `Group.id`. */
    groups?: Record<string, BookingMode>;
  };
  metadata?: Record<string, unknown>;
}

/** Any of the four document types of section 3. */
export type KerusiDocument = KerusiMap | KerusiSession | KerusiState | KerusiStateDelta;
