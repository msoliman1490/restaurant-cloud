import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { auditLogs, DatabaseInstance } from '@restaurant-cloud/database';
import { UUID } from '@restaurant-cloud/domain-kernel';

export interface RecordAuditParams {
  tenantId: UUID;
  actorId?: UUID;
  action: string;
  entityType: string;
  entityId: UUID;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  correlationId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Records an immutable audit log entry.
   * If a transaction `tx` is provided, the entry is written inside that transaction
   * under the active RLS tenant context for strict atomicity.
   */
  async log(params: RecordAuditParams, tx?: DatabaseInstance): Promise<void> {
    const client = tx || this.dbService.db;
    await client.insert(auditLogs).values({
      tenantId: params.tenantId,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeState: params.beforeState ? JSON.stringify(params.beforeState) : null,
      afterState: params.afterState ? JSON.stringify(params.afterState) : null,
      correlationId: params.correlationId,
    });
  }
}
