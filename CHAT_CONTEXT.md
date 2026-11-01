# DocuMind AI — Project & Chat Context (`CHAT_CONTEXT.md`)

> **Last Updated:** November 1, 2026
> **Current Branch:** `documents-upload-feat`
> **Stack:** NestJS 11 · TypeScript · PostgreSQL + `pgvector` (HNSW) · Prisma 6 · `@huggingface/transformers` (`Xenova/nomic-embed-text-v1`) · OpenAI-compatible LLM (`Groq` / `Qwen`)

---

## 1. Product Vision & Core Commitments

**DocuMind AI** is a trust-first technical documentation Q&A engine for engineering teams (10–80 engineers) and software agencies. Unlike generic RAG chatbots, DocuMind enforces two deterministic commitments:

1. **Verified Citations with Page Provenance:** Every factual claim must carry a `[id]` citation mapped to a real `(Document, Version, Page, Heading)` passage in the retrieved evidence pool. Citations are verified in TypeScript (`verifyCitations`) *before* any answer is streamed.
2. **Explicit Abstention Over Hallucination:** When retrieved evidence does not support an answer, the system refuses to answer and states what is missing. Two deterministic gates sit outside the LLM:
   - **Gate 1 (Pre-LLM):** If fewer than `MIN_PASSAGES_TO_ANSWER` (`2`) passages pass `SIMILARITY_FLOOR` (`0.55`), the LLM is never called (saving cost and preventing guesswork).
   - **Gate 2 (Post-LLM):** If the LLM cites an `[id]` that does not exist in the retrieved pool, the output is discarded and converted into an abstention.

---

## 2. Business Model & Stakeholder Value

| Persona | Relationship | What Convince Them |
| :--- | :--- | :--- |
| **Backend / On-Call Engineer** | Daily User | Sub-2s answers, clickable page numbers, and honest `"I don't know"` at 2 AM instead of hallucinated runbook commands. |
| **Tech Lead** | Retention Decision | Version diffing (`v1` vs `v2`) and identifying which candidate docs a change just invalidated. |
| **CTO / Eng Manager** | Buyer | $0 indexing cost (local CPU embeddings), 40%+ LLM token savings via Gate 1 abstention, and measurable `/eval` recall metrics. |
| **Security / Governance** | Blocker | Zero model training on customer data, in-process document indexing (full docs never leave the server), strict SQL `Membership` RBAC, and 1-line switch to 100% on-premise inference. |

### Pricing Tiers
- **Free Tier:** Single workspace, capped at `FREE_MAX_DOCUMENTS=5` and `FREE_MAX_QUESTIONS_PER_MONTH=100`.
- **Team Tier (Cloud SaaS):** Shared workspace, version history, review queue; hosted backend running in-process `nomic-embed-text` + Groq/OpenAI chat API.
- **Business Tier (Privacy / On-Prem):** Self-hosted inside customer VPC with local `Ollama` for both chat and embeddings.

---

## 3. AI Model & Embedding Architecture (Zero-Ollama Required)

### Why Chat and Embeddings Are Split
1. **Chat / Answer Composition (`LLM_BASE_URL`, `LLM_MODEL`):**
   - **Stateless:** Only reads the top 3 retrieved text passages (`RETRIEVE_TOP_K=3`) at question time.
   - **Configurable per environment:** Can use **Groq** (`https://api.groq.com/openai/v1` with `qwen/qwen3.8-27b`) on any laptop or cloud server, or local Ollama (`qwen3:4b`) in privacy mode without affecting stored vectors.
   - **Deterministic Settings:** `LLM_TEMPERATURE=0` and `LLM_THINK=false` are fixed so evaluation scores remain reproducible.
2. **Embeddings (`EMBED_PROVIDER`, `EMBED_HF_MODEL`, `EMBED_DIM=768`):**
   - **Stateful (Must Match Across All Environments):** Stored in PostgreSQL `Chunk.embedding` (`vector(768)` with `HNSW` `vector_cosine_ops` index).
   - **Primary Provider (`EMBED_PROVIDER="transformers"`):** Uses `@huggingface/transformers` running quantized **`Xenova/nomic-embed-text-v1`** (768-dim) directly inside the Node.js process.
     - No external Ollama installation required on developer laptops or cloud servers.
     - Automatically prefixes chunks with `search_document: <heading>\n<content>` and queries with `search_query: <question>`.
   - **Dynamic Fallbacks:** Also supports `EMBED_PROVIDER="ollama"` (`http://localhost:11434/api/embed`), `EMBED_PROVIDER="openai"` (`/v1/embeddings`), and an offline deterministic 768-dim L2-normalized feature-hashing safety net.

---

## 4. Ingestion & Background Indexing Pipeline (Days 4–5 — Completed)

