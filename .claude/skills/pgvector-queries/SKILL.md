---
name: pgvector-queries
description: Use when writing or changing any vector similarity search, embedding write, or pgvector migration in this repo. Also use when a retrieval query returns wrong, slow, or cross-workspace results.
---

# pgvector in this repo

Prisma has no vector type, so every similarity query is raw SQL. This is the
one place the stack fights us and the one place a mistake leaks another
workspace's data.

## The schema side

`Chunk.embedding` is declared as:

```prisma
embedding Unsupported("vector(768)")?
```

Prisma cannot create the index. After any migration that recreates the
column, add it by hand:

```bash
npx prisma migrate dev --create-only --name chunk_hnsw
```

Then put this in the generated `migration.sql`:

```sql
CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw
  ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

768 is `EMBED_DIM` and must match the embedding model. Changing the model
means a new migration and re-embedding every chunk.

## Writing an embedding

Prisma's typed client cannot write the column. Use raw SQL with a text cast:

```ts
const vec = `[${embedding.join(',')}]`;
await this.prisma.$executeRaw`
  UPDATE "Chunk" SET embedding = ${vec}::vector WHERE id = ${chunkId}
`;
```

Never interpolate the array directly into the string. Build the bracketed
text, pass it as a parameter, cast to `::vector` in SQL.

## The canonical retrieval query

Copy this shape. The joins are what enforce permissions.

```ts
const vec = `[${queryEmbedding.join(',')}]`;

const rows = await this.prisma.$queryRaw<Row[]>`
  SELECT
    c.id,
    c.content,
    c.page,
    c.heading,
    d.title  AS doc_title,
    v.label  AS version_label,
    1 - (c.embedding <=> ${vec}::vector) AS score
  FROM "Chunk" c
  JOIN "Version"    v ON v.id = c."versionId"
  JOIN "Document"   d ON d.id = v."documentId"
  JOIN "Membership" m ON m."workspaceId" = d."workspaceId"
  WHERE m."userId"      = ${scope.userId}
    AND d."workspaceId" = ${scope.workspaceId}
    AND d.status        = 'READY'
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> ${vec}::vector
  LIMIT ${limit}
`;
```

### Why each line is there

- **JOIN Membership on userId** — this is the permission filter. Without it
  the query returns every workspace's chunks. It is not optional and it is
  not replaceable by a check in application code.
- **workspaceId in WHERE as well** — a user may belong to several
  workspaces; this scopes to the active one.
- **status = 'READY'** — half-indexed documents have incomplete embeddings
  and would return partial evidence.
- **ORDER BY with the bare `<=>` operator** — only this form uses the HNSW
  index. Wrapping it (`ORDER BY 1 - (...)`, or ordering by the aliased
  `score`) forces a sequential scan over every chunk.

### Score vs distance

`<=>` is cosine *distance*: 0 is identical, 2 is opposite. The `1 - (...)`
in the SELECT converts it to a similarity in roughly 0..1, which is what
`SIMILARITY_FLOOR` compares against.

Apply the floor in TypeScript after the query, not in a HAVING clause —
filtering in SQL before the ORDER BY changes which index path is chosen.

```ts
const floor = Number(process.env.SIMILARITY_FLOOR ?? 0.55);
const kept = rows.filter((r) => r.score >= floor);
```

## Checklist before committing a query change

- [ ] Membership join present, keyed on `userId`
- [ ] `workspaceId` in the WHERE clause
- [ ] ORDER BY uses the bare `<=>` operator
- [ ] Embedding passed as a parameter, cast with `::vector`
- [ ] `limit` comes from `RETRIEVE_TOP_K`, not a literal
- [ ] Floor applied in TypeScript, from env

## Verifying the index is actually used

```bash
docker compose exec db psql -U documind -d documind
```

```sql
EXPLAIN ANALYZE
SELECT id FROM "Chunk"
ORDER BY embedding <=> '[0.1,0.2, ...]'::vector
LIMIT 3;
```

Look for `Index Scan using chunk_embedding_hnsw`. A `Seq Scan` means the
ORDER BY form is wrong.

## Known tradeoff worth stating in the README

HNSW is approximate. Combined with a restrictive permission filter, recall
can drop because the index walks a graph that ignores the WHERE clause.
With a small corpus this is invisible. At scale the fix is raising
`hnsw.ef_search` or pre-filtering into a CTE. Mention the tradeoff; do not
build the fix for this project.
