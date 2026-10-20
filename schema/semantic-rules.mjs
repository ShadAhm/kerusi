// The rule families of the Kerusi standard that JSON Schema cannot express,
// as tabulated in schema/README.md.
//
// This module is deliberately dependency-free: section 8 of the spec names
// `@kerusi/schema` (JSON Schema plus TypeScript types) as a package with no
// runtime dependencies, so the semantic rules stand on their own. The ajv
// wrapper that runs the schemas first lives in ./validator.mjs.
//
// Every check reports a JSON Pointer (RFC 6901) to the offending node rather
// than throwing, and no check short-circuits another: a document with a
// dangling seat type and mixed currencies reports both.
//
// `checkMap` returns what a conformant validator MUST reject. `lintMap` returns
// what it SHOULD report without rejecting: overlapping seats (section 4.3.1),
// seats outside their section's bounds (section 4.1), and a group's shape over
// a seat outside the group (section 4.11). `checkSession` checks a session
// against the map it names (section 5.3), so it takes both documents.
//
// Booking units and selection prices (sections 4.9.1 and 4.12) are in
// ./booking.mjs.

/** @typedef {{ rule: string, spec: string, path: string, message: string }} KerusiError */

const escape = (token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1');

/** JSON Pointer (RFC 6901) built from path tokens. */
const ptr = (...tokens) => (tokens.length === 0 ? '' : '/' + tokens.map(escape).join('/'));

const has = (obj, key) =>
  obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const arr = (v) => (Array.isArray(v) ? v : []);

const quote = (v) => JSON.stringify(String(v));

const listing = (values) => values.map(quote).join(', ');

const rad = (degrees) => (degrees * Math.PI) / 180;

/**
 * The ordering rule sections 4.1.1 and 4.2.1 share: items declaring `index`
 * first, sorted ascending; items with no `index` after them in declaration
 * order; ties keep declaration order. `index` is an ordering key, not a
 * position. Two conformant consumers MUST derive the same order from the same
 * document, so this is a stable sort over a decorated copy.
 *
 * @param {unknown[]} items
 * @returns {string[]} the items' ids in order
 */
function byIndexKey(items) {
  const indexed = [];
  const unindexed = [];
  items.forEach((item, i) => {
    (has(item, 'index') && typeof item.index === 'number' ? indexed : unindexed).push({ item, i });
  });
  indexed.sort((a, b) => a.item.index - b.item.index || a.i - b.i);
  return [...indexed, ...unindexed].map(({ item }) => item?.id);
}

/**
 * Row order per section 4.2.1.
 *
 * @param {object} section
 * @returns {string[]} row ids in order, empty when the section declares no rows
 */
export function rowOrder(section) {
  return byIndexKey(arr(section?.rows));
}

/**
 * Section order per section 4.1.1: the row rule of section 4.2.1, applied to
 * a map's sections.
 *
 * @param {object} map
 * @returns {string[]} section ids in order
 */
export function sectionOrder(map) {
  return byIndexKey(arr(map?.sections));
}

/**
 * The seat size that applies within a section (section 4.5): the section's own
 * `seatSize` when it declares one, the map's otherwise.
 *
 * @param {object} map
 * @param {object} [section]
 * @returns {number|undefined}
 */
export function seatSizeOf(map, section) {
  if (isNum(section?.seatSize)) return section.seatSize;
  return isNum(map?.seatSize) ? map.seatSize : undefined;
}

/**
 * Whether two seats of the SAME section are neighbours (section 4.3.5): same
 * row, and cols that differ by exactly 1. Nothing else implies adjacency — not
 * distance, not labels, not array order. The caller is responsible for the two
 * seats being in one section, since seats in different sections never are.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function areNeighbours(a, b) {
  if (!has(a, 'row') || !has(b, 'row') || a.row !== b.row) return false;
  if (!Number.isInteger(a.col) || !Number.isInteger(b.col)) return false;
  return Math.abs(a.col - b.col) === 1;
}

/**
 * The guide point of column `col` on a row shape (section 4.2.3). Returns null
 * when the column lies outside the shape's `cols` range, or the shape is not
 * one this specification defines.
 *
 * @param {object} shape a RowMeta.shape
 * @param {number} col
 * @returns {[number, number]|null}
 */
export function guidePoint(shape, col) {
  const onCircle = (center, radius, degrees) => [
    center[0] + radius * Math.cos(rad(degrees)),
    center[1] + radius * Math.sin(rad(degrees))
  ];
  const kind = ['line', 'arc', 'circle'].find((k) => has(shape, k));
  if (!kind) return null;
  const g = shape[kind];
  const [a, b] = arr(g?.cols);
  if (!Number.isInteger(col) || !Number.isInteger(a) || !Number.isInteger(b) || col < a || col > b) return null;
  const t = a === b ? 0 : (col - a) / (b - a);
  if (kind === 'line') {
    return [g.from[0] + (g.to[0] - g.from[0]) * t, g.from[1] + (g.to[1] - g.from[1]) * t];
  }
  if (kind === 'arc') return onCircle(g.center, g.radius, g.start + g.sweep * t);
  return onCircle(g.center, g.radius, g.start + (360 * (col - a)) / (b - a + 1));
}

/**
 * Whether a seat lies on its guide (section 4.2.3): within `seatSize / 4` of
 * its guide point. Only editors use this, to decide which seats to move when a
 * guide is changed; renderers never do.
 *
 * @param {object} seat
 * @param {object} shape its row's RowMeta.shape
 * @param {number} seatSize the seat size that applies to the seat's section
 * @returns {boolean}
 */
export function isOnGuide(seat, shape, seatSize) {
  const point = guidePoint(shape, seat?.col);
  if (!point || !isNum(seat?.x) || !isNum(seat?.y)) return false;
  return Math.hypot(seat.x - point[0], seat.y - point[1]) <= seatSize / 4;
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

/**
 * The levels that can carry a whole price (section 4.9.1) — the map, each
 * section, each group — with the path tokens of each and a phrase naming it.
 */
function priceLevels(map) {
  const levels = [{ node: map, at: [], what: `map ${quote(map.id)}` }];
  arr(map.sections).forEach((section, s) => {
    levels.push({ node: section, at: ['sections', s], what: `section ${quote(section?.id)}` });
    arr(section?.groups).forEach((group, g) => {
      levels.push({ node: group, at: ['sections', s, 'groups', g], what: `group ${quote(group?.id)}` });
    });
  });
  return levels;
}

// (2) Seat.priceTier, SeatType.defaultPriceTier, and the wholePriceTier of the
//     map, a section or a group resolve against KerusiMap.priceTiers[].id
//     (sections 4.6, 4.9 and 4.9.1). A map declaring no priceTiers resolves
//     nothing, so any reference into it is dangling.
function checkPriceTierRefs(map, out) {
  const known = new Set(arr(map.priceTiers).map((t) => t?.id));
  for (const { node, at, what } of priceLevels(map)) {
    if (!has(node, 'wholePriceTier') || known.has(node.wholePriceTier)) continue;
    out.push({
      rule: 'whole-price-tier-unresolved',
      spec: '4.9.1',
      path: ptr(...at, 'wholePriceTier'),
      message: `${what} has whole price tier ${quote(node.wholePriceTier)}, which the map does not declare`
    });
  }
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

// (3) Seat.row resolves against Section.rows[].id, but only when the section
//     declares `rows`. With no registry, `row` is opaque free text with nothing
//     to resolve against, and is always valid (section 4.6).
function checkRowRefs(map, out) {
  arr(map.sections).forEach((section, s) => {
    if (!has(section, 'rows')) return;
    const known = new Set(arr(section.rows).map((r) => r?.id));
    arr(section.seats).forEach((seat, i) => {
      if (!has(seat, 'row') || known.has(seat.row)) return;
      out.push({
        rule: 'seat-row-unresolved',
        spec: '4.6',
        path: ptr('sections', s, 'seats', i, 'row'),
        message: `seat ${quote(seat.id)} is in row ${quote(seat.row)}, which section ${quote(section.id)} does not declare`
      });
    });
  });
}

// (4) Groups (section 4.11). Group.seats resolve against the seats of the
//     group's own section; a seat belongs to at most one group, so a seat
//     listed a second time — by another group, or again by the same one — is
//     reported at the later listing. A group's shape is placed on the canvas
//     by its centre, as an element is. And `Seat.companions`, retired in rev
//     17, is rejected rather than ignored (section 4.12.4): ignored, a pair
//     that was booked together would silently become two seats booked apart.
function checkGroups(map, out) {
  const { width, height } = isObject(map.canvas) ? map.canvas : {};
  arr(map.sections).forEach((section, s) => {
    const seatIds = new Set(arr(section?.seats).map((seat) => seat?.id));
    const owner = new Map(); // seat id -> path of the first listing
    arr(section?.groups).forEach((group, g) => {
      arr(group?.seats).forEach((id, n) => {
        const path = ptr('sections', s, 'groups', g, 'seats', n);
        if (!seatIds.has(id)) {
          out.push({
            rule: 'group-seat-unresolved',
            spec: '4.11',
            path,
            message: `group ${quote(group.id)} lists seat ${quote(id)}, which is not a seat in section ${quote(section.id)}`
          });
          return;
        }
        if (owner.has(id)) {
          out.push({
            rule: 'group-seat-shared',
            spec: '4.11',
            path,
            message: `group ${quote(group.id)} lists seat ${quote(id)}, which is already listed at ${owner.get(id)}; a seat belongs to at most one group`
          });
          return;
        }
        owner.set(id, path);
      });

      const shape = group?.shape;
      const centre = isObject(shape?.rect)
        ? { x: shape.rect.x, y: shape.rect.y, at: ['rect'] }
        : isObject(shape?.circle) && Array.isArray(shape.circle.center)
          ? { x: shape.circle.center[0], y: shape.circle.center[1], at: ['circle', 'center'] }
          : null;
      if (!centre) return;
      const outside = [];
      if (isNum(width) && isNum(centre.x) && (centre.x < 0 || centre.x > width)) outside.push(`x ${centre.x} (0 to ${width})`);
      if (isNum(height) && isNum(centre.y) && (centre.y < 0 || centre.y > height)) outside.push(`y ${centre.y} (0 to ${height})`);
      if (outside.length === 0) return;
      out.push({
        rule: 'group-shape-outside-canvas',
        spec: '4.11',
        path: ptr('sections', s, 'groups', g, 'shape', ...centre.at),
        message: `group ${quote(group.id)} has its shape's centre outside the canvas: ${outside.join(', ')}`
      });
    });

    arr(section?.seats).forEach((seat, i) => {
      if (!has(seat, 'companions')) return;
      out.push({
        rule: 'companions-retired',
        spec: '4.12.4',
        path: ptr('sections', s, 'seats', i, 'companions'),
        message:
          `seat ${quote(seat.id)} carries companions, which rev 17 retired; ` +
          'put the seats in one group with booking "whole" instead (section 4.11)'
      });
    });
  });
}

// (5) Every seat and element lies on the canvas: 0 <= x <= canvas.width and
//     0 <= y <= canvas.height (sections 4.3.1 and 4.4.1). The schema bounds
//     each coordinate below at 0; the upper bound depends on the document.
function checkCanvasBounds(map, out) {
  const { width, height } = isObject(map.canvas) ? map.canvas : {};
  const limits = { x: isNum(width) ? width : undefined, y: isNum(height) ? height : undefined };
  const check = (node, kind, s, collection, i) => {
    for (const axis of ['x', 'y']) {
      const limit = limits[axis];
      const v = node?.[axis];
      if (limit === undefined || !isNum(v) || (v >= 0 && v <= limit)) continue;
      out.push({
        rule: `${kind}-outside-canvas`,
        spec: kind === 'seat' ? '4.3.1' : '4.4.1',
        path: ptr('sections', s, collection, i, axis),
        message:
          `${kind} ${quote(node.id)} has ${axis} ${v}, outside the canvas ` +
          `(0 to ${limit}, the canvas ${axis === 'x' ? 'width' : 'height'})`
      });
    }
  };
  arr(map.sections).forEach((section, s) => {
    arr(section?.seats).forEach((seat, i) => check(seat, 'seat', s, 'seats', i));
    arr(section?.elements).forEach((el, i) => check(el, 'element', s, 'elements', i));
  });
}

// (6) Within a section, no two seats share the same row and col (section
//     4.3.5): a (row, col) pair names one place in the adjacency order, and two
//     seats in it would leave "the seat next to this one" ambiguous.
function checkRowColUniqueness(map, out) {
  arr(map.sections).forEach((section, s) => {
    const first = new Map();
    arr(section?.seats).forEach((seat, i) => {
      if (!has(seat, 'row') || !has(seat, 'col')) return;
      const key = JSON.stringify([seat.row, seat.col]);
      if (!first.has(key)) {
        first.set(key, { seat, i });
        return;
      }
      const prior = first.get(key);
      out.push({
        rule: 'seat-row-col-duplicate',
        spec: '4.3.5',
        path: ptr('sections', s, 'seats', i, 'col'),
        message:
          `seat ${quote(seat.id)} is at row ${quote(seat.row)}, col ${seat.col}, which seat ${quote(prior.seat.id)} ` +
          `(${ptr('sections', s, 'seats', prior.i)}) already holds in section ${quote(section.id)}`
      });
    });
  });
}

// (7) A row shape's `cols` is [first, last], so first MUST NOT exceed last
//     (section 4.2.3); the guide-point formulas divide by last - first.
function checkRowShapes(map, out) {
  arr(map.sections).forEach((section, s) => {
    arr(section?.rows).forEach((row, r) => {
      const kind = ['line', 'arc', 'circle'].find((k) => has(row?.shape, k));
      if (!kind) return;
      const [a, b] = arr(row.shape[kind]?.cols);
      if (!isNum(a) || !isNum(b) || a <= b) return;
      out.push({
        rule: 'row-shape-cols-reversed',
        spec: '4.2.3',
        path: ptr('sections', s, 'rows', r, 'shape', kind, 'cols'),
        message: `row ${quote(row.id)} has a ${kind} shape spanning cols [${a}, ${b}]; the first column MUST NOT exceed the last`
      });
    });
  });
}

// (8a) Exactly one currency applies to the whole map (section 4.9), whole
//      prices included (section 4.9.1). Monies are compared in the order they
//      are gathered: price tiers, seat prices, then whole prices.
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
  for (const { node, at } of priceLevels(map)) {
    if (isObject(node?.wholePrice)) monies.push({ money: node.wholePrice, path: ptr(...at, 'wholePrice', 'currency') });
  }
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

// (8b) Identifier uniqueness (sections 4.3 and 4.6). Each kind of id is its
//      own namespace, unique within the scope the spec gives it: the whole map
//      for seats, sections, elements, groups, seat types and price tiers; its
//      own section for rows. `groups` is one scope's worth of collections, each
//      paired with the path tokens of the array it came from.
function reportDuplicateIds(groups, { rule, spec, kind, scope }, out) {
  const first = new Map();
  for (const { items, at } of groups) {
    arr(items).forEach((item, i) => {
      if (!has(item, 'id')) return;
      const path = ptr(...at, i, 'id');
      if (!first.has(item.id)) {
        first.set(item.id, path);
        return;
      }
      out.push({
        rule,
        spec,
        path,
        message: `${kind} id ${quote(item.id)} is already used at ${first.get(item.id)}; ${scope}`
      });
    });
  }
}

function checkIdUniqueness(map, out) {
  const sections = arr(map.sections);
  const perSection = (key) => sections.map((section, s) => ({ items: section?.[key], at: ['sections', s, key] }));

  reportDuplicateIds(
    [{ items: sections, at: ['sections'] }],
    { rule: 'section-id-duplicate', spec: '4.6', kind: 'section', scope: 'Section.id is unique within the map' },
    out
  );
  reportDuplicateIds(
    perSection('seats'),
    { rule: 'seat-id-duplicate', spec: '4.3', kind: 'seat', scope: 'Seat.id is unique across the whole map' },
    out
  );
  reportDuplicateIds(
    perSection('elements'),
    { rule: 'element-id-duplicate', spec: '4.6', kind: 'element', scope: 'Element.id is unique across the whole map' },
    out
  );
  reportDuplicateIds(
    perSection('groups'),
    { rule: 'group-id-duplicate', spec: '4.6', kind: 'group', scope: 'Group.id is unique across the whole map' },
    out
  );
  // Rows are section-scoped, as row references are, so each section is a
  // scope of its own.
  for (const group of perSection('rows')) {
    reportDuplicateIds(
      [group],
      { rule: 'row-id-duplicate', spec: '4.6', kind: 'row', scope: 'RowMeta.id is unique within its section' },
      out
    );
  }
  reportDuplicateIds(
    [{ items: map.legend, at: ['legend'] }],
    { rule: 'seat-type-id-duplicate', spec: '4.6', kind: 'seat type', scope: 'SeatType.id is unique within the legend' },
    out
  );
  reportDuplicateIds(
    [{ items: map.priceTiers, at: ['priceTiers'] }],
    { rule: 'price-tier-id-duplicate', spec: '4.6', kind: 'price tier', scope: 'PriceTier.id is unique within the map' },
    out
  );
}

/**
 * Every whole-document rule of section 4 that JSON Schema cannot express and a
 * conformant validator MUST enforce. Assumes nothing about the document beyond
 * it being parsed JSON: a malformed map yields the errors it can and skips the
 * rest, leaving the shape of the document to the schema.
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
  checkGroups(map, errors);
  checkCanvasBounds(map, errors);
  checkRowColUniqueness(map, errors);
  checkRowShapes(map, errors);
  checkSingleCurrency(map, errors);
  checkIdUniqueness(map, errors);
  return errors;
}

// --- warnings --------------------------------------------------------------

/**
 * A turned rectangle: centre, half-width, half-height, and angle in radians.
 * A seat's footprint (section 4.5) is a square of side `size` centred on its
 * x/y, turned by its rotation.
 */
const footprint = (seat, size) => ({
  x: seat.x,
  y: seat.y,
  size,
  hw: size / 2,
  hh: size / 2,
  theta: rad(isNum(seat.rotation) ? seat.rotation : 0)
});

/**
 * Whether two turned rectangles overlap, by the separating axis theorem over
 * the edge normals of both. Rectangles that only touch — neighbouring seats
 * placed exactly one seat size apart — do not overlap.
 */
function rectsOverlap(p, q) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const tolerance = 1e-9 * Math.max(p.hw, p.hh, q.hw, q.hh);
  for (const axis of [p.theta, p.theta + Math.PI / 2, q.theta, q.theta + Math.PI / 2]) {
    const reach = (f) => f.hw * Math.abs(Math.cos(f.theta - axis)) + f.hh * Math.abs(Math.sin(f.theta - axis));
    const gap = Math.abs(dx * Math.cos(axis) + dy * Math.sin(axis));
    if (gap >= reach(p) + reach(q) - tolerance) return false;
  }
  return true;
}

/**
 * Whether a circle overlaps a turned rectangle: the rectangle's nearest point
 * to the circle's centre lies strictly inside the circle. Touching is not
 * overlapping.
 */
function circleOverlapsRect(c, f) {
  const dx = c.x - f.x;
  const dy = c.y - f.y;
  const lx = dx * Math.cos(-f.theta) - dy * Math.sin(-f.theta);
  const ly = dx * Math.sin(-f.theta) + dy * Math.cos(-f.theta);
  const nx = Math.max(-f.hw, Math.min(f.hw, lx));
  const ny = Math.max(-f.hh, Math.min(f.hh, ly));
  return Math.hypot(lx - nx, ly - ny) < c.radius - 1e-9 * Math.max(c.radius, f.hw, f.hh);
}

// (W1) A validator SHOULD report seats whose footprints overlap (section
//      4.3.1). Every section shares the one canvas, so seats in different
//      sections can overlap too. Each pair is reported once, at the later seat.
function lintSeatOverlap(map, out) {
  const placed = [];
  arr(map.sections).forEach((section, s) => {
    const size = seatSizeOf(map, section);
    if (!isNum(size) || size <= 0) return;
    arr(section?.seats).forEach((seat, i) => {
      if (!isNum(seat?.x) || !isNum(seat?.y)) return;
      placed.push({ seat, at: ['sections', s, 'seats', i], f: footprint(seat, size), order: placed.length });
    });
  });
  // Sweep along x: two footprints can only overlap if their centres are closer
  // than the sum of their circumradii.
  placed.sort((a, b) => a.f.x - b.f.x);
  const reported = [];
  for (let j = 0; j < placed.length; j++) {
    const q = placed[j];
    for (let k = j - 1; k >= 0; k--) {
      const p = placed[k];
      const reach = (p.f.size + q.f.size) * Math.SQRT1_2;
      if (q.f.x - p.f.x > reach) break;
      if (Math.abs(q.f.y - p.f.y) > reach || !rectsOverlap(p.f, q.f)) continue;
      const [first, second] = p.order < q.order ? [p, q] : [q, p];
      reported.push({
        order: second.order,
        error: {
          rule: 'seat-overlap',
          spec: '4.3.1',
          path: ptr(...second.at),
          message: `seat ${quote(second.seat.id)} overlaps seat ${quote(first.seat.id)} (${ptr(...first.at)})`
        }
      });
    }
  }
  reported.sort((a, b) => a.order - b.order).forEach(({ error }) => out.push(error));
}

// (W2) A section's seats SHOULD lie inside its bounds (section 4.1). Only the
//      seat's centre is checked, as it is against the canvas.
function lintSectionBounds(map, out) {
  arr(map.sections).forEach((section, s) => {
    const b = section?.bounds;
    if (!isObject(b) || ![b.x, b.y, b.width, b.height].every(isNum)) return;
    arr(section.seats).forEach((seat, i) => {
      if (!isNum(seat?.x) || !isNum(seat?.y)) return;
      if (seat.x >= b.x && seat.x <= b.x + b.width && seat.y >= b.y && seat.y <= b.y + b.height) return;
      out.push({
        rule: 'seat-outside-section-bounds',
        spec: '4.1',
        path: ptr('sections', s, 'seats', i),
        message:
          `seat ${quote(seat.id)} at (${seat.x}, ${seat.y}) lies outside the bounds of section ${quote(section.id)} ` +
          `(${b.x}, ${b.y}, ${b.width} × ${b.height})`
      });
    });
  });
}

// (W3) A validator SHOULD report a group shape that overlaps a seat outside
//      the group (section 4.11). A seat may overlap its own group's shape — a
//      chair at a table's edge, a place on a sofa — and that is not reported.
//      Every section shares the one canvas, so a seat in another section can
//      be under a group's shape too.
function lintGroupShapes(map, out) {
  const seats = [];
  arr(map.sections).forEach((section) => {
    const size = seatSizeOf(map, section);
    if (!isNum(size) || size <= 0) return;
    arr(section?.seats).forEach((seat) => {
      if (isNum(seat?.x) && isNum(seat?.y)) seats.push({ seat, f: footprint(seat, size) });
    });
  });
  arr(map.sections).forEach((section, s) => {
    arr(section?.groups).forEach((group, g) => {
      const own = new Set(arr(group?.seats));
      const { rect, circle } = isObject(group?.shape) ? group.shape : {};
      let overlaps;
      if (isObject(rect) && [rect.x, rect.y, rect.width, rect.height].every(isNum)) {
        const r = { x: rect.x, y: rect.y, hw: rect.width / 2, hh: rect.height / 2, theta: rad(isNum(rect.rotation) ? rect.rotation : 0) };
        overlaps = (f) => rectsOverlap(r, f);
      } else if (isObject(circle) && Array.isArray(circle.center) && circle.center.every(isNum) && isNum(circle.radius)) {
        const c = { x: circle.center[0], y: circle.center[1], radius: circle.radius };
        overlaps = (f) => circleOverlapsRect(c, f);
      } else {
        return;
      }
      for (const { seat, f } of seats) {
        if (own.has(seat.id) || !overlaps(f)) continue;
        out.push({
          rule: 'group-shape-overlaps-seat',
          spec: '4.11',
          path: ptr('sections', s, 'groups', g, 'shape'),
          message: `the shape of group ${quote(group.id)} overlaps seat ${quote(seat.id)}, which is not in the group`
        });
      }
    });
  });
}

/**
 * The section 4 conditions a validator SHOULD report but MUST NOT reject a
 * document for: overlapping seat footprints, seats outside their section's
 * bounds, and a group's shape over a seat outside the group. Same shape as
 * `checkMap`'s errors.
 *
 * @param {unknown} map a KerusiMap document
 * @returns {KerusiError[]}
 */
export function lintMap(map) {
  /** @type {KerusiError[]} */
  const warnings = [];
  if (!isObject(map)) return warnings;
  lintSeatOverlap(map, warnings);
  lintSectionBounds(map, warnings);
  lintGroupShapes(map, warnings);
  return warnings;
}

/**
 * A KerusiSession against the map it names (section 5.3). It needs both
 * documents, so the validator's one-document `validate` cannot run it: the
 * session's `mapId` MUST be the map's `id`, and every key of
 * `bookingModes.sections` and `bookingModes.groups` MUST name a section or a
 * group of that map (section 4.12.2). A key that named nothing would change
 * no booking unit, and an event's "every table sold whole" would quietly not
 * happen.
 *
 * @param {unknown} session a KerusiSession document
 * @param {unknown} map the KerusiMap it names
 * @returns {KerusiError[]}
 */
export function checkSession(session, map) {
  /** @type {KerusiError[]} */
  const errors = [];
  if (!isObject(session) || !isObject(map)) return errors;
  if (has(session, 'mapId') && session.mapId !== map.id) {
    errors.push({
      rule: 'session-map-mismatch',
      spec: '5.3',
      path: ptr('mapId'),
      message: `session ${quote(session.id)} names map ${quote(session.mapId)}, not ${quote(map.id)}`
    });
  }
  const sections = new Set(arr(map.sections).map((section) => section?.id));
  const groups = new Set(arr(map.sections).flatMap((section) => arr(section?.groups).map((group) => group?.id)));
  const modes = isObject(session.bookingModes) ? session.bookingModes : {};
  for (const [key, known, kind] of [
    ['sections', sections, 'section'],
    ['groups', groups, 'group']
  ]) {
    if (!isObject(modes[key])) continue;
    for (const id of Object.keys(modes[key])) {
      if (known.has(id)) continue;
      errors.push({
        rule: 'session-booking-mode-unresolved',
        spec: '4.12.2',
        path: ptr('bookingModes', key, id),
        message: `session ${quote(session.id)} sets the booking mode of ${kind} ${quote(id)}, which map ${quote(map.id)} does not declare`
      });
    }
  }
  return errors;
}

/**
 * (8c) KerusiStateDelta.updatedAt is "strictly increasing per session/map, so a
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
