import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Document Ingestion Pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;
  let intruderToken: string;
  let workspaceId: string;
  let otherWorkspaceId: string;

  const testRunId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Register User A (Owner)
    const ownerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `doc_owner_${testRunId}@documind.test`,
        phone: `0191${testRunId.toString().slice(-7)}`,
        password: 'Password123!',
        name: 'Document Owner',
        workspaceName: 'Engineering Workspace',
      })
      .expect(HttpStatus.CREATED);

    ownerToken = ownerRes.body.accessToken || ownerRes.body.data.accessToken;

    // Fetch User A's workspace
    const wsRes = await request(app.getHttpServer())
      .get('/workspaces/list')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    const wsListA = Array.isArray(wsRes.body) ? wsRes.body : wsRes.body.data;
    workspaceId = wsListA[0].id;

    // Register User B (Intruder)
    const intruderRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `doc_intruder_${testRunId}@documind.test`,
        phone: `0192${testRunId.toString().slice(-7)}`,
        password: 'Password123!',
        name: 'Intruder User',
        workspaceName: 'Intruder Workspace',
      })
      .expect(HttpStatus.CREATED);

    intruderToken =
      intruderRes.body.accessToken || intruderRes.body.data.accessToken;

    const otherWsRes = await request(app.getHttpServer())
      .get('/workspaces/list')
      .set('Authorization', `Bearer ${intruderToken}`)
      .expect(HttpStatus.OK);

    const wsListB = Array.isArray(otherWsRes.body)
      ? otherWsRes.body
      : otherWsRes.body.data;
    otherWorkspaceId = wsListB[0].id;
  });

  afterAll(async () => {
    // Cleanup created test data
    if (workspaceId) {
      await prisma.document.deleteMany({ where: { workspaceId } });
      await prisma.membership.deleteMany({ where: { workspaceId } });
      await prisma.workspace
        .delete({ where: { id: workspaceId } })
        .catch(() => null);
    }
    if (otherWorkspaceId) {
      await prisma.document.deleteMany({
        where: { workspaceId: otherWorkspaceId },
      });
      await prisma.membership.deleteMany({
        where: { workspaceId: otherWorkspaceId },
      });
      await prisma.workspace
        .delete({ where: { id: otherWorkspaceId } })
        .catch(() => null);
    }
    await app.close();
  });

  describe('Multi-tenant Isolation', () => {
    it('should reject access (403) when User B accesses User A workspace documents', async () => {
      await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(HttpStatus.FORBIDDEN);
    });

    it('should reject document upload (403) when User B tries uploading to User A workspace', async () => {
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/documents/upload`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .attach(
          'file',
          Buffer.from('# Architecture\nSystem design doc'),
          'arch.md',
        )
        .expect(HttpStatus.FORBIDDEN);
    });
  });

  describe('Validation & Security', () => {
    it('should reject empty file upload (400)', async () => {
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/documents/upload`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from(''), 'empty.txt')
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should reject disguised fake PDF (magic bytes mismatch)', async () => {
      const fakePdfBuffer = Buffer.from(
        'This is definitely not a real PDF file header',
      );
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/documents/upload`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', fakePdfBuffer, 'fake.pdf')
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.message).toContain('PDF');
    });
  });

  describe('Document Upload and Ingestion Flow', () => {
    let uploadedDocId: string;

    it('should upload a markdown document and return 202 ACCEPTED', async () => {
      const mdContent = `
# System Architecture

DocuMind is an evidence-first Q&A system over internal documentation.

## Database Layer
PostgreSQL 17 with pgvector extension is used for relational data and embeddings.

## Vector Dimensions
The nomic-embed-text model generates 768-dimensional dense vectors.
`;
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/documents/upload`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from(mdContent), 'architecture.md')
        .expect(HttpStatus.ACCEPTED);

      expect(res.body).toHaveProperty('documentId');
      expect(res.body).toHaveProperty('versionId');
      expect(res.body.title).toBe('architecture.md');
      expect(res.body.chunkCount).toBeGreaterThan(0);

      uploadedDocId = res.body.documentId;
    });

    it('should list documents with chunk and version metrics', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(HttpStatus.OK);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      const found = res.body.find((d: any) => d.id === uploadedDocId);
      expect(found).toBeDefined();
      expect(found.title).toBe('architecture.md');
    });

    it('should get document detail by ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/documents/${uploadedDocId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(HttpStatus.OK);

      expect(res.body.id).toBe(uploadedDocId);
      expect(res.body.title).toBe('architecture.md');
      expect(res.body.versions.length).toBeGreaterThan(0);
    });

    it('should detect duplicate file upload and avoid redundant chunks', async () => {
      const mdContent = `
# System Architecture

DocuMind is an evidence-first Q&A system over internal documentation.

## Database Layer
PostgreSQL 17 with pgvector extension is used for relational data and embeddings.

## Vector Dimensions
The nomic-embed-text model generates 768-dimensional dense vectors.
`;
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/documents/upload`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from(mdContent), 'architecture.md')
        .expect(HttpStatus.ACCEPTED);

      expect(res.body.message).toContain('already exists');
    });

    it('should wait for background worker to embed chunks and transition to READY', async () => {
      // Poll document status until READY (timeout 15s)
      let status = 'PENDING';
      const startTime = Date.now();

      while (status !== 'READY' && Date.now() - startTime < 15000) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const res = await request(app.getHttpServer())
          .get(`/workspaces/${workspaceId}/documents/${uploadedDocId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        status = res.body.status;
      }

      expect(status).toBe('READY');

      // Verify that pgvector embeddings are populated in the database
      const chunks = await prisma.$queryRawUnsafe<
        Array<{ id: string; has_vec: boolean }>
      >(
        `SELECT "id", ("embedding" IS NOT NULL) AS has_vec FROM "Chunk" WHERE "versionId" IN (
          SELECT "id" FROM "Version" WHERE "documentId" = $1
        )`,
        uploadedDocId,
      );

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.has_vec).toBe(true);
      }
    }, 20000);

    it('should upload a multi-page PDF and preserve page numbers for citations', async () => {
      const validPdfString = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /Resources <<>> /MediaBox [0 0 612 792] /Contents 5 0 R>> endobj
4 0 obj <</Type /Page /Parent 2 0 R /Resources <<>> /MediaBox [0 0 612 792] /Contents 6 0 R>> endobj
5 0 obj <</Length 44>> stream
BT /F1 12 Tf 100 700 Td (Page 1 Technical Architecture) Tj ET
endstream endobj
6 0 obj <</Length 44>> stream
BT /F1 12 Tf 100 700 Td (Page 2 Operational Failover) Tj ET
endstream endobj
xref
0 7
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000127 00000 n 
0000000236 00000 n 
0000000345 00000 n 
0000000439 00000 n 
trailer <</Size 7 /Root 1 0 R>>
startxref
533
%%EOF`;

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/documents/upload`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from(validPdfString), 'architecture_spec.pdf')
        .expect(HttpStatus.ACCEPTED);

      expect(res.body.pageCount).toBe(2);
      expect(res.body.title).toBe('architecture_spec.pdf');

      // Verify chunks have pages 1 and 2
      const pdfChunks = await prisma.chunk.findMany({
        where: { versionId: res.body.versionId },
        orderBy: { ordinal: 'asc' },
      });

      expect(pdfChunks.length).toBeGreaterThanOrEqual(2);
      const pages = pdfChunks.map((c) => c.page);
      expect(pages).toContain(1);
      expect(pages).toContain(2);
    });

    it('should delete document and cascade delete versions and chunks', async () => {
      const delRes = await request(app.getHttpServer())
        .delete(`/workspaces/${workspaceId}/documents/${uploadedDocId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(HttpStatus.OK);

      expect(delRes.body.success).toBe(true);

      // Verify 404 on subsequent get
      await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/documents/${uploadedDocId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(HttpStatus.NOT_FOUND);
    });
  });
});
