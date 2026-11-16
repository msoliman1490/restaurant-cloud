export type OfflineQueueStatus =
  | 'PENDING'
  | 'SYNCING'
  | 'SYNCED'
  | 'CONFLICT'
  | 'FAILED';

export interface OfflineOrderLinePayload {
  itemId: string;
  uomId: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  notes?: string;
  modifiers?: Array<{
    modifierNameAr: string;
    modifierNameEn?: string;
    priceDelta: string;
    quantity: number;
  }>;
}

export interface OfflinePaymentPayload {
  paymentMethod: string;
  amount: string;
  providerCode?: string;
  providerTransactionRef?: string;
  idempotencyKey?: string;
}

export interface OfflineQueuedOrder {
  clientTransactionId: string;
  idempotencyKey: string;
  deviceId: string;
  deviceEpoch: string;
  seq: number;
  legalEntityId: string;
  branchId: string;
  warehouseId: string;
  shiftId?: string;
  tableId?: string;
  customerId?: string;
  orderNumber: string;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'PICKUP';
  channel: 'POS' | 'KIOSK' | 'AGGREGATOR' | 'WEB' | 'MOBILE';
  invoiceType: 'STANDARD' | 'SIMPLIFIED';
  offlineCreatedAt: string;
  notes?: string;
  lines: OfflineOrderLinePayload[];
  payments?: OfflinePaymentPayload[];
  grandTotalEstimate: string;
  status: OfflineQueueStatus;
  retryCount: number;
  lastAttemptAt?: string;
  serverOrderId?: string;
  reasonCode?: string;
  errorMessage?: string;
}

export interface LocalQuotaLease {
  id: string;
  warehouseId: string;
  itemId: string;
  deviceId: string;
  deviceEpoch: string;
  allocatedQty: number;
  consumedQty: number;
  lastReceivedSeq: number;
  validUntil: string;
  signature: string;
  status: string;
}

export interface SyncBatchApiResponse {
  summary: {
    total: number;
    synced: number;
    alreadySynced: number;
    conflict: number;
    failed: number;
  };
  results: Array<{
    clientTransactionId: string;
    idempotencyKey: string;
    seq: number;
    status: 'SYNCED' | 'ALREADY_SYNCED' | 'CONFLICT' | 'FAILED';
    orderId?: string;
    orderNumber?: string;
    grandTotal?: string;
    reasonCode?: string;
    message?: string;
  }>;
}

const DB_NAME = 'restaurant_cloud_offline_pos_v1';
const DB_VERSION = 1;
const STORE_ORDERS = 'orders';
const STORE_LEASES = 'leases';
const STORE_META = 'meta';

const LS_ORDERS_KEY = 'rc_offline_pos_orders_v1';
const LS_LEASES_KEY = 'rc_offline_pos_leases_v1';
const LS_META_KEY = 'rc_offline_pos_meta_v1';

