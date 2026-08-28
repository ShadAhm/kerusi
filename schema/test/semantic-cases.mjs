// Semantic rules that the example corpus cannot pin down on its own: the
// positive side of each rule family (a conformant document MUST NOT be
// rejected), and KerusiStateDelta.updatedAt monotonicity (section 5.2), which
// is a property of a stream rather than of any one file on disk.
//
// Run from validate-examples.mjs, which is the single entry point (`npm test`).

import { checkDeltaStream, checkMap, effectiveLayout, rowOrder } from '../semantic-rules.mjs';

const legend = [{ id: 'standard' }];

/** A minimal conformant map wrapped around one section. */
const mapWith = (section) => ({
  kerusi: '1.0',
  id: 'case',
  legend,
  sections: [{ id: 's', ...section }]
});

const gridSeat = (id, col) => ({ id, col, type: 'standard' });
const freeSeat = (id, x, y) => ({ id, x, y, type: 'standard' });

const delta = (updatedAt, extra = {}) => ({
  kerusi: '1.0',
  mapId: 'm',
  updatedAt,
  changes: {},
  ...extra
});

/** @type {{ name: string, run: () => string[] }[]} */
const cases = [
  // --- (5) layout inference, the accepting side --------------------------
  {
    name: 'a section with no layout whose seats all carry col alone infers "grid"',
    run: () => {
      const section = { seats: [gridSeat('a', 1), gridSeat('b', 2)] };
      const errors = checkMap(mapWith(section));
      return [
        effectiveLayout(section) === 'grid' ? null : `inferred ${effectiveLayout(section)}, expected grid`,
        errors.length === 0 ? null : `unexpected ${errors.map((e) => e.rule).join(', ')}`
      ].filter(Boolean);
    }
  },
  {
    name: 'a section with no layout whose seats all carry x and y infers "freeform"',
    run: () => {
      const section = { seats: [freeSeat('a', 10, 20), freeSeat('b', 30, 40)] };
      const errors = checkMap(mapWith(section));
      return [
        effectiveLayout(section) === 'freeform' ? null : `inferred ${effectiveLayout(section)}, expected freeform`,
        errors.length === 0 ? null : `unexpected ${errors.map((e) => e.rule).join(', ')}`
      ].filter(Boolean);
    }
  },
  {
    name: 'inference never yields "mixed": seats carrying col, x and y with no declared layout are rejected',
    run: () => {
      const errors = checkMap(mapWith({ seats: [{ id: 'a', col: 1, x: 5, y: 5, type: 'standard' }] }));
      return errors.some((e) => e.rule === 'layout-inference-inconsistent')
        ? []
        : ['expected layout-inference-inconsistent'];
    },
  },
  {
    name: 'declaring layout "mixed" makes the same section valid',
    run: () => {
      const errors = checkMap(mapWith({ layout: 'mixed', seats: [{ id: 'a', col: 1, x: 5, y: 5, type: 'standard' }] }));
      return errors.map((e) => `unexpected ${e.rule} at ${e.path}`);
    }
  },
  {
    name: 'the per-mode element rules apply to an inferred grid section too',
    run: () => {
      const errors = checkMap(
        mapWith({ seats: [gridSeat('a', 1)], elements: [{ id: 'e', kind: 'stage', x: 10, y: 10 }] })
      );
      return errors.some((e) => e.rule === 'element-layout-mismatch' && e.path === '/sections/0/elements/0')
        ? []
        : [`expected element-layout-mismatch at /sections/0/elements/0, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'a fractional cell span on an element in an inferred grid section is rejected',
    run: () => {
      const errors = checkMap(
        mapWith({ seats: [gridSeat('a', 1)], elements: [{ id: 'e', kind: 'stage', col: 1, width: 1.5 }] })
      );
      return errors.some((e) => e.rule === 'element-span-invalid' && e.path === '/sections/0/elements/0/width')
        ? []
        : [`expected element-span-invalid at /sections/0/elements/0/width, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'a section with no seats and no declared layout is not rejected (nothing to infer from)',
    run: () => checkMap(mapWith({ seats: [] })).map((e) => `unexpected ${e.rule} at ${e.path}`)
  },

  // --- (3) rows ----------------------------------------------------------
  {
    name: 'Seat.row is opaque free text when the section declares no rows',
    run: () => checkMap(mapWith({ seats: [{ ...gridSeat('a', 1), row: 'anything' }] })).map((e) => `unexpected ${e.rule}`)
  },
  {
    name: 'an empty row a no seat references is valid and holds its place in the row order',
    run: () => {
      const section = {
        layout: 'grid',
        rows: [{ id: 'throw', index: 0 }, { id: 'A', index: 1 }],
        seats: [{ ...gridSeat('a', 1), row: 'A' }]
      };
      const order = rowOrder(section);
      const errors = checkMap(mapWith(section));
      return [
        order.join(',') === 'throw,A' ? null : `row order ${order.join(',')}, expected throw,A`,
        ...errors.map((e) => `unexpected ${e.rule} at ${e.path}`)
      ].filter(Boolean);
    }
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
    name: 'index is an ordering key, not a position: a gap in index reserves no space',
    run: () => {
      // rows at index 0 and 11 with nothing between them are adjacent (section
      // 4.2.1), so a two-row span starting at the first row exactly fits.
      const errors = checkMap(
        mapWith({
          layout: 'grid',
          rows: [{ id: 'screen', index: 0 }, { id: 'A', index: 11 }],
          seats: [{ ...gridSeat('a', 1), row: 'A' }],
          elements: [{ id: 'e', kind: 'screen', row: 'screen', height: 2 }]
        })
      );
      return errors.map((e) => `unexpected ${e.rule} at ${e.path}`);
    }
  },

  // --- (6) element row spans --------------------------------------------
  {
    name: 'an element row span that ends exactly on the last row is accepted, one past it is not',
    run: () => {
      const section = (height) => ({
        layout: 'grid',
        rows: [{ id: 'screen', index: 0 }, { id: 'throw', index: 1 }, { id: 'A', index: 2 }],
        seats: [{ ...gridSeat('a', 1), row: 'A' }],
        elements: [{ id: 'e', kind: 'screen', row: 'screen', height }]
      });
      const exact = checkMap(mapWith(section(3)));
      const over = checkMap(mapWith(section(4)));
      return [
        exact.length === 0 ? null : `height 3 rejected: ${exact.map((e) => e.rule).join(', ')}`,
        over.some((e) => e.rule === 'element-row-span-overrun') ? null : 'height 4 accepted'
      ].filter(Boolean);
    }
  },

  // --- (4) companions ----------------------------------------------------
  {
    name: 'a symmetric companion pair is accepted',
    run: () => {
      const errors = checkMap(
        mapWith({
          seats: [
            { ...gridSeat('L1', 1), companions: ['L2'] },
            { ...gridSeat('L2', 2), companions: ['L1'] }
          ]
        })
      );
      return errors.map((e) => `unexpected ${e.rule} at ${e.path}`);
    }
  },
  {
    name: 'a companion group of three MUST have every member list every other',
    run: () => {
      const seats = (companions) => [
        { ...gridSeat('A', 1), companions: companions.A },
        { ...gridSeat('B', 2), companions: companions.B },
        { ...gridSeat('C', 3), companions: companions.C }
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
        kerusi: '1.0',
        id: 'case',
        legend,
        sections: [
          { id: 's1', seats: [{ ...gridSeat('A', 1), companions: ['B'] }] },
          { id: 's2', seats: [gridSeat('B', 1)] }
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
      const errors = checkMap({
        kerusi: '1.0',
        id: 'case',
        legend: [{ id: 'standard', defaultPriceTier: 'gone' }],
        priceTiers: [{ id: 'regular', price: { amount: 1500, currency: 'MYR' } }],
        sections: [{ id: 's', seats: [gridSeat('a', 1)] }]
      });
      return errors.some(
        (e) => e.rule === 'seat-type-default-price-tier-unresolved' && e.path === '/legend/0/defaultPriceTier'
      )
        ? []
        : [`expected seat-type-default-price-tier-unresolved at /legend/0/defaultPriceTier, got ${JSON.stringify(errors)}`];
    }
  },
  {
    name: 'an unpriced seat is a valid terminal state (section 4.9 step 4)',
    run: () => checkMap(mapWith({ seats: [gridSeat('a', 1)] })).map((e) => `unexpected ${e.rule}`)
  },

  // --- (7a) currency -----------------------------------------------------
  {
    name: 'a literal Seat.price in a second currency is rejected',
    run: () => {
      const errors = checkMap({
        kerusi: '1.0',
        id: 'case',
        legend,
        priceTiers: [{ id: 'regular', price: { amount: 1500, currency: 'MYR' } }],
        sections: [{ id: 's', seats: [{ ...gridSeat('a', 1), price: { amount: 900, currency: 'SGD' } }] }]
      });
      return errors.some((e) => e.rule === 'map-currency-mixed' && e.path === '/sections/0/seats/0/price/currency')
        ? []
        : [`expected map-currency-mixed at /sections/0/seats/0/price/currency, got ${JSON.stringify(errors)}`];
    }
  },

  // --- (7b) seat id uniqueness -------------------------------------------
  {
    name: 'a duplicate Seat.id within one section is rejected',
    run: () => {
      const errors = checkMap(mapWith({ seats: [gridSeat('a', 1), gridSeat('a', 2)] }));
      return errors.some((e) => e.rule === 'seat-id-duplicate' && e.path === '/sections/0/seats/1/id')
        ? []
        : [`expected seat-id-duplicate at /sections/0/seats/1/id, got ${JSON.stringify(errors)}`];
    }
  },

  // --- (7c) delta stream monotonicity (section 5.2) ----------------------
  {
    name: 'a delta stream with strictly increasing updatedAt is accepted',
    run: () =>
      checkDeltaStream([
        delta('2026-08-17T09:00:00Z'),
        delta('2026-08-17T09:00:01Z'),
        delta('2026-08-17T17:05:00+08:00') // 09:05:00Z — an offset other than Z still advances
      ]).map((e) => `unexpected ${e.rule} at ${e.path}`)
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
      checkDeltaStream([
        delta('2026-08-17T09:00:00Z', { mapId: 'm1' }),
        delta('2026-08-17T08:00:00Z', { mapId: 'm2' }),
        delta('2026-08-17T09:00:01Z', { mapId: 'm1' }),
        delta('2026-08-17T08:00:01Z', { sessionId: 'sess', mapId: undefined })
      ]).map((e) => `unexpected ${e.rule} at ${e.path}`)
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
