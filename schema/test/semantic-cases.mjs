// Semantic rules that the example corpus cannot pin down on its own: the
// positive side of each rule family (a conformant document MUST NOT be
// rejected), the warnings a validator SHOULD report, the guide-point and
// neighbour definitions, and KerusiStateDelta.updatedAt monotonicity (section
// 5.2), which is a property of a stream rather than of any one file on disk.
//
// Run from validate-examples.mjs, which is the single entry point (`npm test`).

import {
  areNeighbours,
  checkDeltaStream,
  checkMap,
  guidePoint,
  isOnGuide,
  lintMap,
  rowOrder,
  sectionOrder
} from '../semantic-rules.mjs';

const legend = [{ id: 'standard' }];

/** A minimal conformant map wrapped around one section. */
const mapWith = (section, extra = {}) => ({
  kerusi: '1.0',
  id: 'case',
  canvas: { width: 1000, height: 1000 },
  seatSize: 40,
  legend,
  ...extra,
  sections: [{ id: 's', ...section }]
});

/** A seat in row A at column `col`, drawn on a 48-unit pitch. */
const rowSeat = (id, col, extra = {}) => ({ id, row: 'A', col, x: 100 + 48 * (col - 1), y: 100, type: 'standard', ...extra });
const looseSeat = (id, x, y, extra = {}) => ({ id, x, y, type: 'standard', ...extra });

const delta = (updatedAt, extra = {}) => ({
  kerusi: '1.0',
  mapId: 'm',
  updatedAt,
  changes: {},
  ...extra
});

const unexpected = (errors) => errors.map((e) => `unexpected ${e.rule} at ${e.path}`);
const near = (p, [x, y]) => p !== null && Math.abs(p[0] - x) < 0.5 && Math.abs(p[1] - y) < 0.5;
const fmt = (p) => (p === null ? 'null' : `(${p.map((v) => v.toFixed(1)).join(', ')})`);

// The shapes of the town hall in examples/town-hall.map.kerusi.json.
const rowA = { line: { from: [320, 400], to: [1088, 400], cols: [1, 9] } };
const table = { circle: { center: [1300, 300], radius: 70, start: -90, cols: [1, 4] } };
const balcony = { arc: { center: [800, 60], radius: 640, start: 120, sweep: -60, cols: [1, 7] } };

