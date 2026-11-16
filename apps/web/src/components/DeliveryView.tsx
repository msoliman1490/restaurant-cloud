import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Truck,
  MapPin,
  PackageCheck,
  Wallet,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  UserCheck,
} from 'lucide-react';

interface DeliveryZone {
  id: string;
  branchId: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  deliveryFee: string;
  minOrderAmount: string;
  estimatedMinutes: number;
  isActive: boolean;
}

interface DeliveryDriver {
  id: string;
  branchId: string;
  driverCode: string;
  fullNameAr: string;
  phone: string;
  vehicleType: string;
  plateNumber?: string | null;
  availabilityStatus: string;
  isActive: boolean;
}

interface DeliveryOrder {
  id: string;
  salesOrderId: string;
  branchId: string;
  driverId?: string | null;
  channel: string;
  aggregatorName?: string | null;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryFee: string;
  codAmount: string;
  codCollected: boolean;
  codSettled: boolean;
  status: string;
  createdAt: string;
}

interface DriverSettlement {
  id: string;
  driverId: string;
  settlementNumber: string;
  expectedCodAmount: string;
  settledAmount: string;
  varianceAmount: string;
  settledAt: string;
}

interface CashVault {
  id: string;
  code: string;
  nameAr: string;
  balance: string;
}

