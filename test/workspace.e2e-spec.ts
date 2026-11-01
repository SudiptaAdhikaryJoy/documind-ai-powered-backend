/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Workspace Security & Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let userAToken: string;
  let userAId: string;
  let workspaceAId: string;

  let userBToken: string;
  let userBId: string;
  let workspaceBId: string;

  const testSuffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Register User A (OWNER of Workspace A)
    const resA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `usera_${testSuffix}@company.com`,
        phone: `0171${testSuffix}01`,
        password: 'Password123!',
        name: 'User A',
        workspaceName: `Workspace A ${testSuffix}`,
      })
      .expect(201);

    userAToken = resA.body.data.accessToken;
    userAId = resA.body.data.id;

    // Get Workspace A id
    const wsListA = await request(app.getHttpServer())
      .get('/workspaces/list')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);

    const listA = Array.isArray(wsListA.body)
      ? wsListA.body
      : wsListA.body.data;
    expect(listA.length).toBeGreaterThanOrEqual(1);
    workspaceAId = listA[0].id;

    // Register User B (OWNER of Workspace B)
    const resB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `userb_${testSuffix}@company.com`,
        phone: `0171${testSuffix}02`,
        password: 'Password123!',
        name: 'User B',
        workspaceName: `Workspace B ${testSuffix}`,
      })
      .expect(201);

    userBToken = resB.body.data.accessToken;
    userBId = resB.body.data.id;

    // Get Workspace B id
    const wsListB = await request(app.getHttpServer())
      .get('/workspaces/list')
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(200);

    const listB = Array.isArray(wsListB.body)
      ? wsListB.body
      : wsListB.body.data;
    expect(listB.length).toBeGreaterThanOrEqual(1);
    workspaceBId = listB[0].id;
  });

  afterAll(async () => {
    // Cleanup created test records
    await prisma.membership.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceAId, workspaceBId] } },
    });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } },
    });
    await app.close();
  });

  describe('WorkspaceGuard & Isolation Boundary', () => {
    it('member of workspace A gets 403 Forbidden on workspace B', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceBId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(403);

      expect(res.body.message).toContain('Workspace access denied');
    });

    it('member of workspace B gets 403 Forbidden on workspace A', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);

      expect(res.body.message).toContain('Workspace access denied');
    });

    it('member of workspace A gets 200 OK on workspace A', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      const d = res.body?.data || res.body;
      expect(d.id).toBe(workspaceAId);
      expect(d.role).toBe('OWNER');
      expect(d.memberCount).toBe(1);
    });

    it('member gets 200 OK when passing raw token without Bearer prefix', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceAId}`)
        .set('Authorization', userAToken)
        .expect(200);

      const d = res.body?.data || res.body;
      expect(d.id).toBe(workspaceAId);
    });

    it('member gets 200 OK when Swagger formats as Bearer Bearer <token>', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer Bearer ${userAToken}`)
        .expect(200);

      const d = res.body?.data || res.body;
      expect(d.id).toBe(workspaceAId);
    });
  });

  describe('Workspace Endpoints & Roles', () => {
    it('GET /workspaces/list lists user workspaces with role', async () => {
      const res = await request(app.getHttpServer())
        .get('/workspaces/list')
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      const list = Array.isArray(res.body) ? res.body : res.body.data;
      expect(Array.isArray(list)).toBe(true);
      const found = list.find((w: any) => w.id === workspaceAId);
      expect(found).toBeDefined();
      expect(found.role).toBe('OWNER');
    });

    it('POST /workspaces/create creates a new workspace and sets creator as OWNER', async () => {
      const res = await request(app.getHttpServer())
        .post('/workspaces/create')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: `Secondary Workspace ${testSuffix}` })
        .expect(201);

      const d = res.body?.data || res.body;
      expect(d.name).toBe(`Secondary Workspace ${testSuffix}`);
      expect(d.role).toBe('OWNER');

      // Cleanup
      await prisma.membership.deleteMany({
        where: { workspaceId: d.id },
      });
      await prisma.workspace.delete({ where: { id: d.id } });
    });

    it('GET /workspaces/:workspaceId/members lists members', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceAId}/members`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      const members = Array.isArray(res.body) ? res.body : res.body.data;
      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBe(1);
      expect(members[0].userId).toBe(userAId);
      expect(members[0].role).toBe('OWNER');
    });

    it('POST /workspaces/:workspaceId/members/invite invites User B to Workspace A', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceAId}/members/invite`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          email: `userb_${testSuffix}@company.com`,
          role: 'MEMBER',
        })
        .expect(201);

      const d = res.body?.data || res.body;
      expect(d.userId).toBe(userBId);
      expect(d.role).toBe('MEMBER');

      // Now User B should have access to Workspace A with role MEMBER
      const accessRes = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(200);

      const accessD = accessRes.body?.data || accessRes.body;
      expect(accessD.role).toBe('MEMBER');
    });

    it('non-owner (MEMBER) gets 403 Forbidden when attempting to invite', async () => {
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceAId}/members/invite`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          email: `unknown@company.com`,
          role: 'VIEWER',
        })
        .expect(403);
    });

    it('PATCH /workspaces/:workspaceId/members/:userId updates member role', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/workspaces/${workspaceAId}/members/${userBId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ role: 'VIEWER' })
        .expect(200);

      const d = res.body?.data || res.body;
      expect(d.role).toBe('VIEWER');

      // Verify User B now has VIEWER role
      const accessRes = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(200);

      const accessD = accessRes.body?.data || accessRes.body;
      expect(accessD.role).toBe('VIEWER');
    });

    it('cannot demote sole OWNER', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/workspaces/${workspaceAId}/members/${userAId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ role: 'MEMBER' })
        .expect(400);

      expect(res.body.message).toContain(
        'Cannot demote the sole workspace owner',
      );
    });
  });

  describe('Health Check Endpoint', () => {
    it('GET /health checks database and model provider', async () => {
      await request(app.getHttpServer())
        .get('/health')
        .expect((response) => {
          // Status can be 200 (if Ollama/model is up) or 503 (if Ollama is down locally),
          // but database must report 'up' either way.
          expect([200, 503]).toContain(response.status);
          expect(response.body).toHaveProperty('info');
          expect(response.body.info).toHaveProperty('database');
          expect(response.body.info.database.status).toBe('up');
        });
    });
  });
});
