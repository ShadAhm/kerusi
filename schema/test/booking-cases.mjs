// The booking-units conformance corpus, examples/booking-units/*.json, run
// against the reference implementation in ../booking.mjs (sections 4.9.1 and
// 4.12). Each file is one map and a list of scenarios: an optional session and
// state, the booking units and whole units expected of them, and selections
// with whether each is valid and, if so, its total and the levels priced
// whole. Its format is described in examples/booking-units/README.md.
//
// Every map, session and state in the corpus is first validated, so a case
// cannot pass on a document no conformant consumer would accept.
//
// Run from validate-examples.mjs, which is the single entry point (`npm test`).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bookingUnits, checkSelection, priceSelection } from '../booking.mjs';
import { checkSession } from '../semantic-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, '..', '..', 'examples', 'booking-units');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** A document given inline, or as a path relative to the case file. */
const load = (value) => (typeof value === 'string' ? read(resolve(corpusDir, value)) : value ?? undefined);

/** Units compared as sets: order of units and of the seats in each is not significant. */
const canon = (units) =>
  units
    .map((u) => JSON.stringify([u.level, u.id, [...u.seats].sort(), u.bookable ?? null]))
    .sort()
    .join('\n');

const sameMoney = (a, b) => (a === null || b === null ? a === b : a.amount === b.amount && a.currency === b.currency);

const shown = (money) => (money === null ? 'unpriced' : `${money.amount} ${money.currency}`);

function runScenario(map, scenario, kerusi) {
  const problems = [];
  const session = load(scenario.session);
  const state = load(scenario.state);

  if (session) {
    for (const e of [...kerusi.validate(session, 'session').errors, ...checkSession(session, map)]) {
      problems.push(`session: [${e.rule}] ${e.path} ${e.message}`);
    }
  }
  if (state) {
    for (const e of kerusi.validate(state, 'state').errors) problems.push(`state: [${e.rule}] ${e.path} ${e.message}`);
  }

  const got = bookingUnits(map, session, state);
  if (canon(got.units) !== canon(scenario.units)) {
    problems.push(`units: expected\n${canon(scenario.units)}\n          got\n${canon(got.units)}`);
  }
  if (canon(got.wholeUnits) !== canon(scenario.wholeUnits)) {
    problems.push(`whole units: expected\n${canon(scenario.wholeUnits)}\n          got\n${canon(got.wholeUnits)}`);
  }

  for (const selection of scenario.selections ?? []) {
    const label = JSON.stringify(selection.seats);
    const { valid, problems: why } = checkSelection(map, session, selection.seats);
    if (valid !== selection.valid) {
      problems.push(`selection ${label}: expected ${selection.valid ? 'valid' : 'invalid'}, got ${valid ? 'valid' : `invalid (${why.join('; ')})`}`);
      continue;
    }
    if (!valid) continue;
    const price = priceSelection(map, session, selection.seats);
    if (!sameMoney(price.total, selection.total ?? null)) {
      problems.push(`selection ${label}: expected ${shown(selection.total ?? null)}, got ${shown(price.total)}`);
    }
    const wholes = price.wholes.map((w) => `${w.level}:${w.id}`);
    const want = (selection.pricedWhole ?? []).map((w) => `${w.level}:${w.id}`);
    if (wholes.join(',') !== want.join(',')) {
      problems.push(`selection ${label}: expected priced whole at [${want.join(', ')}], got [${wholes.join(', ')}]`);
    }
  }
  return problems;
}

/**
 * @param {{ validate: Function }} kerusi a validator from ../validator.mjs
 * @returns {number} the number of failing scenarios
 */
export function runBookingCases(kerusi) {
  const files = readdirSync(corpusDir).filter((name) => name.endsWith('.json')).sort();
  let failures = 0;
  let count = 0;
  const lines = [];
  for (const name of files) {
    const file = read(join(corpusDir, name));
    const map = load(file.map);
    const mapCheck = kerusi.validate(map, 'map');
    if (!mapCheck.valid || mapCheck.warnings.length > 0) {
      failures++;
      lines.push(`  FAIL  ${name} — its map is not a valid, warning-free KerusiMap`);
      for (const e of [...mapCheck.errors, ...mapCheck.warnings]) lines.push(`          [${e.rule}] ${e.path} ${e.message}`);
      continue;
    }
    for (const scenario of file.scenarios) {
      count++;
      const problems = runScenario(map, scenario, kerusi);
      if (problems.length === 0) {
        lines.push(`  pass  ${name}: ${scenario.name}`);
        continue;
      }
      failures++;
      lines.push(`  FAIL  ${name}: ${scenario.name}`);
      for (const problem of problems) lines.push(`          ${problem}`);
    }
  }
  console.log(`\nBooking units and selection prices — examples/booking-units/ (${count})`);
  for (const line of lines) console.log(line);
  return failures;
}
