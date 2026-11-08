export type UUID = string;

export interface AuditMetadata {
  createdAt: Date;
  createdBy: UUID;
  updatedAt?: Date;
  updatedBy?: UUID;
  correlationId?: string;
  sourceSystem?: string;
}

export interface TenantContext {
  tenantId: UUID;
  legalEntityId?: UUID;
  branchId?: UUID;
  warehouseId?: UUID;
  deviceId?: UUID;
  userId: UUID;
  scopes: string[];
}

export interface PaginatedQuery {
  pageSize?: number;
  cursor?: string;
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    nextCursor?: string;
    hasMore: boolean;
    totalCount?: number;
  };
}

export interface DomainEventEnvelope<T = Record<string, unknown>> {
  eventId: UUID;
  eventType: string;
  schemaVersion: number;
  tenantId: UUID;
  legalEntityId: UUID;
  branchId?: UUID;
  aggregateType: string;
  aggregateId: UUID;
  aggregateVersion: number;
  occurredAt: Date;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  data: T;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId?: string;
}
