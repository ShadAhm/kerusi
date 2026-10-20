// Booking units and selection prices: the reference implementation of
// sections 4.9.1 and 4.12 of the Kerusi standard.
//
//   import { bookingUnits, checkSelection, priceSelection } from './schema/booking.mjs';
//   const { units, wholeUnits } = bookingUnits(map, session, state);
//
// Two conformant consumers MUST derive the same booking units and whole units
// from the same map and session (section 7), so a renderer and a booking
// engine written in different languages test against the shared corpus in
// examples/booking-units/ rather than against each other.
//
// Like ./semantic-rules.mjs this module has no dependencies. It assumes a map
// that has passed the validator: a group seat that does not resolve is
// skipped, and a seat listed by two groups belongs to the first.

const MODES = ['seats', 'whole', 'either'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const arr = (v) => (Array.isArray(v) ? v : []);

const modeOr = (value, fallback) => (MODES.includes(value) ? value : fallback);

/**
 * @typedef {'map'|'section'|'group'} LevelKind
 * @typedef {{ level: LevelKind, id: string, node: object, mode: string, seats: string[], parent: Level|null }} Level
 * @typedef {{ level: LevelKind|'seat', id: string, seats: string[], bookable?: boolean }} Unit
 * @typedef {{ amount: number, currency: string }} Money
 */

/**
 * The effective booking mode of every level of a map (section 4.12.1): the
 * session's override, else the document's own `booking`, else "seats".
 *
 * @param {object} map a KerusiMap
 * @param {object} [session] a KerusiSession for this map, or nothing
 * @returns {{ map: Level, sections: Level[], groups: Level[], seatLevels: Map<string, Level[]> }}
 *   every level, outermost first, and for each seat the levels that contain
 *   it, outermost first
 */
export function levelsOf(map, session) {
  const overrides = isObject(session?.bookingModes) ? session.bookingModes : {};
  const sectionOverrides = isObject(overrides.sections) ? overrides.sections : {};
  const groupOverrides = isObject(overrides.groups) ? overrides.groups : {};

  const mapLevel = {
    level: 'map',
    id: map.id,
    node: map,
    mode: modeOr(overrides.map, modeOr(map.booking, 'seats')),
    seats: [],
    parent: null
  };
  const sections = [];
  const groups = [];
  const seatLevels = new Map();

  for (const section of arr(map.sections)) {
    const sectionLevel = {
      level: 'section',
      id: section.id,
      node: section,
      mode: modeOr(sectionOverrides[section.id], modeOr(section.booking, 'seats')),
      seats: arr(section.seats).map((seat) => seat.id),
      parent: mapLevel
    };
    sections.push(sectionLevel);
    mapLevel.seats.push(...sectionLevel.seats);
    for (const id of sectionLevel.seats) seatLevels.set(id, [mapLevel, sectionLevel]);

    for (const group of arr(section.groups)) {
      const groupLevel = {
        level: 'group',
        id: group.id,
        node: group,
        mode: modeOr(groupOverrides[group.id], modeOr(group.booking, 'seats')),
        seats: [],
        parent: sectionLevel
      };
      for (const id of arr(group.seats)) {
        const chain = seatLevels.get(id);
        // Unresolved, or already in a group: the validator reports both.
        if (!chain || chain.length > 2 || chain[1] !== sectionLevel) continue;
        chain.push(groupLevel);
        groupLevel.seats.push(id);
      }
      groups.push(groupLevel);
    }
  }
  return { map: mapLevel, sections, groups, seatLevels };
}

const statusOf = (state, id) => {
  const entry = isObject(state?.seats) ? state.seats[id] : undefined;
  return isObject(entry) && typeof entry.status === 'string' ? entry.status : 'available';
};

const withBookable = (unit, state) =>
  state === undefined || state === null ? unit : { ...unit, bookable: unit.seats.every((id) => statusOf(state, id) === 'available') };

/**
 * Every booking unit and whole unit of a map (section 4.12.2).
 *
 * A seat's booking unit is every seat of the outermost level containing it
 * whose effective mode is "whole" — the map, then its section, then its group
 * — or the seat alone when none of them is. The booking units partition the
 * map's seats. A whole unit is a level whose effective mode is "either", that
 * has seats and that no "whole" level contains: one booking of all its seats.
 *
 * Given a KerusiState, each unit also says whether it can be booked: only
 * while every seat in it is "available" (section 4.12.3).
 *
 * @param {object} map a KerusiMap that has passed the validator
 * @param {object} [session] a KerusiSession for this map
 * @param {object} [state] a KerusiState for this map or session
 * @returns {{ units: Unit[], wholeUnits: Unit[] }} both in document order
 */
export function bookingUnits(map, session, state) {
  const { map: mapLevel, sections, groups, seatLevels } = levelsOf(map, session);

  const units = [];
  const byKey = new Map();
  for (const [seatId, chain] of seatLevels) {
    const outer = chain.find((level) => level.mode === 'whole');
    const key = outer ? `${outer.level}\u0000${outer.id}` : `seat\u0000${seatId}`;
    if (byKey.has(key)) continue;
    const unit = outer ? { level: outer.level, id: outer.id, seats: [...outer.seats] } : { level: 'seat', id: seatId, seats: [seatId] };
    byKey.set(key, unit);
    units.push(unit);
  }

  const insideWhole = (level) => {
    for (let p = level.parent; p; p = p.parent) if (p.mode === 'whole') return true;
    return false;
  };
  const wholeUnits = [mapLevel, ...sections, ...groups]
    .filter((level) => level.mode === 'either' && level.seats.length > 0 && !insideWhole(level))
    .map((level) => ({ level: level.level, id: level.id, seats: [...level.seats] }));

  return {
    units: units.map((unit) => withBookable(unit, state)),
    wholeUnits: wholeUnits.map((unit) => withBookable(unit, state))
  };
}

/**
 * Whether a selection is a union of booking units (section 4.12.3): it is not
 * empty, every seat in it is a seat of the map, and it holds every seat of
 * every booking unit it touches. A consumer MUST NOT submit any other.
 *
 * @param {object} map
 * @param {object|undefined} session
 * @param {string[]} seatIds
 * @returns {{ valid: boolean, problems: string[] }}
 */
export function checkSelection(map, session, seatIds) {
  const selected = new Set(arr(seatIds));
  const problems = [];
  if (selected.size === 0) problems.push('the selection is empty');
  const { units } = bookingUnits(map, session);
  const unitOf = new Map();
  for (const unit of units) for (const id of unit.seats) unitOf.set(id, unit);
  const reported = new Set();
  for (const id of selected) {
    const unit = unitOf.get(id);
    if (!unit) {
      problems.push(`${JSON.stringify(id)} is not a seat of map ${JSON.stringify(map.id)}`);
      continue;
    }
    if (reported.has(unit)) continue;
    const missing = unit.seats.filter((other) => !selected.has(other));
    if (missing.length === 0) continue;
    reported.add(unit);
    problems.push(
      `seat ${JSON.stringify(id)} is booked only with the rest of ${unit.level} ${JSON.stringify(unit.id)}, ` +
        `and the selection leaves out ${missing.map((m) => JSON.stringify(m)).join(', ')}`
    );
  }
  return { valid: problems.length === 0, problems };
}

/**
 * One seat's price by section 4.9: `Seat.price`, else its `priceTier`, else its
 * type's `defaultPriceTier`, else unpriced.
 */
function seatPrice(seat, tiers, types) {
  if (isObject(seat.price)) return seat.price;
  if (tiers.has(seat.priceTier)) return tiers.get(seat.priceTier);
  const type = types.get(seat.type);
  if (type && tiers.has(type.defaultPriceTier)) return tiers.get(type.defaultPriceTier);
  return null;
}

/** A level's whole price (section 4.9.1): `wholePrice`, else `wholePriceTier`, else none. */
function wholePriceOf(node, tiers) {
  if (isObject(node.wholePrice)) return node.wholePrice;
  if (tiers.has(node.wholePriceTier)) return tiers.get(node.wholePriceTier);
  return null;
}

/**
 * The price of a selection (section 4.9.1). From the outermost level inwards —
 * the map, then each section, then each group — a level is charged its whole
 * price when it has one, its effective mode is "whole" or "either", and every
 * one of its seats is in the selection and not already charged. Its seats are
 * then taken out. Each seat left is priced by section 4.9. The total is the
 * sum, or null when nothing in the selection is priced. An unpriced seat adds
 * nothing.
 *
 * Whether the selection is a valid one is `checkSelection`'s question; this
 * prices any set of seats, and ignores ids that are not seats of the map.
 *
 * @param {object} map
 * @param {object|undefined} session
 * @param {string[]} seatIds
 * @returns {{ total: Money|null, wholes: { level: LevelKind, id: string, price: Money }[], seats: { id: string, price: Money|null }[] }}
 */
export function priceSelection(map, session, seatIds) {
  const tiers = new Map(arr(map.priceTiers).map((tier) => [tier.id, tier.price]));
  const types = new Map(arr(map.legend).map((type) => [type.id, type]));
  const { map: mapLevel, sections, groups, seatLevels } = levelsOf(map, session);

  const remaining = new Set(arr(seatIds).filter((id) => seatLevels.has(id)));
  const wholes = [];
  for (const level of [mapLevel, ...sections, ...groups]) {
    if (level.mode === 'seats' || level.seats.length === 0) continue;
    const price = wholePriceOf(level.node, tiers);
    if (!price || !level.seats.every((id) => remaining.has(id))) continue;
    for (const id of level.seats) remaining.delete(id);
    wholes.push({ level: level.level, id: level.id, price });
  }

  const seatsById = new Map();
  for (const section of arr(map.sections)) for (const seat of arr(section.seats)) seatsById.set(seat.id, seat);
  const seats = [...remaining].map((id) => ({ id, price: seatPrice(seatsById.get(id), tiers, types) }));

  const monies = [...wholes.map((w) => w.price), ...seats.map((s) => s.price).filter(Boolean)];
  const total = monies.length === 0 ? null : { amount: monies.reduce((sum, m) => sum + m.amount, 0), currency: monies[0].currency };
  return { total, wholes, seats };
}
