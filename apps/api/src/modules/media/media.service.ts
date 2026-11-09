import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { mediaFiles } from '@restaurant-cloud/database';
import { eq, and, isNull, lt } from 'drizzle-orm';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
]);

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class MediaService {
  private readonly uploadBaseDir = path.resolve(process.cwd(), 'uploads');

  constructor(private readonly dbService: DatabaseService) {
    if (!fs.existsSync(this.uploadBaseDir)) {
      fs.mkdirSync(this.uploadBaseDir, { recursive: true });
    }
  }

  /**
   * Validate file buffer and metadata
   */
  validateFile(originalName: string, mimeType: string, buffer: Buffer): { ext: string } {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Empty file buffer provided');
    }

    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(`File size exceeds maximum allowed size of 5MB (got ${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`);
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(`Unsupported media type: ${mimeType}. Allowed types: JPEG, PNG, WEBP, GIF, SVG, PDF`);
    }

    const rawExt = path.extname(originalName).toLowerCase();
    if (!rawExt || !EXT_TO_MIME[rawExt]) {
      throw new BadRequestException(`Invalid or disallowed file extension: ${rawExt}`);
    }

    // Check extension vs mime consistency
    if (EXT_TO_MIME[rawExt] !== mimeType && !(rawExt === '.jpg' && mimeType === 'image/jpeg')) {
      throw new BadRequestException(`File extension '${rawExt}' does not match declared MIME type '${mimeType}'`);
    }

    // Magic bytes verification
    if (mimeType === 'image/jpeg') {
      if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new BadRequestException('File contents do not match valid JPEG signature');
      }
    } else if (mimeType === 'image/png') {
      if (
        buffer.length < 8 ||
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        throw new BadRequestException('File contents do not match valid PNG signature');
      }
    } else if (mimeType === 'image/gif') {
      const header = buffer.subarray(0, 6).toString('ascii');
      if (header !== 'GIF87a' && header !== 'GIF89a') {
        throw new BadRequestException('File contents do not match valid GIF signature');
      }
    } else if (mimeType === 'application/pdf') {
      const header = buffer.subarray(0, 5).toString('ascii');
      if (!header.startsWith('%PDF-')) {
        throw new BadRequestException('File contents do not match valid PDF signature');
      }
    }

    return { ext: rawExt };
  }

  /**
   * Save uploaded file to tenant-isolated disk storage and insert DB record
   */
  async uploadFile(
    context: TenantContext,
    params: {
      originalName: string;
      mimeType: string;
      buffer: Buffer;
      entityType?: string;
      entityId?: string;
      isPrimary?: boolean;
    }
  ) {
    const { ext } = this.validateFile(params.originalName, params.mimeType, params.buffer);

    const fileId = crypto.randomUUID();
    const entityType = params.entityType ? params.entityType.toLowerCase().replace(/[^a-z0-9_-]/g, '') : 'temporary';
    const entityId = params.entityId || fileId;
    const tenantDir = path.join(this.uploadBaseDir, context.tenantId, entityType);

    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const safeFileName = `${fileId}${ext}`;
    const storagePath = path.join(tenantDir, safeFileName);

    // Save to disk atomically
    fs.writeFileSync(storagePath, params.buffer);

    const publicUrl = `/api/v1/media/file/${fileId}`;

    return await this.dbService.withTenantContext(context, async (tx) => {
      // If this file is set as primary and entityId is provided, reset existing primary files
      if (params.isPrimary && params.entityId) {
        await tx
          .update(mediaFiles)
          .set({ isPrimary: false })
          .where(
            and(
              eq(mediaFiles.tenantId, context.tenantId),
              eq(mediaFiles.entityId, params.entityId)
            )
          );
      }

      const [record] = await tx
        .insert(mediaFiles)
        .values({
          id: fileId,
          tenantId: context.tenantId,
          entityType,
          entityId,
          fileName: safeFileName,
          originalName: params.originalName,
          mimeType: params.mimeType,
          fileSize: params.buffer.length,
          storagePath,
          publicUrl,
          isPrimary: params.isPrimary ?? false,
        })
        .returning();

      return record;
    });
  }

  /**
   * Retrieve file record and stream buffer with strict tenant verification
   */
  async getFile(context: TenantContext, mediaId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [record] = await tx
        .select()
        .from(mediaFiles)
        .where(
          and(
            eq(mediaFiles.id, mediaId),
            eq(mediaFiles.tenantId, context.tenantId)
          )
        )
        .limit(1);

      if (!record) {
        throw new NotFoundException(`Media file '${mediaId}' not found or access denied`);
      }

      if (!fs.existsSync(record.storagePath)) {
        throw new NotFoundException(`Media file storage content missing on server`);
      }

      const buffer = fs.readFileSync(record.storagePath);
      return { record, buffer };
    });
  }

  /**
   * List media files for an entity
   */
  async listEntityMedia(context: TenantContext, entityType: string, entityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(mediaFiles)
        .where(
          and(
            eq(mediaFiles.tenantId, context.tenantId),
            eq(mediaFiles.entityType, entityType),
            eq(mediaFiles.entityId, entityId)
          )
        );
    });
  }

  /**
   * Delete media file and unlink disk storage
   */
  async deleteMedia(context: TenantContext, mediaId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [record] = await tx
        .select()
        .from(mediaFiles)
        .where(
          and(
            eq(mediaFiles.id, mediaId),
            eq(mediaFiles.tenantId, context.tenantId)
          )
        )
        .limit(1);

      if (!record) {
        throw new NotFoundException(`Media file '${mediaId}' not found or access denied`);
      }

      // Unlink file from disk if present
      if (fs.existsSync(record.storagePath)) {
        try {
          fs.unlinkSync(record.storagePath);
        } catch {
          // Continue if file already removed from disk
        }
      }

      await tx
        .delete(mediaFiles)
        .where(
          and(
            eq(mediaFiles.id, mediaId),
            eq(mediaFiles.tenantId, context.tenantId)
          )
        );

      return { success: true, deletedId: mediaId };
    });
  }

  /**
   * Replace existing media file with a new file
   */
  async replaceMedia(
    context: TenantContext,
    mediaId: string,
    params: {
      originalName: string;
      mimeType: string;
      buffer: Buffer;
    }
  ) {
    const { ext } = this.validateFile(params.originalName, params.mimeType, params.buffer);

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [record] = await tx
        .select()
        .from(mediaFiles)
        .where(
          and(
            eq(mediaFiles.id, mediaId),
            eq(mediaFiles.tenantId, context.tenantId)
          )
        )
        .limit(1);

      if (!record) {
        throw new NotFoundException(`Media file '${mediaId}' not found or access denied`);
      }

      // Unlink old file
      if (fs.existsSync(record.storagePath)) {
        try {
          fs.unlinkSync(record.storagePath);
        } catch {}
      }

      const entityType = record.entityType || 'general';
      const tenantDir = path.join(this.uploadBaseDir, context.tenantId, entityType);
      if (!fs.existsSync(tenantDir)) {
        fs.mkdirSync(tenantDir, { recursive: true });
      }

      const newFileName = `${mediaId}${ext}`;
      const newStoragePath = path.join(tenantDir, newFileName);
      fs.writeFileSync(newStoragePath, params.buffer);

      const [updated] = await tx
        .update(mediaFiles)
        .set({
          fileName: newFileName,
          originalName: params.originalName,
          mimeType: params.mimeType,
          fileSize: params.buffer.length,
          storagePath: newStoragePath,
        })
        .where(
          and(
            eq(mediaFiles.id, mediaId),
            eq(mediaFiles.tenantId, context.tenantId)
          )
        )
        .returning();

      return updated;
    });
  }

  /**
   * Attach pre-uploaded media files to an entity
   */
  async attachMedia(
    context: TenantContext,
    params: {
      entityType: string;
      entityId: string;
      mediaFileIds: string[];
      primaryMediaId?: string;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      for (const fileId of params.mediaFileIds) {
        const isPrimary = params.primaryMediaId ? fileId === params.primaryMediaId : false;
        await tx
          .update(mediaFiles)
          .set({
            entityType: params.entityType,
            entityId: params.entityId,
            isPrimary,
          })
          .where(
            and(
              eq(mediaFiles.id, fileId),
              eq(mediaFiles.tenantId, context.tenantId)
            )
          );
      }
      return { success: true };
    });
  }

  /**
   * Clean up unattached temporary media (orphan cleanup)
   */
  async cleanupOrphans(context: TenantContext, olderThanMinutes: number = 60) {
    const threshold = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    return await this.dbService.withTenantContext(context, async (tx) => {
      const orphans = await tx
        .select()
        .from(mediaFiles)
        .where(
          and(
            eq(mediaFiles.tenantId, context.tenantId),
            eq(mediaFiles.entityType, 'temporary'),
            lt(mediaFiles.createdAt, threshold)
          )
        );

      for (const orphan of orphans) {
        if (fs.existsSync(orphan.storagePath)) {
          try {
            fs.unlinkSync(orphan.storagePath);
          } catch {}
        }
        await tx
          .delete(mediaFiles)
          .where(
            and(
              eq(mediaFiles.id, orphan.id),
              eq(mediaFiles.tenantId, context.tenantId)
            )
          );
      }

      return { cleanedCount: orphans.length };
    });
  }
}