export const DeliveryView: React.FC = () => {
  const { hierarchy, activeLegalEntity, activeBranch } = useAuth();
  const legalEntities = hierarchy?.legalEntities || [];
  const branches = hierarchy?.branches || [];
  const { showToast } = useToast();

  const [subTab, setSubTab] = useState<'orders' | 'drivers' | 'zones' | 'settlements'>('orders');
  const [loading, setLoading] = useState(false);

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [settlements, setSettlements] = useState<DriverSettlement[]>([]);
  const [vaults, setVaults] = useState<CashVault[]>([]);

  const [legalEntityId, setLegalEntityId] = useState(activeLegalEntity?.id || legalEntities[0]?.id || '');
  const [branchId, setBranchId] = useState(activeBranch?.id || branches[0]?.id || '');

  // New driver form
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [driverCode, setDriverCode] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<'MOTORBIKE' | 'CAR' | 'BICYCLE' | 'VAN'>('MOTORBIKE');
  const [plateNumber, setPlateNumber] = useState('');

  // New zone form
  const [showAddZone, setShowAddZone] = useState(false);
  const [zoneCode, setZoneCode] = useState('');
  const [zoneNameAr, setZoneNameAr] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('15');
  const [estimatedMinutes, setEstimatedMinutes] = useState('45');

  // COD Settlement form
  const [settleDriverId, setSettleDriverId] = useState('');
  const [settleVaultId, setSettleVaultId] = useState('');
  const [settledAmount, setSettledAmount] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordRes, drvRes, znRes, setRes] = await Promise.all([
        apiClient.get<any>('/api/v1/delivery/orders'),
        apiClient.get<any>('/api/v1/delivery/drivers'),
        apiClient.get<any>('/api/v1/delivery/zones'),
        apiClient.get<any>('/api/v1/delivery/settlements/cod'),
      ]);
      setOrders(Array.isArray(ordRes) ? ordRes : (ordRes?.data || ordRes?.items || []));
      setDrivers(Array.isArray(drvRes) ? drvRes : (drvRes?.data || drvRes?.items || []));
      setZones(Array.isArray(znRes) ? znRes : (znRes?.data || znRes?.items || []));
      setSettlements(Array.isArray(setRes) ? setRes : (setRes?.data || setRes?.items || []));

      if (legalEntityId) {
        const vRes = await apiClient.get<any>(
          `/api/v1/accounting/vaults?legalEntityId=${encodeURIComponent(legalEntityId)}`,
        );
        setVaults(Array.isArray(vRes) ? vRes : (vRes?.data || vRes?.items || []));
      }
    } catch {
      showToast('تعذر تحميل بيانات التوصيل والسائقين', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [legalEntityId]);

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/v1/delivery/drivers', {
        legalEntityId,
        branchId,
        driverCode,
        fullNameAr: driverName,
        phone: driverPhone,
        vehicleType,
        plateNumber: plateNumber || undefined,
      });
      showToast('تم إضافة السائق بنجاح', 'success');
      setShowAddDriver(false);
      setDriverCode('');
      setDriverName('');
      setDriverPhone('');
      setPlateNumber('');
      loadData();
    } catch (err: any) {
      showToast(err?.message || 'فشل تسجيل السائق', 'error');
    }
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/v1/delivery/zones', {
        legalEntityId,
        branchId,
        code: zoneCode,
        nameAr: zoneNameAr,
        deliveryFee: Number(deliveryFee),
        estimatedMinutes: Number(estimatedMinutes),
      });
      showToast('تم إضافة منطقة التوصيل', 'success');
      setShowAddZone(false);
      setZoneCode('');
      setZoneNameAr('');
      loadData();
    } catch (err: any) {
      showToast(err?.message || 'فشل إضافة المنطقة', 'error');
    }
  };

  const handleAssignDriver = async (orderId: string, dId: string) => {
    if (!dId) return;
    try {
      await apiClient.post(`/api/v1/delivery/orders/${orderId}/assign`, { driverId: dId });
      showToast('تم إسناد السائق بنجاح', 'success');
      loadData();
    } catch (err: any) {
      showToast(err?.message || 'فشل إسناد السائق', 'error');
    }
  };

  const handleStatusChange = async (orderId: string, status: string) => {
    try {
      await apiClient.patch(`/api/v1/delivery/orders/${orderId}/status`, { status });
      showToast('تم تحديث حالة الطلب', 'success');
      loadData();
    } catch (err: any) {
      showToast(err?.message || 'فشل تحديث الحالة', 'error');
    }
  };

  const handleSettleCod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/v1/delivery/settlements/cod', {
        driverId: settleDriverId,
        cashVaultId: settleVaultId,
        settledAmount: Number(settledAmount),
        idempotencyKey: `cod-ui-${settleDriverId}-${Date.now()}`,
      });
      showToast('تمت تسوية التحصيل النقدي (COD) وترحيل القيد بنجاح', 'success');
      setSettledAmount('');
      loadData();
    } catch (err: any) {
      showToast(err?.message || 'فشل تسوية التحصيل النقدي', 'error');
    }
  };

  const driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <Truck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">التوصيل والسائقون (Delivery & Drivers)</h1>
            <p className="text-sm text-slate-500">إدارة المناطق، السائقين، إسناد الطلبات، وتسويات الدفع عند الاستلام (COD)</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'orders', label: 'الطلبات والإسناد', icon: PackageCheck },
            { id: 'drivers', label: 'السائقون', icon: UserCheck },
            { id: 'zones', label: 'مناطق التوصيل', icon: MapPin },
            { id: 'settlements', label: 'تسويات COD', icon: Wallet },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id as any)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  subTab === tab.id
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-slate-500">
          <Loader2 className="ml-2 h-5 w-5 animate-spin" />
          جارٍ التحميل...
        </div>
      )}

      {subTab === 'orders' && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">طلبات التوصيل النشطة والتاريخية</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">العميل</th>
                  <th className="px-3 py-2.5">القناة</th>
                  <th className="px-3 py-2.5">العنوان</th>
                  <th className="px-3 py-2.5">COD</th>
                  <th className="px-3 py-2.5">السائق</th>
                  <th className="px-3 py-2.5">الحالة</th>
                  <th className="px-3 py-2.5">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-medium">
                      <div>{ord.customerName}</div>
                      <div className="text-xs text-slate-500">{ord.customerPhone}</div>
                    </td>
                    <td className="px-3 py-2.5">{ord.aggregatorName || ord.channel}</td>
                    <td className="px-3 py-2.5 max-w-xs truncate">{ord.deliveryAddress}</td>
                    <td className="px-3 py-2.5 font-mono">{Number(ord.codAmount).toFixed(2)}</td>
                    <td className="px-3 py-2.5">
                      {ord.driverId ? (
                        <span className="font-medium text-slate-800">
                          {driverMap[ord.driverId]?.fullNameAr || ord.driverId.slice(0, 8)}
                        </span>
                      ) : (
                        <select
                          defaultValue=""
                          onChange={(e) => handleAssignDriver(ord.id, e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="">إسناد سائق...</option>
                          {drivers
                            .filter((d) => d.isActive)
                            .map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.fullNameAr} ({d.availabilityStatus})
                              </option>
                            ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {ord.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1.5">
                        {ord.status === 'ASSIGNED' && (
                          <button
                            onClick={() => handleStatusChange(ord.id, 'OUT_FOR_DELIVERY')}
                            className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                          >
                            خرج للتوصيل
                          </button>
                        )}
                        {(ord.status === 'PICKED_UP' || ord.status === 'OUT_FOR_DELIVERY') && (
                          <>
                            <button
                              onClick={() => handleStatusChange(ord.id, 'DELIVERED')}
                              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              تم التسليم
                            </button>
                            <button
                              onClick={() => handleStatusChange(ord.id, 'FAILED_RETURNED')}
                              className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              مرتجع
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      لا توجد طلبات توصيل مسجلة بعد
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'drivers' && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">قائمة السائقين</h2>
            <button
              onClick={() => setShowAddDriver(!showAddDriver)}
              className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-orange-700"
            >
              <Plus className="h-4 w-4" />
              إضافة سائق
            </button>
          </div>

          {showAddDriver && (
            <form onSubmit={handleCreateDriver} className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 md:grid-cols-3">
              <select
                value={legalEntityId}
                onChange={(e) => setLegalEntityId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                {legalEntities.map((le) => (
                  <option key={le.id} value={le.id}>
                    {le.commercialName || le.legalName}
                  </option>
                ))}
              </select>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="كود السائق (مثال: DRV-001)"
                value={driverCode}
                onChange={(e) => setDriverCode(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                placeholder="الاسم الكامل"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                placeholder="رقم الجوال"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <select
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as any)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="MOTORBIKE">دراجة نارية</option>
                <option value="CAR">سيارة</option>
                <option value="VAN">فان</option>
                <option value="BICYCLE">دراجة هوائية</option>
              </select>
              <input
                placeholder="رقم اللوحة (اختياري)"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                حفظ السائق
              </button>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">الكود</th>
                  <th className="px-3 py-2.5">الاسم</th>
                  <th className="px-3 py-2.5">الجوال</th>
                  <th className="px-3 py-2.5">المركبة</th>
                  <th className="px-3 py-2.5">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2.5 font-mono">{d.driverCode}</td>
                    <td className="px-3 py-2.5 font-medium">{d.fullNameAr}</td>
                    <td className="px-3 py-2.5">{d.phone}</td>
                    <td className="px-3 py-2.5">
                      {d.vehicleType} {d.plateNumber ? `(${d.plateNumber})` : ''}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          d.availabilityStatus === 'AVAILABLE'
                            ? 'bg-emerald-100 text-emerald-700'
                            : d.availabilityStatus === 'ON_DELIVERY'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {d.availabilityStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'zones' && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">مناطق التوصيل والتعرفة</h2>
            <button
              onClick={() => setShowAddZone(!showAddZone)}
              className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-orange-700"
            >
              <Plus className="h-4 w-4" />
              إضافة منطقة
            </button>
          </div>

          {showAddZone && (
            <form onSubmit={handleCreateZone} className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 md:grid-cols-4">
              <input
                placeholder="رمز المنطقة (مثال: Z-NORTH)"
                value={zoneCode}
                onChange={(e) => setZoneCode(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                placeholder="اسم المنطقة"
                value={zoneNameAr}
                onChange={(e) => setZoneNameAr(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                type="number"
                step="0.01"
                placeholder="رسوم التوصيل"
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                type="number"
                placeholder="الزمن المتوقع (دقائق)"
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                حفظ المنطقة
              </button>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">الرمز</th>
                  <th className="px-3 py-2.5">الاسم</th>
                  <th className="px-3 py-2.5">رسوم التوصيل</th>
                  <th className="px-3 py-2.5">الزمن المتوقع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td className="px-3 py-2.5 font-mono">{z.code}</td>
                    <td className="px-3 py-2.5 font-medium">{z.nameAr}</td>
                    <td className="px-3 py-2.5 font-mono">{Number(z.deliveryFee).toFixed(2)}</td>
                    <td className="px-3 py-2.5">{z.estimatedMinutes} دقيقة</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'settlements' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSettleCod}
            className="grid grid-cols-1 gap-3 rounded-xl bg-white p-5 shadow-sm border border-slate-200 md:grid-cols-4"
          >
            <select
              value={settleDriverId}
              onChange={(e) => setSettleDriverId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">اختر السائق...</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullNameAr} ({d.driverCode})
                </option>
              ))}
            </select>
            <select
              value={settleVaultId}
              onChange={(e) => setSettleVaultId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">اختر خزينة الإيداع...</option>
              {vaults.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nameAr} ({v.code})
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="المبلغ المسلم فعلياً"
              value={settledAmount}
              onChange={(e) => setSettledAmount(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              تسوية وإيداع بالخزينة
            </button>
          </form>

          <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
            <h2 className="mb-3 text-lg font-semibold text-slate-800">سجل تسويات COD</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">رقم التسوية</th>
                  <th className="px-3 py-2.5">السائق</th>
                  <th className="px-3 py-2.5">المتوقع</th>
                  <th className="px-3 py-2.5">المسلّم</th>
                  <th className="px-3 py-2.5">الفرق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2.5 font-mono">{s.settlementNumber}</td>
                    <td className="px-3 py-2.5">{driverMap[s.driverId]?.fullNameAr || s.driverId.slice(0, 8)}</td>
                    <td className="px-3 py-2.5 font-mono">{Number(s.expectedCodAmount).toFixed(2)}</td>
                    <td className="px-3 py-2.5 font-mono">{Number(s.settledAmount).toFixed(2)}</td>
                    <td className="px-3 py-2.5 font-mono">{Number(s.varianceAmount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