export function generateUniqueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ORDERS)) {
        db.createObjectStore(STORE_ORDERS, { keyPath: 'clientTransactionId' });
      }
      if (!db.objectStoreNames.contains(STORE_LEASES)) {
        db.createObjectStore(STORE_LEASES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors on fallback mirror
  }
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbClearAndPutAll<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Gets or initializes a persistent deviceEpoch and monotonic sequence counter
 * that survive browser restarts.
 */
export async function getOrCreateDeviceEpoch(deviceId: string): Promise<string> {
  const metaKey = `epoch:${deviceId}`;
  const meta = readLocalStorageJson<Record<string, unknown>>(LS_META_KEY, {});
  if (typeof meta[metaKey] === 'string') {
    return meta[metaKey] as string;
  }

  try {
    const allMeta = await idbGetAll<{ key: string; value: unknown }>(STORE_META);
    const found = allMeta.find((m) => m.key === metaKey);
    if (found && typeof found.value === 'string') {
      meta[metaKey] = found.value;
      writeLocalStorageJson(LS_META_KEY, meta);
      return found.value;
    }
  } catch {
    // Fallback to localStorage
  }

  const newEpoch = generateUniqueId();
  meta[metaKey] = newEpoch;
  writeLocalStorageJson(LS_META_KEY, meta);
  try {
    await idbPut(STORE_META, { key: metaKey, value: newEpoch });
  } catch {
    // localStorage mirror already saved
  }
  return newEpoch;
}

export async function nextDeviceSeq(
  deviceId: string,
  deviceEpoch: string,
): Promise<number> {
  const seqKey = `seq:${deviceId}:${deviceEpoch}`;
  const meta = readLocalStorageJson<Record<string, unknown>>(LS_META_KEY, {});
  let current = typeof meta[seqKey] === 'number' ? (meta[seqKey] as number) : 0;

  try {
    const allMeta = await idbGetAll<{ key: string; value: unknown }>(STORE_META);
    const found = allMeta.find((m) => m.key === seqKey);
    if (found && typeof found.value === 'number' && found.value > current) {
      current = found.value;
    }
  } catch {
    // Fallback to localStorage value
  }

  const next = current + 1;
  meta[seqKey] = next;
  writeLocalStorageJson(LS_META_KEY, meta);
  try {
    await idbPut(STORE_META, { key: seqKey, value: next });
  } catch {
    // localStorage mirror already saved
  }
  return next;
}

export async function listQueuedOrders(): Promise<OfflineQueuedOrder[]> {
  try {
    const orders = await idbGetAll<OfflineQueuedOrder>(STORE_ORDERS);
    if (orders.length > 0) {
      writeLocalStorageJson(LS_ORDERS_KEY, orders);
      return orders.sort((a, b) => a.seq - b.seq);
    }
  } catch {
    // Fallback to localStorage
  }
  const lsOrders = readLocalStorageJson<OfflineQueuedOrder[]>(LS_ORDERS_KEY, []);
  return lsOrders.sort((a, b) => a.seq - b.seq);
}

async function persistOrder(order: OfflineQueuedOrder): Promise<void> {
  const lsOrders = readLocalStorageJson<OfflineQueuedOrder[]>(LS_ORDERS_KEY, []);
  const idx = lsOrders.findIndex(
    (o) => o.clientTransactionId === order.clientTransactionId,
  );
  if (idx >= 0) {
    lsOrders[idx] = order;
  } else {
    lsOrders.push(order);
  }
  writeLocalStorageJson(LS_ORDERS_KEY, lsOrders);

  try {
    await idbPut(STORE_ORDERS, order);
  } catch {
    // localStorage fallback already persisted
  }
}

export async function enqueueOfflineOrder(
  input: Omit<
    OfflineQueuedOrder,
    | 'clientTransactionId'
    | 'idempotencyKey'
    | 'deviceEpoch'
    | 'seq'
    | 'offlineCreatedAt'
    | 'status'
    | 'retryCount'
  > & { deviceEpoch?: string },
): Promise<OfflineQueuedOrder> {
  const deviceEpoch =
    input.deviceEpoch || (await getOrCreateDeviceEpoch(input.deviceId));
  const seq = await nextDeviceSeq(input.deviceId, deviceEpoch);
  const clientTransactionId = generateUniqueId();

  const queued: OfflineQueuedOrder = {
    ...input,
    deviceEpoch,
    seq,
    clientTransactionId,
    idempotencyKey: clientTransactionId,
    offlineCreatedAt: new Date().toISOString(),
    status: 'PENDING',
    retryCount: 0,
  };

  await persistOrder(queued);
  return queued;
}

export async function updateQueuedOrder(
  clientTransactionId: string,
  patch: Partial<OfflineQueuedOrder>,
): Promise<OfflineQueuedOrder | null> {
  const all = await listQueuedOrders();
  const existing = all.find(
    (o) => o.clientTransactionId === clientTransactionId,
  );
  if (!existing) return null;

  const updated: OfflineQueuedOrder = { ...existing, ...patch };
  await persistOrder(updated);
  return updated;
}

export async function removeQueuedOrder(
  clientTransactionId: string,
): Promise<void> {
  const lsOrders = readLocalStorageJson<OfflineQueuedOrder[]>(LS_ORDERS_KEY, []);
  writeLocalStorageJson(
    LS_ORDERS_KEY,
    lsOrders.filter((o) => o.clientTransactionId !== clientTransactionId),
  );
  try {
    await idbDelete(STORE_ORDERS, clientTransactionId);
  } catch {
    // Ignore
  }
}

export async function clearSyncedOrders(): Promise<void> {
  const all = await listQueuedOrders();
  const remaining = all.filter((o) => o.status !== 'SYNCED');
  writeLocalStorageJson(LS_ORDERS_KEY, remaining);
  try {
    await idbClearAndPutAll(STORE_ORDERS, remaining);
  } catch {
    // Ignore
  }
}

/**
 * Recovers any orders left in 'SYNCING' state after an abrupt browser/app restart
 * back to 'PENDING' so they are safely retried without loss.
 */
export async function recoverInterruptedSyncs(): Promise<number> {
  const all = await listQueuedOrders();
  let recovered = 0;
  for (const order of all) {
    if (order.status === 'SYNCING') {
      await persistOrder({ ...order, status: 'PENDING' });
      recovered++;
    }
  }
  return recovered;
}

export async function saveLocalLeases(leases: LocalQuotaLease[]): Promise<void> {
  writeLocalStorageJson(LS_LEASES_KEY, leases);
  try {
    await idbClearAndPutAll(STORE_LEASES, leases);
  } catch {
    // Ignore
  }
}

export async function getLocalLeases(
  deviceId?: string,
  warehouseId?: string,
): Promise<LocalQuotaLease[]> {
  let leases: LocalQuotaLease[] = [];
  try {
    leases = await idbGetAll<LocalQuotaLease>(STORE_LEASES);
  } catch {
    leases = readLocalStorageJson<LocalQuotaLease[]>(LS_LEASES_KEY, []);
  }
  if (leases.length === 0) {
    leases = readLocalStorageJson<LocalQuotaLease[]>(LS_LEASES_KEY, []);
  }

  return leases.filter((l) => {
    if (deviceId && l.deviceId !== deviceId) return false;
    if (warehouseId && l.warehouseId !== warehouseId) return false;
    return l.status === 'ACTIVE';
  });
}

/**
 * Computes remaining local offline quota for an item by subtracting both
 * server-consumed qty and locally queued PENDING/SYNCING order quantities.
 */
export async function getRemainingLocalQuota(
  deviceId: string,
  warehouseId: string,
  itemId: string,
): Promise<number> {
  const leases = await getLocalLeases(deviceId, warehouseId);
  const lease = leases.find((l) => l.itemId === itemId);
  if (!lease) return 0;

  const orders = await listQueuedOrders();
  let pendingQty = 0;
  for (const ord of orders) {
    if (
      ord.deviceId === deviceId &&
      ord.warehouseId === warehouseId &&
      (ord.status === 'PENDING' || ord.status === 'SYNCING')
    ) {
      for (const line of ord.lines) {
        if (line.itemId === itemId) {
          pendingQty += parseFloat(line.quantity) || 0;
        }
      }
    }
  }

  return Math.max(0, lease.allocatedQty - lease.consumedQty - pendingQty);
}

/**
 * Synchronizes PENDING (and optionally specified) offline orders with the server.
 */
export async function syncOfflineQueue(
  postSyncFn: (payload: { orders: OfflineQueuedOrder[] }) => Promise<SyncBatchApiResponse>,
  targetTransactionIds?: string[],
): Promise<SyncBatchApiResponse | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null;
  }

  const all = await listQueuedOrders();
  const candidates = all.filter((o) => {
    if (targetTransactionIds && targetTransactionIds.length > 0) {
      return targetTransactionIds.includes(o.clientTransactionId);
    }
    return o.status === 'PENDING';
  });

  if (candidates.length === 0) {
    return null;
  }

  const nowIso = new Date().toISOString();
  for (const ord of candidates) {
    await persistOrder({
      ...ord,
      status: 'SYNCING',
      lastAttemptAt: nowIso,
    });
  }

  try {
    const response = await postSyncFn({ orders: candidates });
    for (const res of response.results) {
      const target = candidates.find(
        (c) => c.clientTransactionId === res.clientTransactionId,
      );
      if (!target) continue;

      if (res.status === 'SYNCED' || res.status === 'ALREADY_SYNCED') {
        await persistOrder({
          ...target,
          status: 'SYNCED',
          serverOrderId: res.orderId,
          reasonCode: undefined,
          errorMessage: undefined,
        });
      } else if (res.status === 'CONFLICT') {
        await persistOrder({
          ...target,
          status: 'CONFLICT',
          retryCount: target.retryCount + 1,
          reasonCode: res.reasonCode,
          errorMessage: res.message,
        });
      } else {
        await persistOrder({
          ...target,
          status: 'FAILED',
          retryCount: target.retryCount + 1,
          reasonCode: res.reasonCode,
          errorMessage: res.message,
        });
      }
    }
    return response;
  } catch (err: any) {
    const msg = err?.message || 'تعذر الاتصال بالخادم للمزامنة';
    for (const ord of candidates) {
      await persistOrder({
        ...ord,
        status: 'FAILED',
        retryCount: ord.retryCount + 1,
        errorMessage: msg,
      });
    }
    throw err;
  }
}

export function subscribeNetworkStatus(
  onOnline: () => void,
  onOffline: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
