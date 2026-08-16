# Product truth infrastructure

`PRODUCT.md` is the human product authority.

The files in this directory are validated machine contracts and generated
evidence:

- `capabilities.json` — twelve durable player-facing capabilities;
- `scenarios.json` — only states where actor, trigger, action, or meaning
  materially changes;
- `product-graph-relations.json` — curated semantic relationships static
  imports cannot prove;
- `context-known-answers.json` — questions the agent context must answer;
- `schema/` — standard JSON Schemas;
- `generated/` — committed deterministic graph and metadata.

## Commands

```bash
npm run product:validate
npm run product:graph
npm run product:graph:check
npm run product:context -- "What can an invention change?"
npm run product:context -- --capability sandbox.invention
npm run product:known-answers
npm run product:check
```

Optional semantic enrichment:

```bash
npm run product:graph:enrich
```

That command writes `graphify-out/`, which is ignored. Its extracted and
inferred edges are evidence only. It never overwrites `PRODUCT.md`, the JSON
contracts, or `docs/product/generated/product-graph.json`.

## Change order

1. Update `PRODUCT.md` when purpose/current/target/acceptance changes.
2. Update the matching JSON contract.
3. Run `npm run product:validate`.
4. Run `npm run product:graph`.
5. Run `npm run product:known-answers`.
6. Change implementation only after the product checks are green.
