import { Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

const RequiredLegalEntityIdSchema = z.object({
  legalEntityId: z.string().uuid('legalEntityId must be a valid UUID'),
});

const OptionalLegalEntityIdSchema = z.object({
  legalEntityId: z.string().uuid('legalEntityId must be a valid UUID').optional(),
});

/**
 * Validates that a required `legalEntityId` query/body parameter is present and a valid UUID.
 * Throws a `ZodError` (handled as HTTP 400 by `GlobalExceptionFilter`) when missing or malformed.
 */
@Injectable()
export class RequiredLegalEntityIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const normalized =
      typeof value === 'string' && value.trim() === '' ? undefined : value;
    return RequiredLegalEntityIdSchema.parse({ legalEntityId: normalized }).legalEntityId;
  }
}

/**
 * Validates that an optional `legalEntityId` query parameter, when provided, is a valid UUID.
 * Empty strings and nullish values are normalized to `undefined`.
 * Throws a `ZodError` (handled as HTTP 400 by `GlobalExceptionFilter`) when malformed.
 */
@Injectable()
export class OptionalLegalEntityIdPipe
  implements PipeTransform<unknown, string | undefined>
{
  transform(value: unknown): string | undefined {
    const normalized =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
        ? undefined
        : value;
    return OptionalLegalEntityIdSchema.parse({ legalEntityId: normalized }).legalEntityId;
  }
}
