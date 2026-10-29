import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExtractedPage } from './extractor.service';

export interface DocumentChunk {
  ordinal: number;
  page: number;
  heading: string | null;
  content: string;
  tokens: number;
}

@Injectable()
export class ChunkerService {
  private readonly chunkChars: number;
  private readonly chunkOverlap: number;

  constructor(private readonly config: ConfigService) {
    this.chunkChars = parseInt(
      this.config.get<string>('CHUNK_CHARS', '600'),
      10,
    );
    this.chunkOverlap = parseInt(
      this.config.get<string>('CHUNK_OVERLAP', '90'),
      10,
    );
  }

  chunkPages(documentTitle: string, pages: ExtractedPage[]): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let ordinal = 0;

    for (const page of pages) {
      const pageChunks = this.chunkPageText(page.text, page.pageNumber);

      for (const c of pageChunks) {
        chunks.push({
          ...c,
          ordinal: ordinal++,
        });
      }
    }

    return chunks;
  }

  private chunkPageText(
    text: string,
    pageNumber: number,
  ): Array<Omit<DocumentChunk, 'ordinal'>> {
    const pageChunks: Array<Omit<DocumentChunk, 'ordinal'>> = [];
    const paragraphs = text.split(/\n\s*\n/);

    let currentHeading: string | null = null;
    let currentBuffer = '';

    const headingRegex = /^(#{1,6}\s+.*|[A-Z0-9\s_-]{3,40}:)$/;

    for (const paragraph of paragraphs) {
      const trimmedPara = paragraph.trim();
      if (!trimmedPara) continue;

      // Detect heading
      const firstLine = trimmedPara.split('\n')[0].trim();
      if (headingRegex.test(firstLine)) {
        currentHeading = firstLine.replace(/^#{1,6}\s+/, '').trim();
      }

      // If paragraph fits into current buffer
      if (currentBuffer.length + trimmedPara.length + 2 <= this.chunkChars) {
        currentBuffer = currentBuffer
          ? `${currentBuffer}\n\n${trimmedPara}`
          : trimmedPara;
      } else {
        // Current buffer is ready to be flushed
        if (currentBuffer) {
          pageChunks.push({
            page: pageNumber,
            heading: currentHeading,
            content: currentBuffer,
            tokens: Math.ceil(currentBuffer.length / 4),
          });

          // Carry over overlap from the end of currentBuffer
          const overlapText = this.getOverlapTail(
            currentBuffer,
            this.chunkOverlap,
          );
          currentBuffer = overlapText
            ? `${overlapText}\n\n${trimmedPara}`
            : trimmedPara;
        } else {
          // If a single paragraph is larger than chunkChars, split it by sentences/length
          const subChunks = this.splitLongText(
            trimmedPara,
            this.chunkChars,
            this.chunkOverlap,
          );
          for (let i = 0; i < subChunks.length; i++) {
            pageChunks.push({
              page: pageNumber,
              heading: currentHeading,
              content: subChunks[i],
              tokens: Math.ceil(subChunks[i].length / 4),
            });
          }
          currentBuffer = '';
        }
      }
    }

    // Flush any remaining buffer
    if (currentBuffer.trim()) {
      pageChunks.push({
        page: pageNumber,
        heading: currentHeading,
        content: currentBuffer.trim(),
        tokens: Math.ceil(currentBuffer.trim().length / 4),
      });
    }

    return pageChunks;
  }

  private getOverlapTail(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) return '';
    const slice = text.slice(text.length - overlapSize);
    // Try to break at a word boundary
    const spaceIndex = slice.indexOf(' ');
    if (spaceIndex !== -1 && spaceIndex < slice.length - 10) {
      return slice.slice(spaceIndex + 1).trim();
    }
    return slice.trim();
  }

  private splitLongText(
    text: string,
    chunkSize: number,
    overlapSize: number,
  ): string[] {
    const result: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + chunkSize;
      if (end >= text.length) {
        result.push(text.slice(start).trim());
        break;
      }

      // Try finding nearest period, newline or space to cut cleanly
      const periodPos = text.lastIndexOf('. ', end);
      if (periodPos > start + chunkSize / 2) {
        end = periodPos + 1;
      } else {
        const spacePos = text.lastIndexOf(' ', end);
        if (spacePos > start + chunkSize / 2) {
          end = spacePos;
        }
      }

      const chunk = text.slice(start, end).trim();
      if (chunk) {
        result.push(chunk);
      }

      start = Math.max(start + 1, end - overlapSize);
    }

    return result;
  }
}