/** @type {{ name: string, run: () => string[] }[]} */
const cases = [
  // --- (5) the canvas ----------------------------------------------------
  {
    name: 'a seat on the very edge of the canvas is on it: 0 <= x <= width, 0 <= y <= height',
    run: () => unexpected(checkMap(mapWith({ seats: [looseSeat('a', 1000, 0), looseSeat('b', 0, 1000)] })))
  },
  {
    name: 'a seat past both edges of the canvas is reported once per axis',
    run: () => {
      const paths = checkMap(mapWith({ seats: [looseSeat('a', 1001, 1200)] }))
        .filter((e) => e.rule === 'seat-outside-canvas')
        .map((e) => e.path)
        .join(',');
      return paths === '/sections/0/seats/0/x,/sections/0/seats/0/y'
        ? []
        : [`expected x and y reported, got ${paths || 'nothing'}`];
    }
  },
  {
    name: 'a seat with no row and no col is valid: it simply has no neighbours',
    run: () => unexpected(checkMap(mapWith({ seats: [looseSeat('S1', 500, 500)] })))
  },

  // --- (6) neighbours (section 4.3.5) ------------------------------------
  {
    name: 'neighbours are seats in the same row whose cols differ by 1, and nothing else',
    run: () => {
      const a1 = rowSeat('A1', 1);
      const a2 = rowSeat('A2', 2);
      const a4 = rowSeat('A4', 4);
      const b2 = { ...rowSeat('B2', 2), row: 'B' };
      const loose = looseSeat('S1', a1.x + 40, a1.y); // touching A1, but in no row
      return [
        areNeighbours(a1, a2) ? null : 'A1 and A2 are not neighbours',
        areNeighbours(a2, a1) ? null : 'neighbourhood is not symmetric',
        areNeighbours(a2, a4) ? 'A2 and A4 are neighbours across an aisle (col 3 skipped)' : null,
        areNeighbours(a1, b2) ? 'A1 and B2 are neighbours across rows' : null,
        areNeighbours(a1, loose) ? 'a loose seat is a neighbour by distance' : null
      ].filter(Boolean);
    }
  },
  {
    name: 'two seats in one section may not share a row and col; two sections may each have A1 at col 1',
    run: () => {
      const clash = checkMap(mapWith({ seats: [rowSeat('A1', 1), rowSeat('A1b', 1, { x: 400 })] }));
      const separate = checkMap({
        ...mapWith({ seats: [rowSeat('A1', 1)] }),
        sections: [
          { id: 's1', seats: [rowSeat('s1-A1', 1)] },
          { id: 's2', seats: [rowSeat('s2-A1', 1, { y: 300 })] }
        ]
      });
      return [
        clash.some((e) => e.rule === 'seat-row-col-duplicate' && e.path === '/sections/0/seats/1/col')
          ? null
          : `expected seat-row-col-duplicate at /sections/0/seats/1/col, got ${JSON.stringify(clash)}`,
        ...unexpected(separate)
      ].filter(Boolean);
    }
  },

  // --- (7) row shapes (section 4.2.3) ------------------------------------
  {
    name: 'line guide points: an even spread from `from` to `to`, aisle cols keeping their gap',
    run: () =>
      [
        [1, [320, 400]],
        [4, [608, 400]],
        [5, [704, 400]], // no seat at col 5 in the town hall: an aisle, but the point is still there
        [6, [800, 400]],
        [9, [1088, 400]]
      ]
        .map(([col, want]) => (near(guidePoint(rowA, col), want) ? null : `col ${col}: ${fmt(guidePoint(rowA, col))}`))
        .filter(Boolean)
  },
  {
    name: 'arc guide points: angles on the canvas axes, a negative sweep turning anticlockwise on screen',
    run: () =>
      [
        [1, [480, 614.3]],
        [4, [800, 700]],
        [5, [911.1, 690.3]],
        [7, [1120, 614.3]]
      ]
        .map(([col, want]) =>
          near(guidePoint(balcony, col), want) ? null : `col ${col}: ${fmt(guidePoint(balcony, col))}, expected ${fmt(want)}`
        )
        .filter(Boolean)
  },
  {
    name: 'circle guide points: evenly round the whole circle, the last not landing back on the first',
    run: () =>
      [
        [1, [1300, 230]],
        [2, [1370, 300]],
        [3, [1300, 370]],
        [4, [1230, 300]]
      ]
        .map(([col, want]) => (near(guidePoint(table, col), want) ? null : `col ${col}: ${fmt(guidePoint(table, col))}`))
        .filter(Boolean)
  },
  {
    name: 'a single-column shape puts its one guide point at `from`, or at `start` on an arc',
    run: () => {
      const line = guidePoint({ line: { from: [10, 20], to: [90, 20], cols: [3, 3] } }, 3);
      const arc = guidePoint({ arc: { center: [0, 0], radius: 10, start: 90, sweep: 45, cols: [2, 2] } }, 2);
      return [near(line, [10, 20]) ? null : `line gave ${fmt(line)}`, near(arc, [0, 10]) ? null : `arc gave ${fmt(arc)}`].filter(
        Boolean
      );
    }
  },
  {
    name: 'a col outside the shape\'s range has no guide point',
    run: () => (guidePoint(rowA, 10) === null && guidePoint(rowA, 0) === null ? [] : ['expected null outside cols [1, 9]'])
  },
  {
    name: 'on its guide means within seatSize / 4 of its guide point',
    run: () =>
      [
        [{ row: 'A', col: 9, x: 1100, y: 440 }, false, 'A9, moved off its line'],
        [{ row: 'L', col: 5, x: 930, y: 760 }, false, 'L5, dragged off its arc'],
        [{ row: 'L', col: 4, x: 800, y: 700 }, true, 'L4'],
        [{ row: 'L', col: 4, x: 800, y: 709.9 }, true, 'L4 moved 9.9'],
        [{ row: 'L', col: 4, x: 800, y: 710.1 }, false, 'L4 moved 10.1']
      ]
        .map(([seat, want, what]) =>
          isOnGuide(seat, seat.row === 'A' ? rowA : balcony, 40) === want ? null : `${what}: expected on guide = ${want}`
        )
        .filter(Boolean)
  },
  {
    name: 'a seat off its guide stays in its row, and is valid where it is',
    run: () =>
      unexpected(
        checkMap(
          mapWith({
            rows: [{ id: 'A', shape: { line: { from: [100, 100], to: [196, 100], cols: [1, 3] } } }],
            seats: [rowSeat('A1', 1), rowSeat('A2', 2), rowSeat('A3', 3, { x: 260, y: 160 })]
          })
        )
      )
  },
  {
    name: 'a row with a shape and no seats, and a row nothing references, are both valid',
    run: () =>
      unexpected(
        checkMap(
          mapWith({
            rows: [{ id: 'A' }, { id: 'walkway' }, { id: 'B', shape: { arc: { center: [500, 0], radius: 400, start: 120, sweep: -60, cols: [1, 9] } } }],
            seats: [rowSeat('A1', 1)]
          })
        )
      )
  },

  // --- rows and sections: order ------------------------------------------
  {
    name: 'Seat.row is opaque free text when the section declares no rows',
    run: () => unexpected(checkMap(mapWith({ seats: [rowSeat('a', 1, { row: 'anything' })] })))
  },
  {
    name: 'row order puts indexed rows first (ascending), then unindexed ones in declaration order',
    run: () => {
      const order = rowOrder({
        rows: [{ id: 'late' }, { id: 'B', index: 11 }, { id: 'A', index: 0 }, { id: 'later' }]
      });
      return order.join(',') === 'A,B,late,later' ? [] : [`row order ${order.join(',')}, expected A,B,late,later`];
    }
  },
  {
    name: 'section order puts indexed sections first (ascending), then unindexed ones in declaration order',
    run: () => {
      const order = sectionOrder({
        sections: [{ id: 'late' }, { id: 'B', index: 5 }, { id: 'tie2', index: 5 }, { id: 'A', index: 0 }, { id: 'later' }]
      });
      const want = 'A,B,tie2,late,later';
      return order.join(',') === want ? [] : [`section order ${order.join(',')}, expected ${want}`];
    }
  },
  {
    name: 'a section index is an ordering key, not a position: 0 and 5 order the same as 0 and 1',
    run: () => {
      const gap = sectionOrder({ sections: [{ id: 'b', index: 5 }, { id: 'a', index: 0 }] });
      const dense = sectionOrder({ sections: [{ id: 'b', index: 1 }, { id: 'a', index: 0 }] });
      return gap.join(',') === dense.join(',') && gap.join(',') === 'a,b'
        ? []
        : [`gap gave ${gap.join(',')}, dense gave ${dense.join(',')}, expected a,b for both`];
    }
  },

  // --- warnings: overlap (section 4.3.1) and bounds (section 4.1) --------
  {
    name: 'overlapping seats are reported as a warning, once, at the later seat, and do not invalidate the map',
    run: () => {
      const map = mapWith({ seats: [looseSeat('a', 100, 100), looseSeat('b', 120, 110)] });
      const warnings = lintMap(map);
      return [
        ...unexpected(checkMap(map)),
        warnings.length === 1 && warnings[0].rule === 'seat-overlap' && warnings[0].path === '/sections/0/seats/1'
          ? null
          : `expected one seat-overlap at /sections/0/seats/1, got ${JSON.stringify(warnings)}`
      ].filter(Boolean);
    }
  },
  {
    name: 'seats exactly one seat size apart touch but do not overlap',
    run: () => unexpected(lintMap(mapWith({ seats: [rowSeat('A1', 1, { x: 100 }), rowSeat('A2', 2, { x: 140 })] })))
  },
  {
    name: 'rotation turns the footprint: 45° seats 40 apart overlap, 57 apart do not',
    run: () => {
      const pair = (dx) =>
        lintMap(mapWith({ seats: [looseSeat('a', 100, 100, { rotation: 45 }), looseSeat('b', 100 + dx, 100, { rotation: 45 })] }));
      return [
        pair(40).some((e) => e.rule === 'seat-overlap') ? null : '45° seats 40 apart not reported',
        pair(57).length === 0 ? null : `45° seats 57 apart reported: ${JSON.stringify(pair(57))}`
      ].filter(Boolean);
    }
  },
  {
    name: 'a section seatSize applies to its own seats: 45 apart is clear at 40, overlapping at 50',
    run: () => {
      const seats = [looseSeat('a', 100, 100), looseSeat('b', 145, 100)];
      return [
        ...unexpected(lintMap(mapWith({ seats }))),
        lintMap(mapWith({ seatSize: 50, seats })).some((e) => e.rule === 'seat-overlap') ? null : 'not reported at seatSize 50'
      ].filter(Boolean);
    }
  },
  {
    name: 'every section shares one canvas, so seats in two sections can overlap',
    run: () => {
      const warnings = lintMap({
        ...mapWith({ seats: [] }),
        sections: [
          { id: 'stalls', seats: [looseSeat('a', 100, 100)] },
          { id: 'balcony', seats: [looseSeat('b', 110, 100)] }
        ]
      });
      return warnings.some((e) => e.rule === 'seat-overlap' && e.path === '/sections/1/seats/0')
        ? []
        : [`expected seat-overlap at /sections/1/seats/0, got ${JSON.stringify(warnings)}`];
    }
  },
  {
    name: 'a seat outside its section bounds is a warning, not an error',
    run: () => {
      const map = mapWith({ bounds: { x: 0, y: 0, width: 200, height: 200 }, seats: [looseSeat('in', 100, 100), looseSeat('out', 300, 100)] });
      const warnings = lintMap(map);
      return [
        ...unexpected(checkMap(map)),
        warnings.length === 1 && warnings[0].rule === 'seat-outside-section-bounds' && warnings[0].path === '/sections/0/seats/1'
          ? null
          : `expected one seat-outside-section-bounds at /sections/0/seats/1, got ${JSON.stringify(warnings)}`
      ].filter(Boolean);
    }
  },

  // --- (4) companions ----------------------------------------------------
  {
    name: 'a symmetric companion pair is accepted',
    run: () =>
      unexpected(
        checkMap(mapWith({ seats: [rowSeat('L1', 1, { companions: ['L2'] }), rowSeat('L2', 2, { companions: ['L1'] })] }))
      )
  },
  {
    name: 'a companion group of three MUST have every member list every other',
    run: () => {
      const seats = (companions) => [
        rowSeat('A', 1, { companions: companions.A }),
        rowSeat('B', 2, { companions: companions.B }),
        rowSeat('C', 3, { companions: companions.C })
      ];
      const complete = checkMap(mapWith({ seats: seats({ A: ['B', 'C'], B: ['A', 'C'], C: ['A', 'B'] }) }));
      // Pairwise symmetric, but A and C never list one another: a chain, not a group.
      const chain = checkMap(mapWith({ seats: seats({ A: ['B'], B: ['A', 'C'], C: ['B'] }) }));
      return [
        complete.length === 0 ? null : `complete group rejected: ${complete.map((e) => e.rule).join(', ')}`,
        chain.some((e) => e.rule === 'companion-group-incomplete') ? null : 'chained group accepted'
      ].filter(Boolean);
    }
  },
  {
    name: 'a companion in another section does not resolve',
    run: () => {
      const errors = checkMap({
        ...mapWith({ seats: [] }),
        sections: [
          { id: 's1', seats: [looseSeat('A', 100, 100, { companions: ['B'] })] },
          { id: 's2', seats: [looseSeat('B', 140, 100)] }
        ]
      });
      return errors.some((e) => e.rule === 'companion-unresolved' && e.path === '/sections/0/seats/0/companions/0')
        ? []
        : [`expected companion-unresolved, got ${JSON.stringify(errors)}`];
    }
  },

  // --- (2) price tiers ---------------------------------------------------
  {
    name: 'SeatType.defaultPriceTier resolves against priceTiers[].id',
    run: () => {
      const errors = checkMap(
        mapWith(
          { seats: [rowSeat('a', 1)] },
          {
            legend: [{ id: 'standard', defaultPriceTier: 'gone' }],
            priceTiers: [{ id: 'regular', price: { amount: 1500, currency: 'MYR' } }]
          }
        )
      );
      return errors.some(
        (e) => e.rule === 'seat-type-default-price-tier-unresolved' && e.path === '/legend/0/defaultPriceTier'
      )
        ? []
        : [`expected seat-type-default-price-tier-unresolved at /legend/0/defaultPriceTier, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'an unpriced seat is a valid terminal state (section 4.9 step 4)',
    run: () => unexpected(checkMap(mapWith({ seats: [rowSeat('a', 1)] })))
  },

  // --- (8a) currency -----------------------------------------------------
  {
    name: 'a literal Seat.price in a second currency is rejected',
    run: () => {
      const errors = checkMap(
        mapWith(
          { seats: [rowSeat('a', 1, { price: { amount: 900, currency: 'SGD' } })] },
          { priceTiers: [{ id: 'regular', price: { amount: 1500, currency: 'MYR' } }] }
        )
      );
      return errors.some((e) => e.rule === 'map-currency-mixed' && e.path === '/sections/0/seats/0/price/currency')
        ? []
        : [`expected map-currency-mixed at /sections/0/seats/0/price/currency, got ${JSON.stringify(errors)}`];
    }
  },

  // --- (8b) id uniqueness ------------------------------------------------
  {
    name: 'a duplicate Seat.id within one section is rejected',
    run: () => {
      const errors = checkMap(mapWith({ seats: [rowSeat('a', 1), rowSeat('a', 2)] }));
      return errors.some((e) => e.rule === 'seat-id-duplicate' && e.path === '/sections/0/seats/1/id')
        ? []
        : [`expected seat-id-duplicate at /sections/0/seats/1/id, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'a duplicate Element.id within one section is rejected',
    run: () => {
      const errors = checkMap(
        mapWith({
          seats: [rowSeat('a', 1)],
          elements: [
            { id: 'e', kind: 'exit', x: 500, y: 900 },
            { id: 'e', kind: 'exit', x: 600, y: 900 }
          ]
        })
      );
      return errors.length === 1 && errors[0].rule === 'element-id-duplicate' && errors[0].path === '/sections/0/elements/1/id'
        ? []
        : [`expected one element-id-duplicate at /sections/0/elements/1/id, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'two sections may each declare a row with the same id: RowMeta.id is section-scoped',
    run: () =>
      unexpected(
        checkMap({
          ...mapWith({ seats: [] }),
          sections: [
            { id: 's1', rows: [{ id: 'A' }], seats: [rowSeat('a1', 1)] },
            { id: 's2', rows: [{ id: 'A' }], seats: [rowSeat('b1', 1, { y: 300 })] }
          ]
        })
      )
  },
  {
    name: 'each kind of id is its own namespace: a seat, an element and a section may share an id',
    run: () => unexpected(checkMap(mapWith({ id: 'x', seats: [rowSeat('x', 1)], elements: [{ id: 'x', kind: 'exit', x: 500, y: 900 }] })))
  },

  // --- (8c) delta stream monotonicity (section 5.2) ----------------------
  {
    name: 'a delta stream with strictly increasing updatedAt is accepted',
    run: () =>
      unexpected(
        checkDeltaStream([
          delta('2026-08-17T09:00:00Z'),
          delta('2026-08-17T09:00:01Z'),
          delta('2026-08-17T17:05:00+08:00') // 09:05:00Z — an offset other than Z still advances
        ])
      )
  },
  {
    name: 'an out-of-order delta is rejected, and the next stale one is reported too',
    run: () => {
      const errors = checkDeltaStream([
        delta('2026-08-17T09:00:00Z'),
        delta('2026-08-17T08:59:00Z'),
        delta('2026-08-17T08:58:00Z'),
        delta('2026-08-17T09:00:01Z')
      ]);
      const paths = errors.map((e) => e.path).join(',');
      return errors.every((e) => e.rule === 'delta-updated-at-not-increasing') && paths === '/1/updatedAt,/2/updatedAt'
        ? []
        : [`expected /1/updatedAt,/2/updatedAt, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'a repeated updatedAt is rejected: strictly increasing, not merely non-decreasing',
    run: () => {
      const errors = checkDeltaStream([delta('2026-08-17T09:00:00Z'), delta('2026-08-17T09:00:00Z')]);
      return errors.length === 1 && errors[0].path === '/1/updatedAt'
        ? []
        : [`expected one error at /1/updatedAt, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'the same instant is fine on two different offsets only if it advances',
    run: () => {
      // 09:00:00Z and 17:00:00+08:00 are the same instant, so the second does
      // not advance the stream.
      const errors = checkDeltaStream([delta('2026-08-17T09:00:00Z'), delta('2026-08-17T17:00:00+08:00')]);
      return errors.length === 1 ? [] : [`expected one error, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'monotonicity is per session/map, so interleaved scopes do not collide',
    run: () =>
      unexpected(
        checkDeltaStream([
          delta('2026-08-17T09:00:00Z', { mapId: 'm1' }),
          delta('2026-08-17T08:00:00Z', { mapId: 'm2' }),
          delta('2026-08-17T09:00:01Z', { mapId: 'm1' }),
          delta('2026-08-17T08:00:01Z', { sessionId: 'sess', mapId: undefined })
        ])
      )
  }
];

/**
 * @returns {number} the number of failing cases
 */
export function runSemanticCases() {
  console.log(`\nSemantic rules — cases the corpus cannot express (${cases.length})`);
  let failures = 0;
  for (const { name, run } of cases) {
    const problems = run();
    if (problems.length === 0) {
      console.log(`  pass  ${name}`);
      continue;
    }
    failures++;
    console.log(`  FAIL  ${name}`);
    for (const problem of problems) console.log(`          ${problem}`);
  }
  return failures;
}
