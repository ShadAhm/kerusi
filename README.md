# Kerusi — Seat Map and Availability Format

Kerusi (Malay for "chair") is a vendor-neutral, domain-agnostic data format for describing the physical layout of seats and their real-time availability. It's a data format, not a library, protocol, or renderer — any backend (cinema, airline, theatre, stadium, bus, or train booking system) can produce a conformant document, and any renderer (canvas, SVG, DOM grid) can consume one.

This repository holds the specification itself, plus the tooling that makes it mechanically checkable: [`schema/`](schema/) has one JSON Schema per document type (§8) and a validator for the §4–§5 rules JSON Schema cannot express, and [`examples/`](examples/) holds the conformance corpus both are tested against. There is no renderer here.

## Status

**Draft — open for comment.** The current draft is version `1.0.0-draft`, not yet finalized. See [§10 Open Issues](RFC/kerusi-standard_v1.0.0-draft.md#10-open-issues-for-the-10-release) for what's still unresolved before a stable 1.0 release.

## The schemas and the validator

🧪 [schema/](schema/) — draft 2020-12 JSON Schemas for `KerusiMap`, `KerusiSession`,
`KerusiState`, and `KerusiStateDelta`, the [validator](schema/validator.mjs) that runs them
and then enforces the referential-integrity, layout-inference and whole-document rules of
§4–§5 that JSON Schema cannot state, and [TypeScript interfaces](schema/kerusi-1.0.d.ts)
for every type in §4–§5. The [README](schema/README.md) covers what each stage enforces
and where the schemas deliberately deviate from the spec text.

```bash
npm install && npm test
```

## The spec

📄 [RFC/kerusi-standard_v1.0.0-draft.md](RFC/kerusi-standard_v1.0.0-draft.md)

Key ideas covered in the spec:

- **Static/dynamic split** — a cacheable `KerusiMap` (layout) is separate from a frequently-updated `KerusiState` (availability), rather than one mutable structure.
- **Freeform and grid positioning** — seats can be addressed by `row`/`col` or by `x`/`y` coordinates, so curved rows, stadium bowls, and irregular cabin layouts are representable alongside plain grids.
- **Sections, pricing, seat types, and companion seats** — the structure needed once a layout goes beyond a single room.
- **`KerusiStateDelta`** for incremental, real-time updates over a push transport (WebSocket, SSE), distinct from a full `KerusiState` snapshot.
- **Migration notes** from a prior seat-picker implementation, `angularJs.keruC`.

## Contributing

This is a specification under active draft review. To contribute:

1. Open an issue to discuss a proposed change before drafting spec text for anything non-trivial.
2. For edits, fork the repository, edit [RFC/kerusi-standard_v1.0.0-draft.md](RFC/kerusi-standard_v1.0.0-draft.md), and open a pull request describing the rationale.
3. Note any addition in the spec's own §11 Changelog as part of the same change.
4. If the change touches a document type's shape or its validation rules, update the matching schema in [schema/](schema/) and the corpus in [examples/](examples/) in the same pull request, and check that `npm test` passes.

## License

Two licenses, split by what the file is:

- **Specification text** — everything under [RFC/](RFC/), this README, and the other prose docs — is [CC BY 4.0](LICENSE-DOCS). Quote it, republish it, translate it, build on it; just give credit and say what you changed.
- **Code** — the JSON Schemas in [schema/](schema/), the example corpus in [examples/](examples/), and the test harness — is [MIT](LICENSE), so implementers can vendor the schemas into a product without ceremony.

A format nobody may copy is a format nobody implements, which is why the spec text is not all-rights-reserved.
