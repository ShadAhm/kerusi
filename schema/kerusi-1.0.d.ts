/**
 * TypeScript interfaces for the Kerusi seat map and availability format,
 * v1.0.0-draft — a transcription of the declarations in sections 4 and 5 of
 * RFC/kerusi-standard_v1.0.0-draft.md.
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

/** The reusable physical configuration: legend, price tiers, sections (section 4). */
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
  /** Vocabulary of seat types used in this map; `Seat.type` resolves against it. */
  legend: SeatType[];
  /** Named price tiers, referenced by id. */
  priceTiers?: PriceTier[];
  sections: Section[];
  metadata?: Record<string, unknown>;
}

/**
 * A flat list of seats, not a grid of rows containing seats (section 4.1): a
 * seat's position is a property of the seat, not a slot in a shared array.
 */
export interface Section {
  id: string;
  /** String, or locale map: { "en": "Orchestra", "ms": "Orkestra" }. */
  label?: LocalizableString;
  /** Display order among sections. */
  index?: number;
  /**
   * A strict, validated positioning constraint, not a rendering hint
   * (section 4.5). When omitted, a validator MUST infer it from the section's
   * seats — as "grid" or "freeform" only, never "mixed" — and MUST reject a
   * section whose seats fit neither.
   */
  layout?: 'grid' | 'freeform' | 'mixed';
  /**
   * "width:height", e.g. "16:9", both dimensions non-zero. Fixes the canvas
   * proportions that percentage coordinates, rotation and element sizing are
   * measured against. Meaningful only for freeform/mixed. Default: "1:1".
   */
  aspectRatio?: string;
  /**
   * Optional row registry — labels, order, empty rows. NOT a container: seats
   * stay in `seats` (section 4.2). When present it is the section's complete,
   * ordered row registry, and every `Seat.row`/`Element.row` MUST resolve
   * against it.
   */
  rows?: RowMeta[];
  /** Optional, purely informational human-facing axis labels (section 4.10). */
  directions?: Direction[];
  /** Flat list; order is not significant. */
  seats: Seat[];
  /** Non-bookable features: screens, stages, aisles, stairs. */
  elements?: Element[];
  metadata?: Record<string, unknown>;
}

/**
 * Purely descriptive row metadata (section 4.2). A `RowMeta` that no seat
 * references is an empty row: valid, and it still reserves one row of vertical
 * space in the section's row order (section 4.2.2).
 */
export interface RowMeta {
  id: string;
  label?: string;
  /**
   * Ordering key among rows in the section (section 4.2.1) — an ordering key,
   * not a position. Rows at index 0 and 11 with nothing between them are
   * adjacent.
   */
  index?: number;
  metadata?: Record<string, unknown>;
}

export interface Seat {
  /** Unique within the whole KerusiMap, not merely within its section. */
  id: string;
  /** Display label, e.g. "12" or "12A". Defaults to id. */
  label?: string;
  /** References `RowMeta.id` when the section declares `rows`; free text otherwise. */
  row?: string;
  /** Grid column within the row. */
  col?: number;
  /** 0–100, percent of section width (see `Section.aspectRatio`). */
  x?: number;
  /** 0–100, percent of section height. */
  y?: number;
  /** Degrees. Lets one seat tilt independently of its neighbours. */
  rotation?: number;
  /** References a `SeatType.id` in the map's legend. */
  type: string;
  /** References a `PriceTier.id`. */
  priceTier?: string;
  /** Literal override; takes precedence over `priceTier` (section 4.9). */
  price?: Money;
  /**
   * ids of other seats in the SAME section that must be booked together.
   * References MUST be symmetric, and every member of a group larger than a
   * pair MUST list every other member (section 4.6).
   */
  companions?: string[];
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
  /** Occupant is expected to need an adjacent companion seat; pair with `Seat.companions`. */
  companionRequired?: boolean;
}

/**
 * A non-bookable feature that still requires rendering (section 4.4), subject
 * to the same positioning constraint as its section's seats (section 4.4.1).
 */
export interface Element {
  id: string;
  /** "screen" | "stage" | "exit" | "lavatory" | "gap" | "aisle" | implementation-defined. */
  kind: string;
  label?: string;
  row?: string;
  col?: number;
  x?: number;
  y?: number;
  /**
   * A column span in cells in a grid-addressed element (positive integer,
   * default 1; ignored when `col` is omitted, which spans the section's full
   * column extent), a percentage of section width in a freeform one.
   */
  width?: number;
  /**
   * A row span in cells in a grid-addressed element (positive integer, default
   * 1) that MUST NOT extend past the last row in the section's row order, a
   * percentage of section height in a freeform one.
   */
  height?: number;
  rotation?: number;
  metadata?: Record<string, unknown>;
}

/** A legend entry (section 4.7). */
export interface SeatType {
  /** e.g. "standard" | "recliner" | "wheelchair" | "business". */
  id: string;
  label?: LocalizableString;
  /** Suggested render color, hex. Non-normative hint. */
  color?: string;
  /** References a `PriceTier.id` (section 4.9 step 3). */
  defaultPriceTier?: string;
}

export interface PriceTier {
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
 * An optional, purely descriptive label pair for one addressing axis
 * (section 4.10). Non-normative: it MUST NOT be used by a validator to reject a
 * document, nor relied upon by a renderer to decide layout.
 */
export interface Direction {
  axis: 'row' | 'col' | 'x' | 'y';
  /** Label for the low end — ascending row/col order from the first row/col, or x/y = 0. */
  low: LocalizableString;
  /** Label for the high end — descending row/col order, or x/y = 100. */
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
  metadata?: Record<string, unknown>;
}

/** Any of the four document types of section 3. */
export type KerusiDocument = KerusiMap | KerusiSession | KerusiState | KerusiStateDelta;
