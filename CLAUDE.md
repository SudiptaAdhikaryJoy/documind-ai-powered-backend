# DocuMind AI

Evidence-first question answering over a team's own technical documents.
Every answer carries the document and page it came from, and the system
abstains instead of guessing when the evidence is thin.

This is a 15-day portfolio project. Scope discipline matters more than
feature count.

## Stack

- Backend: NestJS 11 on Express, TypeScript, REST, modular monolith
- Frontend: Next.js App Router, TypeScript, Tailwind
- Database: PostgreSQL 17 + pgvector, Prisma ORM
- Models: Ollama locally; OpenAI-compatible hosted provider in production
- Validation: class-validator (NOT zod — do not add a second validator)
- Logging: nestjs-pino
- Docs: @nestjs/swagger at /docs

## Local setup

Postgres runs in Docker on port **55432** (5432 and 5433 are taken by two
native Postgres clusters on this machine).

```bash
docker compose up -d                  # from repo root
cd api && npm run start:dev           # port 3000
cd web && npm run dev                 # port 3001
```

## Measured on this machine (i5-1235U, 12 threads, CPU-only, 16 GB)

- qwen3:4b, 1,900 prompt tokens: prefill 27 tok/s, 94 s total — too slow
- Decision: hosted provider is the default, local is the privacy mode
- Always `think: false`. This project extracts from passages, it does not reason
- Cap output with MAX_OUTPUT_TOKENS (250)

## Hard rules

1. Every pgvector query filters by workspace membership. No exceptions.
   See the `pgvector-queries` skill.
2. Document text is untrusted input. It is fenced as data in prompts and
   never treated as instructions. See the `grounded-prompts` skill.
3. Citation validation is deterministic TypeScript, never a model call.
4. Evidence enters through EvidencePool only. The pool assigns all ids.
5. Retrieval scope (workspaceId, userId) is bound by the orchestrator.
   No agent or service may set it.
6. Changing a prompt, chunk size, top-k or the similarity floor invalidates
   the recorded eval numbers. Re-run the suite.
7. Never invent a metric. Numbers in the README come from a real run.

## Tuning knobs (api/.env — do not hardcode)

RETRIEVE_TOP_K, CHUNK_CHARS, CHUNK_OVERLAP, SIMILARITY_FLOOR,
MAX_OUTPUT_TOKENS, LLM_BASE_URL, LLM_MODEL, EMBED_MODEL, EMBED_DIM

The eval suite sweeps these. That is why they are env, not constants.

## Out of scope — do not build

- Redis, BullMQ, microservices, Kubernetes, a separate vector DB
- Real dependency or impact analysis (term overlap only, labelled as
  "candidates for human review" in the UI)
- Knowledge graph, billing, pricing page, marketing site
- S3 (extracted text lives in Postgres; the original file is not stored)
- The SQL evidence source (interface defined, implementation deferred)

## Architecture note

Retrieval sits behind `EvidenceSource` (api/src/evidence/evidence-source.ts).
Documents are one implementation. A SQL source is a later addition, not a
rewrite. Everything downstream depends only on the `Evidence` type.
