import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFParse } from 'pdf-parse';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  type: 'pdf' | 'markdown' | 'text';
  pageCount: number;
  pages: ExtractedPage[];
}

@Injectable()
export class ExtractorService {
  private readonly logger = new Logger(ExtractorService.name);
  private readonly maxUploadBytes: number;
  private readonly allowedMimes: string[];

  constructor(private readonly config: ConfigService) {
    this.maxUploadBytes = parseInt(
      this.config.get<string>('UPLOAD_MAX_BYTES', '20971520'),
      10,
    );
    this.allowedMimes = this.config
      .get<string>(
        'UPLOAD_ALLOWED_MIME',
        'application/pdf,text/markdown,text/plain',
      )
      .split(',')
      .map((m) => m.trim().toLowerCase());
  }

  validateAndClassify(file: Express.Multer.File): 'pdf' | 'markdown' | 'text' {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }

    if (file.buffer.length > this.maxUploadBytes) {
      throw new BadRequestException(
        `File exceeds maximum allowed size of ${Math.round(
          this.maxUploadBytes / (1024 * 1024),
        )}MB`,
      );
    }

    // Inspect magic bytes for known binary signatures
    const detectedBinary = this.detectBinarySignature(file.buffer);

    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const declaredMime = (file.mimetype || '').toLowerCase();

    // If PDF
    if (ext === 'pdf' || declaredMime === 'application/pdf') {
      if (!this.isPdf(file.buffer)) {
        throw new BadRequestException(
          'Invalid PDF: file signature does not match PDF specifications (missing %PDF- header)',
        );
      }
      return 'pdf';
    }

    // If a binary format was detected (e.g. executable, zip, image)
    if (detectedBinary) {
      throw new BadRequestException(
        `Unsupported binary format: detected ${detectedBinary}`,
      );
    }

    // Check for null bytes which indicate non-text binary
    if (file.buffer.includes(0)) {
      throw new BadRequestException('Binary or non-UTF8 text detected');
    }

    if (ext === 'md' || declaredMime === 'text/markdown') {
      return 'markdown';
    }

    if (ext === 'txt' || declaredMime === 'text/plain') {
      return 'text';
    }

    // Fallback for markdown/text variants
    if (['text', 'markdown', 'txt', 'md'].includes(ext)) {
      return ext === 'md' ? 'markdown' : 'text';
    }

    throw new BadRequestException(
      `Unsupported file type .${ext}. Allowed types: PDF, Markdown, Plain Text`,
    );
  }

  private isPdf(buf: Buffer): boolean {
    // PDF spec: %PDF- must appear in the first 1024 bytes
    const slice = buf.subarray(0, 1024);
    return slice.includes(Buffer.from('%PDF-'));
  }

  private detectBinarySignature(buf: Buffer): string | null {
    if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
      return 'image/png';
    if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
      return 'image/jpeg';
    if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
      return 'application/zip';
    if (buf.subarray(0, 2).equals(Buffer.from([0x4d, 0x5a])))
      return 'application/x-msdownload';
    if (buf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
      return 'application/x-executable';
    return null;
  }

  async extract(
    buffer: Buffer,
    type: 'pdf' | 'markdown' | 'text',
  ): Promise<ExtractionResult> {
    switch (type) {
      case 'pdf':
        return this.extractPdf(buffer);
      case 'markdown':
        return this.extractMarkdown(buffer);
      case 'text':
      default:
        return this.extractPlainText(buffer);
    }
  }

  private async extractPdf(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      const pages: ExtractedPage[] = [];

      for (const p of result.pages) {
        const cleaned = this.cleanText(p.text || '');
        if (cleaned.length > 0) {
          pages.push({
            pageNumber: p.num,
            text: cleaned,
          });
        }
      }

      if (pages.length === 0) {
        throw new BadRequestException(
          'PDF contains no readable text or is scanned/image-only',
        );
      }

      return {
        type: 'pdf',
        pageCount: result.total || pages.length,
        pages,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Failed to extract text from PDF: ${msg}`, stack);
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Could not extract text from PDF: ${msg}`);
    }
  }

  private extractMarkdown(buffer: Buffer): ExtractionResult {
    const raw = buffer.toString('utf-8');
    const cleaned = this.cleanText(raw);

    if (cleaned.length === 0) {
      throw new BadRequestException('Uploaded markdown file is empty');
    }

    // In markdown, we treat the whole document as page 1 or split by level-1/level-2 headers
    return {
      type: 'markdown',
      pageCount: 1,
      pages: [{ pageNumber: 1, text: cleaned }],
    };
  }

  private extractPlainText(buffer: Buffer): ExtractionResult {
    const raw = buffer.toString('utf-8');
    const cleaned = this.cleanText(raw);

    if (cleaned.length === 0) {
      throw new BadRequestException('Uploaded text file is empty');
    }

    return {
      type: 'text',
      pageCount: 1,
      pages: [{ pageNumber: 1, text: cleaned }],
    };
  }

  private cleanText(text: string): string {
    return (
      text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '') // remove ASCII control characters
        .trim()
    );
  }
}
