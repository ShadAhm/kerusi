// The Kerusi validator: the JSON Schema check of section 8 followed by the
// semantic rules of section 7 that JSON Schema cannot express.
//
//   import { createValidator } from './schema/validator.mjs';
//   const kerusi = await createValidator();
//   const { valid, errors } = kerusi.validate(doc, 'map');
//
// ajv is the only dependency, and only this file needs it: ./semantic-rules.mjs
// carries every whole-document rule and imports nothing, so a consumer that
// already validates against the schemas by other means can use the rules alone.
//
// Both stages run on every document. Errors are never fatal to the pass that
// produced them, so one call reports every failure it can see rather than
// stopping at the first, and each one carries a JSON Pointer to the offending
// node. Where a document fails the schema badly enough that a semantic rule
// cannot be evaluated (a section that is not an object, a seat with no id), the
// rule quietly declines rather than guessing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { checkDeltaStream, checkMap } from './semantic-rules.mjs';

export { checkDeltaStream, checkMap, effectiveLayout, inferLayout, rowOrder } from './semantic-rules.mjs';

const schemaDir = dirname(fileURLToPath(import.meta.url));

/** The four document types of section 3, and the schema for each. */
export const SCHEMA_FILES = {
  map: 'kerusi-map-1.0.schema.json',
  session: 'kerusi-session-1.0.schema.json',
  state: 'kerusi-state-1.0.schema.json',
  statedelta: 'kerusi-statedelta-1.0.schema.json'
};

/**
 * An ajv instance configured as schema/README.md describes: `version` is Kerusi
 * metadata rather than a JSON Schema keyword, `strictRequired` conflicts with
 * the `not: { required: [...] }` layout branches, and `date-time` is only
 * enforced with ajv-formats registered.
 */
function createAjv() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'version', metaSchema: { type: 'string' } });
  return ajv;
}

/**
 * Compile the four schemas and return a validator over them.
 *
 * @param {{ schemas?: Record<string, object> }} [options] pre-loaded schemas,
 *   keyed by document type, for a caller that does not read from disk
 * @returns {{
 *   validate: (doc: unknown, type: string) => { valid: boolean, errors: import('./semantic-rules.mjs').KerusiError[] },
 *   validateDeltaStream: (deltas: unknown[]) => { valid: boolean, errors: object[] }
 * }}
 */
export function createValidator(options = {}) {
  const ajv = createAjv();
  const compiled = {};
  for (const [type, file] of Object.entries(SCHEMA_FILES)) {
    const schema = options.schemas?.[type] ?? JSON.parse(readFileSync(join(schemaDir, file), 'utf8'));
    compiled[type] = ajv.compile(schema);
  }

  const validate = (doc, type) => {
    const schemaValidate = compiled[type];
    if (!schemaValidate) throw new Error(`unknown Kerusi document type ${JSON.stringify(type)}`);

    const errors = [];
    if (!schemaValidate(doc)) {
      for (const e of schemaValidate.errors ?? []) {
        errors.push({
          rule: 'schema',
          spec: '8',
          path: e.instancePath || '',
          message: `${e.keyword}: ${e.message}${e.params && Object.keys(e.params).length > 0 ? ` (${JSON.stringify(e.params)})` : ''}`
        });
      }
    }
    // The semantic rules run whatever the schema said: a dangling seat type is
    // worth reporting alongside a missing required member, not after a re-run.
    if (type === 'map') errors.push(...checkMap(doc));
    return { valid: errors.length === 0, errors };
  };

  /**
   * A stream of KerusiStateDelta documents: each document against the schema,
   * then `updatedAt` monotonicity across the sequence (section 5.2). Per-document
   * errors carry a JSON Pointer prefixed with the document's index in the stream,
   * so every path in the result addresses the same array.
   */
  const validateDeltaStream = (deltas) => {
    const errors = [];
    deltas.forEach((delta, i) => {
      for (const e of validate(delta, 'statedelta').errors) {
        errors.push({ ...e, path: `/${i}${e.path}` });
      }
    });
    errors.push(...checkDeltaStream(deltas));
    return { valid: errors.length === 0, errors };
  };

  return { validate, validateDeltaStream };
}

/**
 * Document type from a corpus filename: `*.map.kerusi.json`,
 * `*.session.kerusi.json`, `*.state.kerusi.json`, `*.statedelta.kerusi.json`.
 * The type suffix is a convention of this repository's examples, not part of
 * the `.kerusi.json` extension section 8 registers.
 *
 * @param {string} name
 * @returns {'map'|'session'|'state'|'statedelta'|null}
 */
export function documentTypeFromFilename(name) {
  return /\.(map|session|state|statedelta)\.kerusi\.json$/.exec(name)?.[1] ?? null;
}
