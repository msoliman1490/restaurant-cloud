import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Trash2,
  X,
  Loader2,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { apiClient } from '../api/client';
import {
  OfflineQueuedOrder,
  OfflineQueueStatus,
  LocalQuotaLease,
  SyncBatchApiResponse,
  listQueuedOrders,
  getLocalLeases,
  saveLocalLeases,
  recoverInterruptedSyncs,
  syncOfflineQueue,
  removeQueuedOrder,
  clearSyncedOrders,
  updateQueuedOrder,
  subscribeNetworkStatus,
} from '../utils/offlinePosQueue';

interface OfflinePosDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId?: string;
  warehouseId?: string;
  branchId?: string;
  onOrderSynced?: () => void;
}

const STATUS_META: Record<
  OfflineQueueStatus,
  { labelAr: string; badgeClass: string; icon: React.ReactNode }
> = {
  PENDING: {
    labelAr: 'قيد الانتظار',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  SYNCING: {
    labelAr: 'جاري المزامنة',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  },
  SYNCED: {
    labelAr: 'تمت المزامنة',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  CONFLICT: {
    labelAr: 'تعارض مخزون/تسلسل',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-200',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  FAILED: {
    labelAr: 'فشلت المزامنة',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
};

export const OfflinePosDrawer: React.FC<OfflinePosDrawerProps> = ({
  isOpen,
  onClose,
  deviceId,
  warehouseId,
  branchId,
  onOrderSynced,
}) => {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [orders, setOrders] = useState<OfflineQueuedOrder[]>([]);
  const [leases, setLeases] = useState<LocalQuotaLease[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [refreshingLeases, setRefreshingLeases] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    await recoverInterruptedSyncs();
    const [qOrders, qLeases] = await Promise.all([
      listQueuedOrders(),
      getLocalLeases(deviceId, warehouseId),
    ]);
    setOrders(qOrders);
    setLeases(qLeases);
  }, [deviceId, warehouseId]);

  const handleSyncOrders = useCallback(
    async (targetIds?: string[]) => {
      if (!isOnline) {
        setErrorMsg('لا يوجد اتصال بالإنترنت حالياً');
        return;
      }
      setSyncing(true);
      setErrorMsg(null);
      setFeedback(null);
      try {
        const res = await syncOfflineQueue(
          (payload) =>
            apiClient.post<SyncBatchApiResponse>('/api/v1/sales/offline/sync', {
              orders: payload.orders.map((o) => ({
                clientTransactionId: o.clientTransactionId,
                idempotencyKey: o.idempotencyKey,
                deviceId: o.deviceId,
                deviceEpoch: o.deviceEpoch,
                seq: o.seq,
                legalEntityId: o.legalEntityId,
                branchId: o.branchId,
                warehouseId: o.warehouseId,
                shiftId: o.shiftId,
                tableId: o.tableId,
                customerId: o.customerId,
                orderNumber: o.orderNumber,
                orderType: o.orderType,
                channel: o.channel,
                invoiceType: o.invoiceType,
                offlineCreatedAt: o.offlineCreatedAt,
                notes: o.notes,
                lines: o.lines,
                payments: o.payments,
              })),
            }),
          targetIds,
        );
        await loadState();
        if (res) {
          setFeedback(
            `تمت المزامنة: ${res.summary.synced + res.summary.alreadySynced} نجاح، ${res.summary.conflict} تعارض، ${res.summary.failed} فشل`,
          );
          if (res.summary.synced > 0 && onOrderSynced) {
            onOrderSynced();
          }
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'حدث خطأ أثناء المزامنة');
        await loadState();
      } finally {
        setSyncing(false);
      }
    },
    [isOnline, loadState, onOrderSynced],
  );

  const handleRefreshLeases = useCallback(async () => {
    if (!isOnline) {
      setErrorMsg('لا يمكن تحديث الحصص دون اتصال بالإنترنت');
      return;
    }
    setRefreshingLeases(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (branchId) params.set('branchId', branchId);
      const rows = await apiClient.get<any[]>(
        `/api/v1/sales/offline/leases?${params.toString()}`,
      );
      const normalized: LocalQuotaLease[] = (Array.isArray(rows) ? rows : []).map(
        (r) => ({
          id: r.id,
          warehouseId: r.warehouseId,
          itemId: r.itemId,
          deviceId: r.deviceId,
          deviceEpoch: r.deviceEpoch,
          allocatedQty: Number(r.allocatedQty || 0),
          consumedQty: Number(r.consumedQty || 0),
          lastReceivedSeq: Number(r.lastReceivedSeq || 0),
          validUntil: r.validUntil,
          signature: r.signature,
          status: r.status,
        }),
      );
      await saveLocalLeases(normalized);
      setLeases(normalized);
      setFeedback(`تم تحديث ${normalized.length} حصة مخزون نشطة`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر جلب حصص المخزون');
    } finally {
      setRefreshingLeases(false);
    }
  }, [isOnline, deviceId, warehouseId, branchId]);

  useEffect(() => {
    loadState();
  }, [loadState, isOpen]);

  useEffect(() => {
    return subscribeNetworkStatus(
      () => {
        setIsOnline(true);
        // Auto-sync pending orders upon reconnection
        void handleSyncOrders();
      },
      () => {
        setIsOnline(false);
      },
    );
  }, [handleSyncOrders]);

  if (!isOpen) return null;

  const counts = {
    PENDING: orders.filter((o) => o.status === 'PENDING').length,
    SYNCING: orders.filter((o) => o.status === 'SYNCING').length,
    SYNCED: orders.filter((o) => o.status === 'SYNCED').length,
    CONFLICT: orders.filter((o) => o.status === 'CONFLICT').length,
    FAILED: orders.filter((o) => o.status === 'FAILED').length,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs"
      dir="rtl"
    >
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-r border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                isOnline
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {isOnline ? (
                <Wifi className="w-5 h-5" />
              ) : (
                <WifiOff className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">
                طابور المبيعات دون اتصال (Offline POS)
              </h2>
              <p className="text-xs text-slate-500">
                {isOnline
                  ? 'متصل بالخادم — جاهز للمزامنة الفورية'
                  : 'وضع عدم الاتصال — يتم الحفظ محلياً بأمان'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Summary Strip */}
        <div className="grid grid-cols-5 gap-2 p-3 bg-slate-50 border-b border-slate-200 text-center">
          {(
            ['PENDING', 'SYNCING', 'SYNCED', 'CONFLICT', 'FAILED'] as OfflineQueueStatus[]
          ).map((st) => (
            <div
              key={st}
              className="bg-white rounded-lg border border-slate-200 py-1.5 px-1"
            >
              <div className="text-sm font-bold text-slate-800">
                {counts[st]}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {STATUS_META[st].labelAr}
              </div>
            </div>
          ))}
        </div>

        {/* Actions Bar */}
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleSyncOrders()}
            disabled={syncing || !isOnline || counts.PENDING === 0}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`}
            />
            مزامنة المعلق ({counts.PENDING})
          </button>
          <button
            onClick={handleRefreshLeases}
            disabled={refreshingLeases || !isOnline}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            تحديث الحصص ({leases.length})
          </button>
          {counts.SYNCED > 0 && (
            <button
              onClick={async () => {
                await clearSyncedOrders();
                await loadState();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs hover:bg-slate-100"
            >
              <Trash2 className="w-3.5 h-3.5" />
              مسح المكتمل
            </button>
          )}
        </div>

        {/* Feedback / Error Banner */}
        {feedback && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
            {feedback}
          </div>
        )}
        {errorMsg && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Orders Queue List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {orders.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              لا توجد فواتير في طابور المزامنة المحلي
            </div>
          ) : (
            orders.map((ord) => {
              const meta = STATUS_META[ord.status];
              return (
                <div
                  key={ord.clientTransactionId}
                  className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-slate-900 text-sm">
                        #{ord.orderNumber}
                      </span>
                      <span className="mr-2 text-[11px] text-slate-400">
                        SEQ {ord.seq} • {ord.invoiceType}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.badgeClass}`}
                    >
                      {meta.icon}
                      {meta.labelAr}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      {ord.lines.length} أصناف • الإجمالي التقديري:{' '}
                      <strong className="text-slate-900">
                        {ord.grandTotalEstimate} ر.س
                      </strong>
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(ord.offlineCreatedAt).toLocaleTimeString('ar-SA')}
                    </span>
                  </div>

                  {ord.errorMessage && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                      {ord.reasonCode ? `[${ord.reasonCode}] ` : ''}
                      {ord.errorMessage}
                    </div>
                  )}

                  {(ord.status === 'FAILED' || ord.status === 'CONFLICT') && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={async () => {
                          await updateQueuedOrder(ord.clientTransactionId, {
                            status: 'PENDING',
                          });
                          await handleSyncOrders([ord.clientTransactionId]);
                        }}
                        disabled={!isOnline || syncing}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs hover:bg-slate-800 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        إعادة المحاولة
                      </button>
                      <button
                        onClick={async () => {
                          await removeQueuedOrder(ord.clientTransactionId);
                          await loadState();
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 text-red-700 text-xs hover:bg-red-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        حذف / تجاهل
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
