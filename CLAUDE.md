# Kerusi

The normative spec is `RFC/kerusi-standard_v1.0.0-draft.md`. `schema/` holds
its JSON Schemas, TypeScript types and reference validator, and `examples/`
the conformance corpus they are tested against.

## Versioning

Three layers, and they move independently:

| Layer | Where | Current | Changes when |
|---|---|---|---|
| Spec version | RFC header table, `version` in every `schema/*.schema.json`, `package.json` | `1.0.0-draft` | The draft is promoted, or a new version is cut. Never for a rev. |
| Document conformance | `kerusi` member of every document (§7), the schemas' `kerusi` enum, `examples/` | `"1.0"` | A new major/minor spec version. Never for a rev. |
| Draft revision | §11 Changelog, commit title, git tag | see §11 | Every change to the spec's normative text. |

### Making a spec change (a new rev)

1. Take the next rev number after the newest §11 entry.
2. Add the entry at the **top** of §11: `**1.0.0-draft, rev N** — ...`. Say what
   changed and why, any alternatives considered and rejected, and whether the
   change is additive or a restriction on producers.
3. Keep the rest of the repo in step in the same change:
   - `schema/semantic-rules.mjs`, for any rule JSON Schema cannot express;
   - the schema `$comment`s;
   - `schema/kerusi-1.0.d.ts`;
   - `schema/README.md`;
   - a fixture per new rule in `examples/` (valid), `examples/invalid/`
     (schema-rejected) or `examples/validator-only/` (semantic-rejected,
     registered in `EXPECTED` in `schema/test/validate-examples.mjs`).

   Run `npm test`.
4. Title the commit that changes the RFC `RFC rev N: <summary>`.
5. Once that commit is on `master`, tag it and push the tag:

   ```bash
   git tag -a spec-1.0.0-draft.N <commit> -m "Kerusi 1.0.0-draft, rev N"
   git push origin spec-1.0.0-draft.N
   ```

   Tag the `RFC rev N` commit itself, not the PR merge commit. Implementers
   cite and pin revs by these tags. Revs 1–7 predate the repository; the
   first commit is rev 8.

Editorial fixes that change no normative meaning (typos, wording) don't need
a rev.

### Promoting or cutting a version

Update every place in the "Spec version" row together, and the "Document
conformance" row as well if the `kerusi` value changes. After `1.0.0` ships,
a spec change is a version bump rather than a rev: minor for additive
changes, major for restrictions on producers.
