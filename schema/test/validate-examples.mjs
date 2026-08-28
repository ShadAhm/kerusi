// Compiles the four Kerusi schemas and checks them against the example corpus.
//
//   node schema/test/validate-examples.mjs
//
// Each example file's name carries the document type it should be validated
// against, ahead of the .kerusi.json extension section 8 registers:
// *.map.kerusi.json, *.session.kerusi.json, *.state.kerusi.json,
// *.statedelta.kerusi.json.
//
//   examples/                 MUST validate
//   examples/invalid/         MUST NOT validate
//   examples/validator-only/  MUST validate against the schema, but a
//                             conformant validator MUST still reject them
//                             (RFC section 4.6 rules JSON Schema cannot express)

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..');
const examplesDir = join(schemaDir, '..', 'examples');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// strictRequired is deliberately off: the layout branches express "MUST NOT
// carry x/y" as `not: { required: [...] }`, and ajv's strictRequired would
// demand those properties be re-declared inside each negated subschema.
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
addFormats(ajv);

// `version` is Kerusi metadata (the spec revision the schema tracks), not a
// JSON Schema keyword. Declare it so ajv's strict mode accepts it.
ajv.addKeyword({ keyword: 'version', metaSchema: { type: 'string' } });

const validators = {};
for (const [type, file] of Object.entries({
  map: 'kerusi-map-1.0.schema.json',
  session: 'kerusi-session-1.0.schema.json',
  state: 'kerusi-state-1.0.schema.json',
  statedelta: 'kerusi-statedelta-1.0.schema.json'
})) {
  validators[type] = ajv.compile(read(join(schemaDir, file)));
}

const typeOf = (name) => {
  const m = /\.(map|session|state|statedelta)\.kerusi\.json$/.exec(name);
  if (!m) throw new Error(`example ${name} does not name a document type`);
  return m[1];
};

let failures = 0;
const check = (dir, label, expectValid) => {
  const files = readdirSync(join(examplesDir, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();
  console.log(`\n${label} (${files.length})`);
  for (const name of files) {
    const validate = validators[typeOf(name)];
    const ok = validate(read(join(examplesDir, dir, name)));
    if (ok === expectValid) {
      console.log(`  pass  ${name}`);
    } else {
      failures++;
      console.log(`  FAIL  ${name} — expected ${expectValid ? 'valid' : 'invalid'}, got ${ok ? 'valid' : 'invalid'}`);
      if (!ok) {
        for (const e of validate.errors ?? []) {
          console.log(`          ${e.instancePath || '/'} ${e.message}`);
        }
      }
    }
  }
};

console.log('All four schemas compiled.');
check('.', 'Valid examples — MUST validate', true);
check('invalid', 'Invalid examples — MUST NOT validate', false);
check(
  'validator-only',
  'Validator-only cases — schema-valid, but a conformant validator MUST reject them (section 4.6)',
  true
);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAll checks passed.');
