# Kerusi — Seat Map and Availability Format

Kerusi (Malay for "chair") is a vendor-neutral, domain-agnostic data format for describing the physical layout of seats and their real-time availability. It's a data format, not a library, protocol, or renderer — any backend (cinema, airline, theatre, stadium, bus, or train booking system) can produce a conformant document, and any renderer (canvas, SVG, DOM grid) can consume one.

This repository holds the specification itself, plus the JSON Schemas that make it mechanically checkable: [`schema/`](schema/) has one schema per document type (§8), and [`examples/`](examples/) holds the conformance corpus they are tested against. There is no runtime library here.

## Status

**Draft — open for comment.** The current draft is version `1.0.0-draft`, not yet finalized. See [§11 Open Issues](RFC/kerusi-standard_v1.0.0-draft.md#11-open-issues-for-the-10-release) for what's still unresolved before a stable 1.0 release.

## The schemas

🧪 [schema/](schema/) — draft 2020-12 JSON Schemas for `KerusiMap`, `KerusiSession`,
`KerusiState`, and `KerusiStateDelta`, with a [README](schema/README.md) covering what they
enforce, where they deliberately deviate from the spec text, and which normative rules of
§4.6 need a custom validator instead.

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
3. Note any addition in the spec's own §12 Changelog as part of the same change.
4. If the change touches a document type's shape or its validation rules, update the matching schema in [schema/](schema/) and the corpus in [examples/](examples/) in the same pull request, and check that `npm test` passes.

## License

No LICENSE file is currently included in this repository. Treat the specification as all-rights-reserved until one is added.
