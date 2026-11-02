# DocuMind AI — Add-On Features Context & Architecture Specification (`ADDONS_CONTEXT.md`)

> **Document Status:** Architectural Specification & Implementation Roadmap  
> **Target Audience:** Core Contributors, Engineering Leads, and System Architects  
> **Alignment:** Extends `CHAT_CONTEXT.md` and respects all hard constraints in `CLAUDE.md`.

---

## 1. Executive Summary & Core Philosophy

DocuMind AI's initial 15-day milestone establishes a **trust-first, evidence-grounded technical Q&A engine** with deterministic citation validation and two-gate abstention. 

The post-15-day add-on strategy expands DocuMind from a passive document search engine into an **active operational copilot for engineering teams**. It directly tackles the three biggest failure modes in engineering organizations:
1. **The 2 AM Incident Chaos:** Searching fragmented folders and stale wikis while production is failing.
2. **Documentation Drift & Rot:** Code evolves daily in pull requests, but runbooks and architecture docs remain untouched until an outage occurs.
3. **Context Switching Friction:** Forcing developers out of their terminals and IDEs into browser-based wikis.

### Architectural Invariants (Non-Negotiable)
- **100% TypeScript / NestJS 11:** No Python microservices, no FastAPI. Embedding (`nomic-embed-text-v1`), extraction (`unpdf`), and orchestration remain in-process inside Node.js.
- **Zero Heavy Infrastructure Overhead:** No mandatory Kafka clusters or Redis inside DocuMind. Third-party observability tools connect via standard HTTP Webhooks.
- **Evidence-First Abstention:** Every add-on must inherit the Two-Gate verification philosophy: if evidence is missing or confidence is below threshold, the system **explicitly abstains** rather than guessing remediation commands.

---

## 2. Pillar Breakdown & Feature Specifications

```
                     ┌────────────────────────────────────────────────────────┐
                     │              DocuMind Unified Core                     │
                     │  (NestJS 11 · pgvector HNSW · Two-Gate Verification)   │
                     └──────────────────────────┬─────────────────────────────┘
                                                │
         ┌──────────────────┬───────────────────┼───────────────────┬──────────────────┐
         ▼                  ▼                   ▼                   ▼                  ▼
   Pillar 1:           Pillar 2:           Pillar 3:           Pillar 4:          Pillar 5:
   Incident &          Developer           CI/CD & Doc         Frictionless       Enterprise
   Observability       Ergonomics          Health              Ingestion          Moats
   ─────────────────   ─────────────────   ─────────────────   ────────────────   ────────────────
   • Alert Webhook     • Terminal CLI      • Doc Drift PR      • Git Auto-Sync    • Blindspot
   • Outage Twin       • ADR Archeology      Checker           • OpenAPI Schema     Analytics
   • Safe Runbook      • Interactive       • Contradiction       EvidenceSource   • Chunk ACLs
   • Slack Bot           Onboarding          Linter            • PII Redaction    • SSO / SAML
```

---

### Pillar 1: Observability & Incident Response (The 2 AM Superpower)

#### 1.1 Autonomous Alert Enrichment & Triage
* **Problem:** Monitoring systems (Prometheus, Grafana, Kafka DLQs) fire cryptic alerts (`[FIRING] HighConsumerLag topic=payments lag=42000`). On-call engineers waste 30+ minutes finding the right runbook.
* **Mechanism:**
  - DocuMind exposes an open webhook endpoint: `POST /api/v1/webhooks/alerts/:integrationSecret`.
  - Normalizes heterogeneous alert payloads (Alertmanager, Grafana Contact Points, Kafka Connect HTTP Sink).
  - Queries `EvidenceSource` filtered to documents tagged `DocumentType.RUNBOOK`.
  - **Gate 1 Enforcement:** If top similarity < `0.55`, sends a fallback alert: *"No verified runbook matches this alert. Abstaining from guessing remediation commands."*
  - If verified, dispatches an enriched card to Slack/PagerDuty with exact page citations and copyable mitigation steps.

#### 1.2 "Outage Twin" Finder
* **Problem:** Post-mortems are written once and forgotten. Teams repeatedly suffer duplicate outages caused by identical root causes.
* **Mechanism:**
  - An engineer pastes a raw stack trace or log snippet.
  - Sanitization service strips dynamic noise (IPs, timestamps, UUIDs, memory addresses).
  - Vector similarity search runs against documents tagged `DocumentType.POST_MORTEM`.
  - Returns the closest historical incident, the root cause identified, and the fix that resolved it.

#### 1.3 Interactive "Safe Runbook" Executor
* **Problem:** Fatigued engineers copy-paste runbook commands containing destructive actions or placeholder variables (`<CLUSTER_HOST>`, `<DB_NAME>`), causing accidental damage.
* **Mechanism:**
  - Extracts code blocks from retrieved runbooks.
  - Lints for destructive commands (`DROP`, `FLUSHALL`, `delete`, `kill -9`).
  - Interactive CLI/UI prompts for required environment parameters and provides a `--dry-run` validation before execution.

