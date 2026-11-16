import { SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'require_idempotency_key';

/**
 * Marks a sensitive financial/operational mutation endpoint as requiring an Idempotency-Key.
 * In strict mode (`STRICT_IDEMPOTENCY=true` or `x-idempotency-mode: strict`), missing keys are rejected with 400.
 * Otherwise, a clear `X-Idempotency-Warning: missing-key` header is emitted alongside DB unique constraints.
 */
export const RequireIdempotencyKey = () => SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);
