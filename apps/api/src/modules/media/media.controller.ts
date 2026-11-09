import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { z } from 'zod';

const UploadBase64Schema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  base64Data: z.string().min(1),
  entityType: z.string().max(50).optional(),
  entityId: z.string().uuid().optional(),
  isPrimary: z.boolean().optional(),
});

const ReplaceBase64Schema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  base64Data: z.string().min(1),
});

@Controller('api/v1/media')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Upload media file (supports both Multipart and Base64 JSON payload)
   */
  @Post('upload')
  @RequirePermissions('media.upload')
  async upload(
    @CurrentContext() context: TenantContext,
    @Req() request: any,
    @Body() body: unknown
  ) {
    if (request.isMultipart && request.isMultipart()) {
      const data = await request.file();
      if (!data) {
        throw new BadRequestException('No file uploaded via multipart');
      }

      const buffer = await data.toBuffer();
      const entityType = data.fields?.entityType?.value;
      const entityId = data.fields?.entityId?.value;
      const isPrimary = data.fields?.isPrimary?.value === 'true';

      const record = await this.mediaService.uploadFile(context, {
        originalName: data.filename,
        mimeType: data.mimetype,
        buffer,
        entityType,
        entityId,
        isPrimary,
      });

      return { success: true, data: record };
    }

    // Otherwise JSON Base64 upload (useful for camera captures and testing)
    const validated = UploadBase64Schema.parse(body);
    const cleanBase64 = validated.base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const record = await this.mediaService.uploadFile(context, {
      originalName: validated.originalName,
      mimeType: validated.mimeType,
      buffer,
      entityType: validated.entityType,
      entityId: validated.entityId,
      isPrimary: validated.isPrimary,
    });

    return { success: true, data: record };
  }

  /**
   * Replace an existing media file
   */
  @Post('replace/:id')
  @RequirePermissions('media.replace')
  async replace(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Req() request: any,
    @Body() body: unknown
  ) {
    if (request.isMultipart && request.isMultipart()) {
      const data = await request.file();
      if (!data) {
        throw new BadRequestException('No file uploaded for replacement');
      }
      const buffer = await data.toBuffer();
      const updated = await this.mediaService.replaceMedia(context, id, {
        originalName: data.filename,
        mimeType: data.mimetype,
        buffer,
      });
      return { success: true, data: updated };
    }

    const validated = ReplaceBase64Schema.parse(body);
    const cleanBase64 = validated.base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const updated = await this.mediaService.replaceMedia(context, id, {
      originalName: validated.originalName,
      mimeType: validated.mimeType,
      buffer,
    });

    return { success: true, data: updated };
  }

  /**
   * Securely stream file content with strict tenant authorization
   */
  @Get('file/:id')
  @RequirePermissions('media.view')
  async getFile(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Res() reply: any
  ) {
    const { record, buffer } = await this.mediaService.getFile(context, id);
    reply
      .header('Content-Type', record.mimeType)
      .header('Content-Length', record.fileSize)
      .header('Cache-Control', 'private, max-age=86400')
      .send(buffer);
  }

  /**
   * List all media files attached to a specific entity
   */
  @Get('entity/:type/:id')
  @RequirePermissions('media.view')
  async listEntityMedia(
    @CurrentContext() context: TenantContext,
    @Param('type') type: string,
    @Param('id') id: string
  ) {
    const data = await this.mediaService.listEntityMedia(context, type, id);
    return { success: true, data };
  }

  /**
   * Delete media file
   */
  @Delete(':id')
  @RequirePermissions('media.delete')
  async deleteMedia(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const result = await this.mediaService.deleteMedia(context, id);
    return { success: true, data: result };
  }

  /**
   * Trigger cleanup of temporary orphan uploads
   */
  @Post('cleanup-orphans')
  @RequirePermissions('media.delete')
  async cleanupOrphans(@CurrentContext() context: TenantContext) {
    const result = await this.mediaService.cleanupOrphans(context);
    return { success: true, data: result };
  }
}
