// The seven rule families of the Kerusi standard that JSON Schema cannot
// express, as tabulated in schema/README.md.
//
// This module is deliberately dependency-free: section 8 of the spec names
// `@kerusi/schema` (JSON Schema plus TypeScript types) as a package with no
// runtime dependencies, so the semantic rules stand on their own. The ajv
// wrapper that runs the schemas first lives in ./validator.mjs.
//
// Every check reports a JSON Pointer (RFC 6901) to the offending node rather
// than throwing, and no check short-circuits another: a document with a
// dangling seat type and mixed currencies reports both.

/** @typedef {{ rule: string, spec: string, path: string, message: string }} KerusiError */

const escape = (token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1');

/** JSON Pointer (RFC 6901) built from path tokens. */
const ptr = (...tokens) => (tokens.length === 0 ? '' : '/' + tokens.map(escape).join('/'));

const has = (obj, key) =>
  obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const arr = (v) => (Array.isArray(v) ? v : []);

const quote = (v) => JSON.stringify(String(v));

const listing = (values) => values.map(quote).join(', ');

/**
 * Row order per section 4.2.1: rows declaring `index` first, sorted ascending;
 * rows with no `index` after them in declaration order; ties keep declaration
 * order. Two conformant consumers MUST derive the same order from the same
 * document, so this is a stable sort over a decorated copy.
 *
 * @param {object} section
 * @returns {string[]} row ids in order, empty when the section declares no rows
 */
export function rowOrder(section) {
  const rows = arr(section?.rows);
  const indexed = [];
  const unindexed = [];
  rows.forEach((row, i) => {
    (has(row, 'index') && typeof row.index === 'number' ? indexed : unindexed).push({ row, i });
  });
  indexed.sort((a, b) => a.row.index - b.row.index || a.i - b.i);
  return [...indexed, ...unindexed].map(({ row }) => row?.id);
}

/**
 * Layout inference per section 4.5, for a section that declares no `layout`.
 * Inference never yields "mixed" — that mode MUST be declared explicitly.
 *
 * @param {object} section
 * @returns {'grid'|'freeform'|'inconsistent'|'indeterminate'}
 */
export function inferLayout(section) {
  const seats = arr(section?.seats);
  if (seats.length === 0) return 'indeterminate';
  const everyCol = seats.every((s) => has(s, 'col'));
  const noXY = seats.every((s) => !has(s, 'x') && !has(s, 'y'));
  const everyXY = seats.every((s) => has(s, 'x') && has(s, 'y'));
  const noCol = seats.every((s) => !has(s, 'col'));
  if (everyCol && noXY) return 'grid';
  if (everyXY && noCol) return 'freeform';
  return 'inconsistent';
}

/**
 * The mode a section's seats and elements are checked against: the declared
 * `layout` when there is one, the inferred mode otherwise.
 *
 * @param {object} section
 * @returns {'grid'|'freeform'|'mixed'|'inconsistent'|'indeterminate'}
 */
export function effectiveLayout(section) {
  const declared = section?.layout;
  if (declared === 'grid' || declared === 'freeform' || declared === 'mixed') return declared;
  return inferLayout(section);
}

// --- rule families ---------------------------------------------------------

// (1) Seat.type resolves against KerusiMap.legend[].id (section 4.6).
function checkSeatTypes(map, out) {
  const known = new Set(arr(map.legend).map((t) => t?.id));
  arr(map.sections).forEach((section, s) => {
    arr(section?.seats).forEach((seat, i) => {
      if (!has(seat, 'type') || known.has(seat.type)) return;
      out.push({
        rule: 'seat-type-unresolved',
        spec: '4.6',
        path: ptr('sections', s, 'seats', i, 'type'),
        message: `seat ${quote(seat.id)} has type ${quote(seat.type)}, which the map's legend does not declare`
      });
    });
  });
}

// (2) Seat.priceTier and SeatType.defaultPriceTier resolve against
//     KerusiMap.priceTiers[].id (sections 4.6 and 4.9). A map declaring no
//     priceTiers resolves nothing, so any reference into it is dangling.
function checkPriceTierRefs(map, out) {
  const known = new Set(arr(map.priceTiers).map((t) => t?.id));
  arr(map.legend).forEach((type, j) => {
    if (!has(type, 'defaultPriceTier') || known.has(type.defaultPriceTier)) return;
    out.push({
      rule: 'seat-type-default-price-tier-unresolved',
      spec: '4.9',
      path: ptr('legend', j, 'defaultPriceTier'),
      message: `seat type ${quote(type.id)} defaults to price tier ${quote(type.defaultPriceTier)}, which the map does not declare`
    });
  });
  arr(map.sections).forEach((section, s) => {
    arr(section?.seats).forEach((seat, i) => {
      if (!has(seat, 'priceTier') || known.has(seat.priceTier)) return;
      out.push({
        rule: 'seat-price-tier-unresolved',
        spec: '4.6',
        path: ptr('sections', s, 'seats', i, 'priceTier'),
        message: `seat ${quote(seat.id)} references price tier ${quote(seat.priceTier)}, which the map does not declare`
      });
    });
  });
}

// (3) Seat.row / Element.row resolve against Section.rows[].id, but only when
//     the section declares `rows`. With no registry, `row` is opaque free text
//     with nothing to resolve against, and is always valid (section 4.6).
function checkRowRefs(map, out) {
  arr(map.sections).forEach((section, s) => {
    if (!has(section, 'rows')) return;
    const known = new Set(arr(section.rows).map((r) => r?.id));
    const check = (node, kind, collection, i) => {
      if (!has(node, 'row') || known.has(node.row)) return;
      out.push({
        rule: `${kind}-row-unresolved`,
        spec: '4.6',
        path: ptr('sections', s, collection, i, 'row'),
        message: `${kind} ${quote(node.id)} is in row ${quote(node.row)}, which section ${quote(section.id)} does not declare`
      });
    };
    arr(section.seats).forEach((seat, i) => check(seat, 'seat', 'seats', i));
    arr(section.elements).forEach((el, i) => check(el, 'element', 'elements', i));
  });
}

// (4) Seat.companions[] resolve to other seats in the SAME section, and are
//     fully symmetric: every member of a group lists every other (section 4.6).
function checkCompanions(map, out) {
  arr(map.sections).forEach((section, s) => {
    const seats = arr(section?.seats);
    const byId = new Map();
    seats.forEach((seat, i) => {
      if (has(seat, 'id') && !byId.has(seat.id)) byId.set(seat.id, { seat, i });
    });

    // Declared edges, minus the ones that do not resolve: an unresolved
    // companion is reported once, as a dangling reference, and not a second
    // time as a broken symmetry.
    const edges = new Map(); // seat id -> Set of companion ids
    seats.forEach((seat, i) => {
      if (!has(seat, 'id')) return;
      const own = edges.get(seat.id) ?? new Set();
      edges.set(seat.id, own);
      arr(seat.companions).forEach((cid, n) => {
        const path = ptr('sections', s, 'seats', i, 'companions', n);
        if (cid === seat.id) {
          out.push({
            rule: 'companion-self-reference',
            spec: '4.6',
            path,
            message: `seat ${quote(seat.id)} lists itself as a companion`
          });
          return;
        }
        if (!byId.has(cid)) {
          out.push({
            rule: 'companion-unresolved',
            spec: '4.6',
            path,
            message: `seat ${quote(seat.id)} lists companion ${quote(cid)}, which is not a seat in section ${quote(section.id)}`
          });
          return;
        }
        own.add(cid);
      });
    });

    // Symmetry: if A lists B, B MUST list A in return.
    for (const [id, companions] of edges) {
      const entry = byId.get(id);
      if (!entry) continue;
      for (const cid of companions) {
        if (edges.get(cid)?.has(id)) continue;
        out.push({
          rule: 'companion-asymmetric',
          spec: '4.6',
          path: ptr('sections', s, 'seats', entry.i, 'companions', arr(entry.seat.companions).indexOf(cid)),
          message: `seat ${quote(id)} lists ${quote(cid)} as a companion, but ${quote(cid)} does not list ${quote(id)} in return`
        });
      }
    }

    // Group completeness: "for a group larger than a pair, every member MUST
    // list every other member". A group is a connected component of the
    // companion graph, and it MUST be complete.
    const seen = new Set();
    for (const id of edges.keys()) {
      if (seen.has(id)) continue;
      const group = [];
      const queue = [id];
      seen.add(id);
      while (queue.length > 0) {
        const cur = queue.shift();
        group.push(cur);
        for (const next of edges.get(cur) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      if (group.length < 3) continue; // a pair is covered by the symmetry check
      group.sort();
      for (const member of group) {
        const missing = group.filter((other) => other !== member && !edges.get(member).has(other));
        if (missing.length === 0) continue;
        out.push({
          rule: 'companion-group-incomplete',
          spec: '4.6',
          path: ptr('sections', s, 'seats', byId.get(member).i, 'companions'),
          message: `seat ${quote(member)} belongs to the companion group ${listing(group)} but does not list ${listing(missing)}`
        });
      }
    }
  });
}

// (5) Layout inference (section 4.5), then the per-mode positioning rules of
//     sections 4.5 and 4.4.1 for seats *and* elements. The schemas apply those
//     per-mode rules only to a section that declares `layout`; they are applied
//     here to every section, so this module is correct on its own.
function checkLayout(map, out) {
  arr(map.sections).forEach((section, s) => {
    if (!isObject(section)) return;
    const mode = effectiveLayout(section);

    if (mode === 'inconsistent') {
      const seats = arr(section.seats);
      const gridAddressed = seats.filter((seat) => has(seat, 'col') && !has(seat, 'x') && !has(seat, 'y'));
      const freeformAddressed = seats.filter((seat) => has(seat, 'x') && has(seat, 'y') && !has(seat, 'col'));
      const rest = seats.filter((seat) => !gridAddressed.includes(seat) && !freeformAddressed.includes(seat));
      const offenders = (rest.length > 0 ? rest : seats).map((seat) => seat?.id);
      out.push({
        rule: 'layout-inference-inconsistent',
        spec: '4.5',
        path: ptr('sections', s),
        message:
          `section ${quote(section.id)} declares no layout, and its seats are neither all grid-addressed (every seat ` +
          'carrying col, none carrying x or y) nor all freeform-addressed (every seat carrying x and y, none carrying ' +
          `col); see ${listing(offenders)}. Inference never yields "mixed", which MUST be declared explicitly`
      });
      return; // no mode to check the seats and elements against
    }
    // A section with no seats and no declared layout has nothing to infer
    // from; the spec defines no fallback, so its elements go unchecked here.
    if (mode === 'indeterminate') return;

    const seatFault = {
      grid: (seat) =>
        !has(seat, 'col') ? 'MUST carry col' : has(seat, 'x') || has(seat, 'y') ? 'MUST NOT carry x or y' : null,
      freeform: (seat) =>
        !has(seat, 'x') || !has(seat, 'y')
          ? 'MUST carry both x and y'
          : has(seat, 'col')
            ? 'MUST NOT carry col'
            : null,
      mixed: (seat) => (has(seat, 'col') && has(seat, 'x') && has(seat, 'y') ? null : 'MUST carry col and both x and y')
    }[mode];

    const elementFault = {
      grid: (el) =>
        !has(el, 'row') && !has(el, 'col')
          ? 'MUST be positioned by row and/or col'
          : has(el, 'x') || has(el, 'y')
            ? 'MUST NOT carry x or y'
            : null,
      freeform: (el) =>
        !has(el, 'x') || !has(el, 'y')
          ? 'MUST be positioned by x and y'
          : has(el, 'col')
            ? 'MUST NOT carry col'
            : null,
      mixed: (el) =>
        has(el, 'row') || has(el, 'col') || (has(el, 'x') && has(el, 'y'))
          ? null
          : 'MUST be positioned by row and/or col, or by x and y'
    }[mode];

    arr(section.seats).forEach((seat, i) => {
      const fault = seatFault(seat);
      if (!fault) return;
      out.push({
        rule: 'seat-layout-mismatch',
        spec: '4.5',
        path: ptr('sections', s, 'seats', i),
        message: `seat ${quote(seat?.id)} in ${quote(mode)} section ${quote(section.id)} ${fault}`
      });
    });

    arr(section.elements).forEach((el, i) => {
      const fault = elementFault(el);
      if (fault) {
        out.push({
          rule: 'element-layout-mismatch',
          spec: '4.4.1',
          path: ptr('sections', s, 'elements', i),
          message: `element ${quote(el?.id)} in ${quote(mode)} section ${quote(section.id)} ${fault}`
        });
      }
      // Spans are cell counts for a grid-addressed element, and percentages
      // once x/y governs its placement (section 4.4.1).
      const gridAddressed = mode === 'grid' || (mode === 'mixed' && !has(el, 'x') && !has(el, 'y'));
      if (!gridAddressed) return;
      for (const dim of ['width', 'height']) {
        if (!has(el, dim)) continue;
        if (Number.isInteger(el[dim]) && el[dim] >= 1) continue;
        out.push({
          rule: 'element-span-invalid',
          spec: '4.4.1',
          path: ptr('sections', s, 'elements', i, dim),
          message:
            `element ${quote(el?.id)} is grid-addressed, so its ${dim} is a cell span and MUST be a positive integer, ` +
            `not ${JSON.stringify(el[dim])}`
        });
      }
    });
  });
}

// (6) An element's row span MUST NOT extend past the last row in the section's
//     row order (sections 4.2.1, 4.4.1 and 4.6). Scoped, as section 4.6 scopes
//     it, to a "grid" section — declared or inferred — and only where the
//     section declares the row registry that bounds the span.
function checkElementRowSpans(map, out) {
  arr(map.sections).forEach((section, s) => {
    if (!isObject(section) || effectiveLayout(section) !== 'grid' || !has(section, 'rows')) return;
    const order = rowOrder(section);
    arr(section.elements).forEach((el, i) => {
      if (!has(el, 'row')) return; // no row anchor, so nothing to bound
      const start = order.indexOf(el.row);
      if (start < 0) return; // dangling row reference, already reported
      const height = has(el, 'height') ? el.height : 1;
      if (!Number.isInteger(height) || height < 1) return; // reported as an invalid span
      if (start + height <= order.length) return;
      out.push({
        rule: 'element-row-span-overrun',
        spec: '4.6',
        path: ptr('sections', s, 'elements', i, 'height'),
        message:
          `element ${quote(el.id)} starts at row ${quote(el.row)} (position ${start + 1} of ${order.length}) and spans ` +
          `${height} rows, running ${start + height - order.length} row(s) past the last row in section ${quote(section.id)}`
      });
    });
  });
}

// (7a) Exactly one currency applies to the whole map (section 4.9).
function checkSingleCurrency(map, out) {
  const monies = [];
  arr(map.priceTiers).forEach((tier, j) => {
    if (isObject(tier?.price)) monies.push({ money: tier.price, path: ptr('priceTiers', j, 'price', 'currency') });
  });
  arr(map.sections).forEach((section, s) => {
    arr(section?.seats).forEach((seat, i) => {
      if (isObject(seat?.price)) {
        monies.push({ money: seat.price, path: ptr('sections', s, 'seats', i, 'price', 'currency') });
      }
    });
  });
  const first = monies.find(({ money }) => has(money, 'currency'));
  if (!first) return;
  for (const { money, path } of monies) {
    if (!has(money, 'currency') || money.currency === first.money.currency) continue;
    out.push({
      rule: 'map-currency-mixed',
      spec: '4.9',
      path,
      message:
        `currency ${quote(money.currency)} differs from ${quote(first.money.currency)}, first used at ${first.path}; ` +
        'exactly one currency applies to the whole map'
    });
  }
}

// (7b) Seat.id is unique across the whole map, not merely within a section
//      (section 4.3).
function checkSeatIdUniqueness(map, out) {
  const first = new Map();
  arr(map.sections).forEach((section, s) => {
    arr(section?.seats).forEach((seat, i) => {
      if (!has(seat, 'id')) return;
      const path = ptr('sections', s, 'seats', i, 'id');
      if (!first.has(seat.id)) {
        first.set(seat.id, path);
        return;
      }
      out.push({
        rule: 'seat-id-duplicate',
        spec: '4.3',
        path,
        message: `seat id ${quote(seat.id)} is already used at ${first.get(seat.id)}; Seat.id is unique across the whole map`
      });
    });
  });
}

/**
 * Every whole-document rule of section 4 that JSON Schema cannot express.
 * Assumes nothing about the document beyond it being parsed JSON: a malformed
 * map yields the errors it can and skips the rest, leaving the shape of the
 * document to the schema.
 *
 * @param {unknown} map a KerusiMap document
 * @returns {KerusiError[]} in document order, empty when the map is conformant
 */
export function checkMap(map) {
  /** @type {KerusiError[]} */
  const errors = [];
  if (!isObject(map)) return errors;
  checkSeatTypes(map, errors);
  checkPriceTierRefs(map, errors);
  checkRowRefs(map, errors);
  checkCompanions(map, errors);
  checkLayout(map, errors);
  checkElementRowSpans(map, errors);
  checkSingleCurrency(map, errors);
  checkSeatIdUniqueness(map, errors);
  return errors;
}

/**
 * (7c) KerusiStateDelta.updatedAt is "strictly increasing per session/map, so a
 * consumer can detect and discard an out-of-order delta" (section 5.2). That is
 * a property of a stream rather than of any one document, so it is checked over
 * the sequence a consumer received, in receipt order, scoped by sessionId/mapId.
 *
 * Paths are JSON Pointers into the passed array.
 *
 * @param {unknown[]} deltas KerusiStateDelta documents, in the order received
 * @returns {KerusiError[]}
 */
export function checkDeltaStream(deltas) {
  /** @type {KerusiError[]} */
  const errors = [];
  const last = new Map(); // scope key -> { at, ms, index }
  arr(deltas).forEach((delta, i) => {
    if (!isObject(delta) || !has(delta, 'updatedAt')) return;
    const scopeKind = has(delta, 'sessionId') ? 'sessionId' : 'mapId';
    const scope = `${scopeKind}:${delta[scopeKind]}`;
    const ms = Date.parse(delta.updatedAt);
    if (Number.isNaN(ms)) return; // an unparseable timestamp is a schema failure
    const prev = last.get(scope);
    if (prev && ms <= prev.ms) {
      errors.push({
        rule: 'delta-updated-at-not-increasing',
        spec: '5.2',
        path: ptr(i, 'updatedAt'),
        message:
          `delta ${i} carries updatedAt ${quote(delta.updatedAt)}, which is not later than ${quote(prev.at)} on delta ` +
          `${prev.index} for the same ${scopeKind}; updatedAt MUST be strictly increasing per session/map`
      });
      return; // keep the high-water mark, so one stale delta cannot mask the next
    }
    last.set(scope, { at: delta.updatedAt, ms, index: i });
  });
  return errors;
}
