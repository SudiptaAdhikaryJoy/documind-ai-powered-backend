import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { R2Service } from './r2.service';

describe('R2Service', () => {
  let service: R2Service;
  let mockConfig: Record<string, string>;

  beforeEach(async () => {
    mockConfig = {
      R2_ACCOUNT_ID: 'test-account-id',
      R2_ACCESS_KEY_ID: 'test-access-key',
      R2_SECRET_ACCESS_KEY: 'test-secret-key-1234567890',
      R2_BUCKET_NAME: 'test-bucket',
      R2_PUBLIC_URL: 'https://assets.test.com',
      R2_WEBHOOK_SECRET: 'super-secret',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        R2Service,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => mockConfig[key] ?? defaultValue ?? ''),
          },
        },
      ],
    }).compile();

    service = module.get<R2Service>(R2Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.isConfigured()).toBe(true);
  });

  describe('createPresignedUploadUrl', () => {
    it('should generate a valid AWS SigV4 presigned upload URL for Cloudflare R2', async () => {
      const result = await service.createPresignedUploadUrl({
        userId: 'user-123',
        filename: 'my-avatar.png',
        contentType: 'image/png',
        expiresIn: 1800,
      });

      expect(result).toBeDefined();
      expect(result.uploadUrl).toContain('https://test-account-id.r2.cloudflarestorage.com/test-bucket/avatars/user-123/');
      expect(result.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(result.uploadUrl).toContain('X-Amz-Credential=');
      expect(result.uploadUrl).toContain('X-Amz-Signature=');
      expect(result.uploadUrl).toContain('X-Amz-Expires=1800');
      expect(result.publicUrl).toMatch(/^https:\/\/assets\.test\.com\/avatars\/user-123\/.*\.png$/);
      expect(result.key).toMatch(/^avatars\/user-123\/.*\.png$/);
      expect(result.expiresIn).toBe(1800);
    });

    it('should return mock direct upload URL when R2 is not configured', async () => {
      mockConfig['R2_ACCOUNT_ID'] = '';

      const unconfiguredService = new R2Service({
        get: jest.fn((key: string, def?: string) => mockConfig[key] ?? def ?? ''),
      } as unknown as ConfigService);

      expect(unconfiguredService.isConfigured()).toBe(false);

      const result = await unconfiguredService.createPresignedUploadUrl({
        userId: 'user-456',
        contentType: 'image/jpeg',
      });

      expect(result.uploadUrl).toContain('mock-r2.documind.local');
      expect(result.key).toContain('avatars/user-456/');
    });
  });

  describe('getPublicUrl', () => {
    it('should construct public URL correctly', () => {
      const url = service.getPublicUrl('avatars/user-123/pic.jpg');
      expect(url).toBe('https://assets.test.com/avatars/user-123/pic.jpg');
    });
  });

  describe('verifyWebhookSecret', () => {
    it('should validate matching secret', () => {
      expect(service.verifyWebhookSecret('super-secret')).toBe(true);
      expect(service.verifyWebhookSecret('wrong-secret')).toBe(false);
      expect(service.verifyWebhookSecret(undefined)).toBe(false);
    });
  });

  describe('parseWebhookNotification', () => {
    it('should parse direct object key payload', () => {
      const parsed = service.parseWebhookNotification({
        object: { key: 'avatars/user-abc/photo.jpg' },
      });

      expect(parsed).toEqual({
        userId: 'user-abc',
        key: 'avatars/user-abc/photo.jpg',
        publicUrl: 'https://assets.test.com/avatars/user-abc/photo.jpg',
      });
    });

    it('should parse Cloudflare events array payload', () => {
      const parsed = service.parseWebhookNotification({
        events: [{ action: 'PutObject', object: { key: 'avatars/user-xyz/photo.png' } }],
      });

      expect(parsed).toEqual({
        userId: 'user-xyz',
        key: 'avatars/user-xyz/photo.png',
        publicUrl: 'https://assets.test.com/avatars/user-xyz/photo.png',
      });
    });

    it('should return null for non-avatar keys', () => {
      const parsed = service.parseWebhookNotification({
        object: { key: 'documents/workspace-1/file.pdf' },
      });
      expect(parsed).toBeNull();
    });
  });
});
