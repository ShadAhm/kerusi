// Runs the Kerusi validator — the four schemas, then the semantic rules of
// section 7 that JSON Schema cannot express — over the example corpus.
//
//   npm test
//   node schema/test/validate-examples.mjs
//
// Each example file's name carries the document type it should be validated
// against, ahead of the .kerusi.json extension section 8 registers:
// *.map.kerusi.json, *.session.kerusi.json, *.state.kerusi.json,
// *.statedelta.kerusi.json.
//
//   examples/                 MUST pass both stages
//   examples/invalid/         MUST be rejected by the schema stage
//   examples/validator-only/  MUST pass the schema stage and MUST be rejected
//                             by the semantic stage, with the specific error
//                             named in EXPECTED below

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createValidator, documentTypeFromFilename } from '../validator.mjs';
import { runSemanticCases } from './semantic-cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, '..', '..', 'examples');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const kerusi = createValidator();

// One document per rule family of schema/README.md's "What they cannot enforce"
// table. Each entry is the complete set of semantic errors the file must
// produce — rule code and JSON Pointer — so a fixture that starts failing for
// the wrong reason is a test failure, not a pass.
const EXPECTED = {
  'dangling-seat-type.map.kerusi.json': [['seat-type-unresolved', '/sections/0/seats/0/type']],
  'dangling-price-tier.map.kerusi.json': [['seat-price-tier-unresolved', '/sections/0/seats/0/priceTier']],
  'dangling-row.map.kerusi.json': [['seat-row-unresolved', '/sections/0/seats/0/row']],
  'asymmetric-companions.map.kerusi.json': [['companion-asymmetric', '/sections/0/seats/0/companions/0']],
  'inferred-layout-inconsistent.map.kerusi.json': [['layout-inference-inconsistent', '/sections/0']],
  'element-rowspan-overruns.map.kerusi.json': [['element-row-span-overrun', '/sections/0/elements/0/height']],
  'mixed-currencies.map.kerusi.json': [['map-currency-mixed', '/priceTiers/1/price/currency']],
  'duplicate-seat-ids.map.kerusi.json': [['seat-id-duplicate', '/sections/1/seats/0/id']]
};

const filesIn = (dir) =>
  readdirSync(join(examplesDir, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();

const validateFile = (dir, name) => {
  const type = documentTypeFromFilename(name);
  if (!type) throw new Error(`example ${name} does not name a document type`);
  return kerusi.validate(read(join(examplesDir, dir, name)), type);
};

const show = (errors) => {
  for (const e of errors) console.log(`          [${e.rule}] ${e.path || '/'} — ${e.message}`);
};

let failures = 0;

// examples/ — conformant documents. Nothing may reject them.
const checkValid = () => {
  const files = filesIn('.');
  console.log(`\nValid examples — MUST pass schema and validator (${files.length})`);
  for (const name of files) {
    const { valid, errors } = validateFile('.', name);
    if (valid) {
      console.log(`  pass  ${name}`);
      continue;
    }
    failures++;
    console.log(`  FAIL  ${name} — expected no errors, got ${errors.length}`);
    show(errors);
  }
};

// examples/invalid/ — structurally malformed. The schema stage must catch each
// one; a document only the semantic rules reject belongs in validator-only/.
const checkInvalid = () => {
  const files = filesIn('invalid');
  console.log(`\nInvalid examples — MUST be rejected by the schema stage (${files.length})`);
  for (const name of files) {
    const { errors } = validateFile('invalid', name);
    if (errors.some((e) => e.rule === 'schema')) {
      console.log(`  pass  ${name}`);
      continue;
    }
    failures++;
    console.log(`  FAIL  ${name} — the schema accepted it`);
    show(errors);
  }
};

// examples/validator-only/ — schema-valid documents that a conformant validator
// MUST still reject (section 4.6, section 7), each asserting its specific error.
const checkValidatorOnly = () => {
  const files = filesIn('validator-only');
  console.log(`\nValidator-only cases — schema-valid, MUST be rejected by the semantic rules (${files.length})`);
  for (const name of files) {
    const expected = EXPECTED[name];
    if (!expected) {
      failures++;
      console.log(`  FAIL  ${name} — no expected error declared for this fixture`);
      continue;
    }
    const { errors } = validateFile('validator-only', name);
    const schemaErrors = errors.filter((e) => e.rule === 'schema');
    const semantic = errors.filter((e) => e.rule !== 'schema');
    const problems = [];
    if (schemaErrors.length > 0) problems.push(`the schema rejected it, so it is not a validator-only case`);

    const got = semantic.map((e) => `${e.rule} ${e.path}`).sort();
    const want = expected.map(([rule, path]) => `${rule} ${path}`).sort();
    if (got.join(' | ') !== want.join(' | ')) {
      problems.push(`expected exactly [${want.join(', ')}], got [${got.join(', ')}]`);
    }
    if (problems.length === 0) {
      console.log(`  pass  ${name} — ${want.join(', ')}`);
      continue;
    }
    failures++;
    console.log(`  FAIL  ${name}`);
    for (const problem of problems) console.log(`          ${problem}`);
    show(errors);
  }

  // Every rule family in the README table is pinned by a fixture; a fixture
  // added with no expectation is caught above, an expectation with no fixture here.
  const orphans = Object.keys(EXPECTED).filter((name) => !files.includes(name));
  if (orphans.length > 0) {
    failures++;
    console.log(`  FAIL  expectations declared for missing fixtures: ${orphans.join(', ')}`);
  }
};

console.log('All four schemas compiled.');
checkValid();
checkInvalid();
checkValidatorOnly();
failures += runSemanticCases();

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAll checks passed.');