#### 1.4 Slack & Discord Incident Assistant (`/documind`)
* **Problem:** Engineers leave incident war rooms to search documentation in separate tools.
* **Mechanism:**
  - Slash command `/documind incident <error>` provides instant, cited runbook snippets directly in the channel.
  - Interactive Slack buttons: `[Acknowledge]`, `[View Full Runbook]`, `[Mark Outdated]`.

---

### Pillar 2: Developer Ergonomics & Architecture

#### 2.1 Terminal CLI (`@documind/cli`)
* **Problem:** Developers dislike browser UIs while debugging in terminal environments.
* **Mechanism:**
  - Standalone TypeScript package running on Node.js (`npm i -g @documind/cli`).
  - Commands: `dm login`, `dm ask "<query>"`, `dm upload ./file.md`.
  - Connects to `GET /workspaces/:id/ask` via Server-Sent Events (SSE). Streams tokens directly to stdout with ANSI color-coded citations.

#### 2.2 Architecture Decision Record (ADR) Archeologist
* **Problem:** Developers do not know the historical rationale behind counter-intuitive code structures.
* **Mechanism:**
  - Indexes RFCs, ADRs, and technical design documents under `DocumentType.ADR_RFC`.
  - When asked *"Why did we choose X over Y?"*, queries specifically target decision drivers, rejected alternatives, and consequences.

#### 2.3 Interactive Developer Onboarding Copilot
* **Problem:** New hires take weeks asking senior engineers repetitive environment setup questions.
* **Mechanism:**
  - New hire selects their role (e.g., *Frontend Developer - Checkout*).
  - Synthesizes a role-specific Day 1 checklist strictly verified against internal setup docs and repository READMEs.

---

### Pillar 3: CI/CD & Automated Documentation Health

#### 3.1 GitHub Action: "Doc Drift" PR Checker
* **Problem:** Code changes in pull requests invalidate existing documentation without anyone noticing.
* **Mechanism:**
  - GitHub Action (`documind/doc-drift-action@v1`) runs on PR open/synchronize.
  - Submits the `git diff` (environment variables, config keys, API contracts) to DocuMind: `POST /api/v1/workspaces/:id/ci/drift-check`.
  - Retrieves relevant doc chunks. If a discrepancy exists (e.g., port changed in code from `5432` to `55432`), posts an automated PR review comment warning the author.

#### 3.2 Cross-Document Contradiction Linter
* **Problem:** Divergent documents across different versions claim conflicting facts.
* **Mechanism:**
  - Scheduled background worker (`DocLinterWorker`).
  - Compares overlapping high-similarity chunks across the workspace.
  - Flags conflicting values (differing port numbers, timeouts, limits) and logs them into a `DocConflict` table for tech lead review.

#### 3.3 Spec-to-Test Validator
* **Problem:** Specifications promise numerical boundaries that the test suite does not verify.
* **Mechanism:**
  - Extracts numerical constraints from specs (e.g., `MAX_UPLOAD_BYTES = 20MB`).
  - Verifies whether corresponding assertion patterns exist in test files (`expect(...).toBe(...)`).

---

### Pillar 4: Frictionless Ingestion & Multi-Source Evidence

#### 4.1 Git Repo & Markdown Webhook Auto-Sync
* **Problem:** Modern engineering teams write Markdown inside git repositories, not manual PDFs.
* **Mechanism:**
  - GitHub/GitLab webhook integration (`POST /api/v1/integrations/git/webhook`).
  - On push to `main`, pulls modified `.md` files via REST API (no `git clone` or disk bloat on the server).
  - Automatically re-chunks, embeds, and updates versions in PostgreSQL.

