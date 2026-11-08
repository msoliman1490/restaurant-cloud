export enum SystemErrorCode {
  // Authentication & Scopes
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  TENANT_SCOPE_INVALID = 'TENANT_SCOPE_INVALID',
  SESSION_REVOKED = 'SESSION_REVOKED',

  // Resource & State Conflicts
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_STATE_CONFLICT = 'RESOURCE_STATE_CONFLICT',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  VERSION_CONFLICT = 'VERSION_CONFLICT',

  // Idempotency
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  CONCURRENT_REQUEST_IN_PROGRESS = 'CONCURRENT_REQUEST_IN_PROGRESS',

  // Business Rules - Inventory & Sales
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  NEGATIVE_STOCK_DISALLOWED = 'NEGATIVE_STOCK_DISALLOWED',
  QUOTA_LEASE_EXPIRED = 'QUOTA_LEASE_EXPIRED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  PRICE_NOT_AVAILABLE = 'PRICE_NOT_AVAILABLE',

  // Business Rules - Finance & Accounting
  PERIOD_CLOSED = 'PERIOD_CLOSED',
  UNBALANCED_JOURNAL_ENTRY = 'UNBALANCED_JOURNAL_ENTRY',
  POSTED_JOURNAL_IMMUTABLE = 'POSTED_JOURNAL_IMMUTABLE',
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
  PAYMENT_UNKNOWN = 'PAYMENT_UNKNOWN',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',

  // ZATCA Compliance
  EINVOICE_REJECTED = 'EINVOICE_REJECTED',
  EGS_NOT_CONFIGURED = 'EGS_NOT_CONFIGURED',
  CSID_EXPIRED_OR_REVOKED = 'CSID_EXPIRED_OR_REVOKED',
  HASH_CHAIN_CORRUPTED = 'HASH_CHAIN_CORRUPTED',

  // Offline & Sync
  SYNC_CONFLICT = 'SYNC_CONFLICT',
  ROLLBACK_ATTACK_DETECTED = 'ROLLBACK_ATTACK_DETECTED',
  DEVICE_QUARANTINED = 'DEVICE_QUARANTINED',

  // System & Operations
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface AppErrorPayload {
  code: SystemErrorCode;
  message: string;
  details?: Record<string, unknown>;
  correlationId?: string;
  retryable?: boolean;
}

export class AppError extends Error {
  public readonly code: SystemErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly correlationId?: string;
  public readonly retryable: boolean;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = 'AppError';
    this.code = payload.code;
    this.details = payload.details;
    this.correlationId = payload.correlationId;
    this.retryable = payload.retryable ?? false;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
