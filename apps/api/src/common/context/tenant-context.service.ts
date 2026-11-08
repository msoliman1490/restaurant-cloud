import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run(context: TenantContext, callback: () => Promise<void> | void): void {
    this.storage.run(context, callback);
  }

  getContext(): TenantContext | undefined {
    return this.storage.getStore();
  }

  getRequiredContext(): TenantContext {
    const context = this.storage.getStore();
    if (!context) {
      throw new Error('TenantContext missing from current execution scope.');
    }
    return context;
  }
}
