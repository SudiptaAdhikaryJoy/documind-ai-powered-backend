import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createHash, randomUUID } from 'crypto';

export interface PresignedUrlResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

export interface PresignedUrlOptions {
  userId: string;
  filename?: string;
  contentType?: string;
  expiresIn?: number;
}

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);

  private readonly endpointUrl: string;
  private readonly accountId: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly bucketName: string;
  private readonly publicUrl: string;
  private readonly webhookSecret: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.endpointUrl = (this.config.get<string>('STORAGE_ENDPOINT') || this.config.get<string>('S3_ENDPOINT') || '').trim();
    this.accountId = this.config.get<string>('R2_ACCOUNT_ID', '').trim();
    this.accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID', '').trim();
    this.secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY', '').trim();
    this.bucketName = this.config.get<string>('R2_BUCKET_NAME', 'avatars').trim();
    this.region = this.config.get<string>('STORAGE_REGION', 'auto').trim();
    this.publicUrl = (
      this.config.get<string>('R2_PUBLIC_URL') ||
      (this.accountId ? `https://${this.bucketName}.${this.accountId}.r2.cloudflarestorage.com` : 'https://assets.documind.ai')
    ).replace(/\/+$/, '');
    this.webhookSecret = this.config.get<string>('R2_WEBHOOK_SECRET', '').trim();
  }

  isConfigured(): boolean {
    const hasEndpoint = Boolean(this.endpointUrl || this.accountId);
    return Boolean(hasEndpoint && this.accessKeyId && this.secretAccessKey && this.bucketName);
  }

  /**
   * Generates an AWS SigV4 presigned PUT URL for direct browser uploads to Cloudflare R2
   */
  async createPresignedUploadUrl(options: PresignedUrlOptions): Promise<PresignedUrlResult> {
    const { userId, filename, contentType = 'image/jpeg', expiresIn = 3600 } = options;

    const extension = this.extractExtension(filename, contentType);
    const uniqueId = randomUUID();
    const timestamp = Date.now();
    const key = `avatars/${userId}/${timestamp}-${uniqueId}${extension}`;

    const publicUrl = `${this.publicUrl}/${key}`;

    if (!this.isConfigured()) {
      this.logger.warn(
        'Cloudflare R2 is not fully configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY missing). Returning mock direct upload URL for development/testing.',
      );
      return {
        uploadUrl: `https://mock-r2.documind.local/${this.bucketName}/${key}?mock=presigned`,
        publicUrl,
        key,
        expiresIn,
      };
    }

    const { host, canonicalUri } = this.getTargetEndpoint(key);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
    };

    // Sort query parameters
    const sortedKeys = Object.keys(queryParams).sort();
    const canonicalQueryString = sortedKeys
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');

    // Build canonical headers
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';

    // Canonical request
    const payloadHash = 'UNSIGNED-PAYLOAD';
    const canonicalRequest = [
      'PUT',
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    // String to sign
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');

    // Calculate signature
    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const uploadUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

    return {
      uploadUrl,
      publicUrl,
      key,
      expiresIn,
    };
  }

  /**
   * Constructs the public asset URL from an object key
   */
  getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\/+/, '');
    return `${this.publicUrl}/${cleanKey}`;
  }

  /**
   * Deletes an object from Cloudflare R2
   */
  async deleteObject(key: string): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.debug(`R2 not configured; skipped deleteObject for key: ${key}`);
      return true;
    }

    try {
      const { host, canonicalUri } = this.getTargetEndpoint(key);

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.substring(0, 8);
      const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

      const headers: Record<string, string> = {
        host,
        'x-amz-date': amzDate,
      };

      const signedHeaders = 'host;x-amz-date';
      const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
      const payloadHash = this.sha256Hex('');

      const canonicalRequest = [
        'DELETE',
        canonicalUri,
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n');

      const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        this.sha256Hex(canonicalRequest),
      ].join('\n');

      const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3');
      const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

      const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(`https://${host}${canonicalUri}`, {
        method: 'DELETE',
        headers: {
          ...headers,
          Authorization: authorization,
        },
      });

      return res.ok || res.status === 404;
    } catch (err) {
      this.logger.warn(`Failed to delete object "${key}" from Cloudflare R2: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Validates webhook authentication secret if configured
   */
  verifyWebhookSecret(receivedSecret?: string): boolean {
    if (!this.webhookSecret) {
      return true; // No secret configured, allow through
    }
    return Boolean(receivedSecret && receivedSecret.trim() === this.webhookSecret);
  }

  /**
   * Parses incoming Cloudflare R2 webhook notification
   * Handles various Cloudflare Event Notification shapes
   */
  parseWebhookNotification(payload: Record<string, unknown>): { userId: string; key: string; publicUrl: string } | null {
    let rawKey = '';

    if (typeof payload?.key === 'string') {
      rawKey = payload.key;
    } else if (
      typeof payload?.object === 'object' &&
      payload.object !== null &&
      'key' in payload.object &&
      typeof (payload.object as { key: unknown }).key === 'string'
    ) {
      rawKey = (payload.object as { key: string }).key;
    } else if (Array.isArray(payload?.events) && payload.events.length > 0) {
      const first = payload.events[0];
      if (typeof first?.object?.key === 'string') {
        rawKey = first.object.key;
      }
    } else if (Array.isArray(payload?.Records) && payload.Records.length > 0) {
      // S3 compatible notification format
      const record = payload.Records[0];
      if (typeof record?.s3?.object?.key === 'string') {
        rawKey = record.s3.object.key;
      }
    }

    if (!rawKey) return null;

    // Pattern: avatars/<userId>/<filename>
    const match = rawKey.match(/^avatars\/([^/]+)\/(.+)$/);
    if (!match) return null;

    const userId = match[1];
    return {
      userId,
      key: rawKey,
      publicUrl: this.getPublicUrl(rawKey),
    };
  }

  private extractExtension(filename?: string, contentType?: string): string {
    if (filename && filename.includes('.')) {
      const ext = filename.split('.').pop()?.toLowerCase();
      if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        return `.${ext === 'jpeg' ? 'jpg' : ext}`;
      }
    }

    switch (contentType?.toLowerCase()) {
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'image/gif':
        return '.gif';
      case 'image/jpeg':
      default:
        return '.jpg';
    }
  }

  private sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private getTargetEndpoint(key: string): { host: string; canonicalUri: string } {
    if (this.endpointUrl) {
      const parsed = new URL(this.endpointUrl);
      const host = parsed.host;
      const basePath = parsed.pathname.replace(/\/+$/, '');
      const canonicalUri = `${basePath}/${this.bucketName}/${encodeURI(key)}`;
      return { host, canonicalUri };
    }
    const host = `${this.accountId}.r2.cloudflarestorage.com`;
    const canonicalUri = `/${this.bucketName}/${encodeURI(key)}`;
    return { host, canonicalUri };
  }

  private getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(regionName).digest();
    const kService = createHmac('sha256', kRegion).update(serviceName).digest();
    return createHmac('sha256', kService).update('aws4_request').digest();
  }
}