#### 4.2 OpenAPI & Database Schema as `EvidenceSource`
* **Problem:** Answers often span both written guidelines and machine-readable API contracts.
* **Mechanism:**
  - Implements the [`EvidenceSource`](file:///home/sudiptaadhikary/documind/api/CLAUDE.md#L70) interface for OpenAPI specs and Prisma schemas.
  - Answers questions regarding API schemas, required request parameters, and HTTP response codes directly from the contract.

#### 4.3 Automated Secret & PII Redaction
* **Problem:** Developers accidentally include API keys, AWS credentials, and JWTs in internal documentation.
* **Mechanism:**
  - Runs in `ExtractorService` before chunking and embedding.
  - Regex & entropy scanner sanitizes AWS secrets (`AKIA...`), private keys, and passwords, replacing them with `[REDACTED_SECRET]`.

---

### Pillar 5: Enterprise Governance & Monetization (Paid Tiers)

#### 5.1 "Unanswered Question" Blindspot Analytics
* **Problem:** Tech leads don't know where documentation has gaps until production issues occur.
* **Mechanism:**
  - Every time Gate 1 (low similarity) or Gate 2 (citation mismatch) triggers an abstention, the query is recorded in `UnansweredQuery`.
  - Admin dashboard visualizes recurring unanswered topics, providing a prioritized writing backlog.

#### 5.2 Granular Role-Based Chunk ACLs
* **Problem:** Sensitive documents (infrastructure secrets, compensation, security audits) must not be accessible to all workspace members.
* **Mechanism:**
  - Chunks carry `allowedRoles: Role[]`.
  - Handled directly in PostgreSQL raw SQL queries:
    ```sql
    AND (c.allowed_roles IS NULL OR $userRole = ANY(c.allowed_roles))
    ```

#### 5.3 Enterprise SSO / SAML / OIDC
* **Problem:** Enterprise IT mandates centralized identity management.
* **Mechanism:**
  - Integrates Okta, Google Workspace, and Azure AD with automated team provisioning.

---

## 3. Database Schema Extensions (Prisma Delta)

To support these add-ons, the following models extend `schema.prisma`:

```prisma
enum DocumentType {
  GENERAL
  RUNBOOK
  POST_MORTEM
  ADR_RFC
  SPECIFICATION
}

enum IngestionSourceType {
  PDF_UPLOAD
  GIT_WEBHOOK
  OPENAPI_SPEC
}

model GitIntegration {
  id            String    @id @default(cuid())
  workspaceId   String
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  repoUrl       String
  branch        String    @default("main")
  webhookSecret String
  includeGlobs  String[]  // ["docs/**/*.md", "README.md"]
  lastSyncedAt  DateTime?
  createdAt     DateTime  @default(now())

  @@index([workspaceId])
}

model AlertIntegration {
  id            String    @id @default(cuid())
  workspaceId   String
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  name          String
  secretToken   String    @unique
  targetChannel String    // Slack/Discord webhook URL
  createdAt     DateTime  @default(now())

  @@index([workspaceId])
}

model UnansweredQuery {
  id           String    @id @default(cuid())
  workspaceId  String
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  question     String
  reason       String    // LOW_SIMILARITY | CITATION_FAILED
  bestScore    Float
  askedAt      DateTime  @default(now())

  @@index([workspaceId, askedAt])
}

model DocConflict {
  id           String    @id @default(cuid())
  workspaceId  String
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  chunkAId     String
  chunkBId     String
  description  String
  resolved     Boolean   @default(false)
  createdAt    DateTime  @default(now())

  @@index([workspaceId])
}
```

---

## 4. API Endpoints Specification

| Method | Endpoint | Description | Auth / Guard |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/integrations/git/webhook` | Receives GitHub/GitLab push payloads | HMAC Signature Guard |
| `POST` | `/api/v1/webhooks/alerts/:secretToken` | Receives Prometheus/Grafana alerts | Secret Token Guard |
| `POST` | `/api/v1/workspaces/:id/ci/drift-check` | Compares PR git diffs to doc chunks | API Key / Token |
| `POST` | `/api/v1/workspaces/:id/incidents/match` | Matches stack traces against post-mortems | JwtAuth + Workspace |
| `GET` | `/api/v1/workspaces/:id/analytics/unanswered` | Retrieves missing doc queries | Roles (OWNER, ADMIN) |
| `GET` | `/api/v1/workspaces/:id/conflicts` | Lists detected document contradictions | Roles (OWNER, ADMIN) |

---

## 5. Phased Implementation Roadmap

```
Week 1–2: Complete 15-Day Core MVP (PDFs, pgvector, In-Process Nomics, Abstention, Eval)
───────────────────────────────────────────────────────────────────────────────────────
Phase 1 (Weeks 3–4): Ingestion & Terminal Adoption
  ├── Day 16–18: Git Webhook Receiver & Markdown Auto-Sync
  ├── Day 19–21: Terminal CLI (@documind/cli) with Streaming Output
  └── Day 22–24: DocumentType Tags & ADR Archeology Query Mode

Phase 2 (Weeks 5–6): Observability & Incident Response
  ├── Day 25–27: Alert Webhook Controller (Prometheus / Grafana / Kafka DLQ)
  ├── Day 28–30: Alert Triage & Slack Incident Bot (/documind)
  └── Day 31–32: Outage Twin Finder (Stack trace matching)

Phase 3 (Weeks 7–8): CI/CD & Automated Doc Health
  ├── Day 33–36: GitHub Action: "Doc Drift" PR Review Bot
  └── Day 37–40: Cross-Document Contradiction Linter

Phase 4 (Weeks 9–10): Enterprise Moats & Monetization
  ├── Day 41–43: Missing Docs Blindspot Analytics Dashboard
  ├── Day 44–46: Pre-Ingestion Secret & PII Redaction
  └── Day 47–50: Granular Chunk-Level Role ACLs & Enterprise SSO
```