Located in `src/document/`:
1. **[`ExtractorService`](src/document/extractor.service.ts):**
   - Enforces `UPLOAD_MAX_BYTES` (`20MB`).
   - Validates files by magic bytes (`%PDF-` header, binary signature detection for PNG/JPEG/ZIP/EXE/ELF, null-byte checks) rather than trusting client extensions or MIME headers.
   - Extracts PDF text page-by-page using **`unpdf`** (`extractText(..., { mergePages: false })`) with `pdf-parse` fallback, preserving exact `pageNumber` provenance.
2. **[`ChunkerService`](src/document/chunker.service.ts):**
   - Splits page text into `CHUNK_CHARS=600` characters with `CHUNK_OVERLAP=90` character word-boundary overlap.
   - Detects Markdown and uppercase section headings and attaches `heading` metadata to each chunk.
3. **[`DocumentService`](src/document/document.service.ts):**
   - Sanitizes filenames (`path.basename` + control-char stripping).
   - Enforces `FREE_MAX_DOCUMENTS=5` on `Plan.FREE` workspaces.
   - Computes SHA-256 hash per upload: deduplicates identical uploads (and re-queues if previously `FAILED`), or creates incremental versions (`v1`, `v2`, `v3`) in a transaction.
   - Returns `202 Accepted` immediately with `status: PENDING`.
4. **[`IngestionWorker`](src/document/ingestion.worker.ts):**
   - Database-backed polling worker (`WORKER_POLL_MS=5000`) — intentionally avoids Redis/BullMQ operational overhead.
   - Self-heals on startup (`onApplicationBootstrap`) by resetting stuck `INDEXING` or `FAILED` documents back to `PENDING`.
   - Claims `PENDING` documents $\rightarrow$ sets `INDEXING` $\rightarrow$ embeds chunks via [`EmbeddingService`](src/document/embedding.service.ts) $\rightarrow$ writes `vector(768)` via parameterized raw SQL $\rightarrow$ sets `READY`.
5. **[`DocumentController`](src/document/document.controller.ts):**
   - Protected by `JwtAuthGuard`, `WorkspaceGuard`, and `RolesGuard`.
   - Endpoints:
     - `POST /workspaces/:workspaceId/documents` & `/upload` (`OWNER`, `MEMBER`)
     - `GET /workspaces/:workspaceId/documents` (`OWNER`, `MEMBER`, `VIEWER`)
     - `GET /workspaces/:workspaceId/documents/:documentId` (`OWNER`, `MEMBER`, `VIEWER`)
     - `POST /workspaces/:workspaceId/documents/:documentId/versions` (`OWNER`, `MEMBER`)
     - `GET /workspaces/:workspaceId/documents/:documentId/versions` (`OWNER`, `MEMBER`, `VIEWER`)
     - `DELETE /workspaces/:workspaceId/documents/:documentId` (`OWNER` only)

---

## 5. Multi-Agent & Retrieval Design Rules (Days 6–12 Roadmap)

- **`EvidenceSource` Seam:** Retrieval sits behind `EvidenceSource`, ordering by the bare pgvector `<=>` operator so PostgreSQL uses the `chunk_embedding_hnsw` index, and applying `SIMILARITY_FLOOR=0.55` in TypeScript afterward.
- **Strict Agent Isolation:**
  - **Planner:** Sees only the user's question (never passage text $\rightarrow$ prevents prompt injection). Returns 1–3 sub-questions.
  - **Retriever:** Bound to orchestrator's `RequestScope` (`Membership` SQL join). Returns raw evidence rows into a deduplicated pool with globally assigned `[id]`s.
  - **Composer:** Sees pooled evidence fenced as untrusted data + original question. Writes one answer with `[id]` citations.
  - **Summariser:** Sees only changed diff blocks between two `Version` rows.
  - **Orchestrator:** Owns all state, permissions, token/time budget (`BUDGET_PROMPT_TOKENS=6000`, `BUDGET_WALL_MS=120000`), and deterministic `verifyCitations()`.

---

## 6. Build Plan Progress

| Days | Milestone | Status |
| :--- | :--- | :--- |
| **Days 1–2** | PostgreSQL + `pgvector` HNSW migration, NestJS scaffold, Prisma schema | **Done** |
| **Day 3** | Auth (`register`, `login`, `refresh` rotation & reuse detection, `logout`), Workspaces & RBAC, Health, Swagger | **Done** |
| **Days 4–5** | Document upload, magic-byte validation, `unpdf` extraction, heading-aware chunking, in-process `nomic-embed-text` embeddings, `IngestionWorker` | **Done** |
| **Days 6–8** | Retrieval (`EvidenceSource`) with `Membership` filter, prompt fencing, citation validation, abstention gates, `/ask` SSE streaming & history | **Next Up** |
| **Days 9–10** | Next.js frontend: document library, streaming ask screen, clickable sources panel | Pending |
| **Day 11** | Version diff (`GET /documents/:id/diff`) and change review (`POST /documents/:id/review`) | Pending |
| **Day 12** | Evaluation suite (`POST /eval/run`, `GET /eval/runs`) with recorded recall/citation metrics | Pending |
| **Days 13–15** | Docker Compose production packaging, CI, README & demo | Pending |
