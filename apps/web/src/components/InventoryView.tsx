import { useState } from 'react';
import {
  Boxes,
  ArrowLeftRight,
  AlertTriangle,
  ArrowUpRight,
  Plus,
  ArrowDownLeft,
  RotateCcw,
  Warehouse as WarehouseIcon,
  Search,
  ShieldCheck,
  PackageCheck,
} from 'lucide-react';
import { StockBalance, Warehouse, StockTransfer, InventoryMovementRow } from '../types';

const INITIAL_WAREHOUSES: Warehouse[] = [
  {
    id: 'wh-all',
    code: 'ALL',
    name: 'جميع المستودعات',
    branchName: 'الكل',
    warehouseType: 'ALL',
    status: 'ACTIVE',
  },
  {
    id: 'wh-1',
    code: 'WH-CENTRAL',
    name: 'المستودع المركزي (الملز)',
    branchName: 'المركز الرئيسي',
    warehouseType: 'MAIN',
    status: 'ACTIVE',
    allowReceiving: true,
    allowIssuing: true,
    allowTransfer: true,
  },
  {
    id: 'wh-2',
    code: 'WH-OLAYA',
    name: 'مستودع فرع العليا',
    branchName: 'فرع الرياض العليا',
    warehouseType: 'BRANCH',
    status: 'ACTIVE',
    allowReceiving: true,
    allowIssuing: true,
    allowTransfer: true,
  },
  {
    id: 'wh-3',
    code: 'WH-MALQA',
    name: 'مستودع فرع الملقا',
    branchName: 'فرع الرياض الملقا',
    warehouseType: 'BRANCH',
    status: 'ACTIVE',
    allowReceiving: true,
    allowIssuing: true,
    allowTransfer: true,
  },
  {
    id: 'wh-4',
    code: 'WH-RAW-01',
    name: 'مستودع المواد الخام والتجهيز',
    branchName: 'المطبخ المركزي',
    warehouseType: 'RAW_MATERIALS',
    status: 'ACTIVE',
    allowReceiving: true,
    allowIssuing: true,
    allowTransfer: true,
  },
  {
    id: 'wh-5',
    code: 'WH-QUARANTINE',
    name: 'مستودع التوالف والحجر الصحي',
    branchName: 'المركز الرئيسي',
    warehouseType: 'DAMAGED_RETURNS',
    status: 'ACTIVE',
    allowReceiving: false,
    allowIssuing: false,
    allowTransfer: true,
  },
];

const INITIAL_BALANCES: StockBalance[] = [
  {
    id: 'bal-1',
    warehouseId: 'wh-1',
    warehouseName: 'المستودع المركزي (الملز)',
    warehouseCode: 'WH-CENTRAL',
    warehouseType: 'MAIN',
    itemId: 'prod-1',
    itemSku: 'BRG-001',
    itemName: 'برجر أنجوس كلاسيك (شريحة خام)',
    onHandQty: 450,
    reservedQty: 30,
    inTransitQty: 0,
    damagedQty: 5,
    underInspectionQty: 0,
    availableQty: 415,
    unitCost: 14.5,
    wacCost: 14.5,
    totalValue: 6452.5,
    minStock: 50,
    maxStock: 800,
    reorderPoint: 100,
    availabilityStatus: 'IN_STOCK',
  },
  {
    id: 'bal-2',
    warehouseId: 'wh-2',
    warehouseName: 'مستودع فرع العليا',
    warehouseCode: 'WH-OLAYA',
    warehouseType: 'BRANCH',
    itemId: 'prod-1',
    itemSku: 'BRG-001',
    itemName: 'برجر أنجوس كلاسيك (شريحة خام)',
    onHandQty: 85,
    reservedQty: 5,
    inTransitQty: 20,
    damagedQty: 0,
    underInspectionQty: 0,
    availableQty: 80,
    unitCost: 14.5,
    wacCost: 14.5,
    totalValue: 1232.5,
    minStock: 20,
    maxStock: 150,
    reorderPoint: 35,
    availabilityStatus: 'IN_STOCK',
  },
  {
    id: 'bal-3',
    warehouseId: 'wh-2',
    warehouseName: 'مستودع فرع العليا',
    warehouseCode: 'WH-OLAYA',
    warehouseType: 'BRANCH',
    itemId: 'prod-2',
    itemSku: 'BRG-002',
    itemName: 'برجر دجاج كرسبي مقرمش',
    onHandQty: 18,
    reservedQty: 2,
    inTransitQty: 0,
    damagedQty: 1,
    underInspectionQty: 0,
    availableQty: 15,
    unitCost: 11.0,
    wacCost: 11.0,
    totalValue: 187.0,
    minStock: 25,
    maxStock: 200,
    reorderPoint: 40,
    availabilityStatus: 'LOW_STOCK',
  },
  {
    id: 'bal-4',
    warehouseId: 'wh-1',
    warehouseName: 'المستودع المركزي (الملز)',
    warehouseCode: 'WH-CENTRAL',
    warehouseType: 'MAIN',
    itemId: 'prod-5',
    itemSku: 'BEV-001',
    itemName: 'كوكاكولا عبوة معدنية 330 مل',
    onHandQty: 1200,
    reservedQty: 100,
    inTransitQty: 0,
    damagedQty: 12,
    underInspectionQty: 0,
    availableQty: 1088,
    unitCost: 2.2,
    wacCost: 2.2,
    totalValue: 2613.6,
    minStock: 200,
    maxStock: 2500,
    reorderPoint: 400,
    availabilityStatus: 'IN_STOCK',
  },
  {
    id: 'bal-5',
    warehouseId: 'wh-3',
    warehouseName: 'مستودع فرع الملقا',
    warehouseCode: 'WH-MALQA',
    warehouseType: 'BRANCH',
    itemId: 'prod-5',
    itemSku: 'BEV-001',
    itemName: 'كوكاكولا عبوة معدنية 330 مل',
    onHandQty: 350,
    reservedQty: 15,
    inTransitQty: 50,
    damagedQty: 0,
    underInspectionQty: 0,
    availableQty: 335,
    unitCost: 2.2,
    wacCost: 2.2,
    totalValue: 770.0,
    minStock: 50,
    maxStock: 600,
    reorderPoint: 100,
    availabilityStatus: 'IN_STOCK',
  },
  {
    id: 'bal-6',
    warehouseId: 'wh-4',
    warehouseName: 'مستودع المواد الخام والتجهيز',
    warehouseCode: 'WH-RAW-01',
    warehouseType: 'RAW_MATERIALS',
    itemId: 'prod-6',
    itemSku: 'RAW-001',
    itemName: 'جبن شيدر أصفر مبشور (5 كجم)',
    onHandQty: 0,
    reservedQty: 0,
    inTransitQty: 0,
    damagedQty: 0,
    underInspectionQty: 0,
    availableQty: 0,
    unitCost: 75.0,
    wacCost: 75.0,
    totalValue: 0.0,
    minStock: 10,
    maxStock: 80,
    reorderPoint: 15,
    availabilityStatus: 'OUT_OF_STOCK',
  },
];

const INITIAL_TRANSFERS: StockTransfer[] = [
  {
    id: 'trf-1',
    transferNumber: 'TRF-2026-0042',
    sourceWarehouseName: 'المستودع المركزي (الملز)',
    destinationWarehouseName: 'مستودع فرع العليا',
    status: 'IN_TRANSIT',
    itemCount: 4,
    requestedAt: '2026-11-08 09:30',
  },
  {
    id: 'trf-2',
    transferNumber: 'TRF-2026-0041',
    sourceWarehouseName: 'المستودع المركزي (الملز)',
    destinationWarehouseName: 'مستودع فرع الملقا',
    status: 'RECEIVED',
    itemCount: 6,
    requestedAt: '2026-11-07 14:15',
  },
];

const INITIAL_MOVEMENTS: InventoryMovementRow[] = [
  {
    id: 'mov-1',
    movementNumber: 'MOV-RCV-M49X1-102',
    movementType: 'PURCHASE_RECEIPT',
    direction: 'IN',
    warehouseName: 'المستودع المركزي (الملز)',
    itemName: 'برجر أنجوس كلاسيك (شريحة خام)',
    itemSku: 'BRG-001',
    quantity: 200,
    unitCost: 14.5,
    totalCost: 2900,
    batchNumber: 'LOT-2026-11-A',
    notes: 'توريد مباشر بموجب فاتورة المورد INV-449',
    occurredAt: '2026-11-08 08:30',
    isReversed: false,
  },
  {
    id: 'mov-2',
    movementNumber: 'MOV-ISS-M49X2-108',
    movementType: 'INTERNAL_CONSUMPTION',
    direction: 'OUT',
    warehouseName: 'مستودع فرع العليا',
    itemName: 'برجر دجاج كرسبي مقرمش',
    itemSku: 'BRG-002',
    quantity: 15,
    unitCost: 11.0,
    totalCost: 165,
    notes: 'صرف تحضيري للمطبخ الداخلي',
    occurredAt: '2026-11-08 11:45',
    isReversed: false,
  },
  {
    id: 'mov-3',
    movementNumber: 'MOV-TRF-M49X3-205',
    movementType: 'BRANCH_TRANSFER',
    direction: 'OUT',
    warehouseName: 'المستودع المركزي (الملز)',
    itemName: 'كوكاكولا عبوة معدنية 330 مل',
    itemSku: 'BEV-001',
    quantity: 100,
    unitCost: 2.2,
    totalCost: 220,
    notes: 'تحويل بين الفروع - إرسال إلى فرع العليا',
    occurredAt: '2026-11-08 14:10',
    isReversed: false,
  },
];

export const InventoryView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'BALANCES' | 'WAREHOUSES' | 'MOVEMENTS' | 'TRANSFERS'>('BALANCES');

  const [warehouses, setWarehouses] = useState<Warehouse[]>(INITIAL_WAREHOUSES);
  const [balances, setBalances] = useState<StockBalance[]>(INITIAL_BALANCES);
  const [movements, setMovements] = useState<InventoryMovementRow[]>(INITIAL_MOVEMENTS);
  const [transfers, setTransfers] = useState<StockTransfer[]>(INITIAL_TRANSFERS);

  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('wh-all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
  const [selectedMovementForReversal, setSelectedMovementForReversal] = useState<InventoryMovementRow | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  // Receive Form
  const [rcvWarehouse, setRcvWarehouse] = useState('wh-1');
  const [rcvItemId, setRcvItemId] = useState('prod-1');
  const [rcvQty, setRcvQty] = useState('100');
  const [rcvCost, setRcvCost] = useState('15.00');
  const [rcvBatch, setRcvBatch] = useState('LOT-2026-NEW');
  const [rcvNotes, setRcvNotes] = useState('استلام مباشر بموجب أمر شراء');

  // Issue Form
  const [issWarehouse, setIssWarehouse] = useState('wh-2');
  const [issItemId, setIssItemId] = useState('prod-1');
  const [issQty, setIssQty] = useState('10');
  const [issNotes, setIssNotes] = useState('صرف استهلاك تشغيلي داخلي');

  // Warehouse Form
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('');
  const [whType, setWhType] = useState('BRANCH');
  const [whAllowRcv, setWhAllowRcv] = useState(true);
  const [whAllowIss, setWhAllowIss] = useState(true);
  const [whAllowTrf, setWhAllowTrf] = useState(true);

  // Transfer Form
  const [srcWh, setSrcWh] = useState('wh-1');
  const [dstWh, setDstWh] = useState('wh-2');
  const [transferQty, setTransferQty] = useState('20');

  // Filtered Balances
  const filteredBalances = balances.filter((b) => {
    const matchWh = selectedWarehouse === 'wh-all' || b.warehouseId === selectedWarehouse;
    const matchSearch =
      b.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.itemSku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.warehouseName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || b.availabilityStatus === statusFilter;
    return matchWh && matchSearch && matchStatus;
  });

  // KPI Calculations
  const totalValuation = balances.reduce((sum, b) => sum + (b.totalValue || 0), 0);
  const lowStockCount = balances.filter((b) => b.availabilityStatus === 'LOW_STOCK').length;
  const outOfStockCount = balances.filter((b) => b.availabilityStatus === 'OUT_OF_STOCK').length;
  const inStockCount = balances.filter((b) => b.availabilityStatus === 'IN_STOCK').length;

  // Live WAC Preview for Receive Modal
  const currentRcvBalance = balances.find((b) => b.warehouseId === rcvWarehouse && b.itemId === rcvItemId);
  const existingRcvOnHand = currentRcvBalance ? currentRcvBalance.onHandQty : 0;
  const existingRcvWac = currentRcvBalance ? (currentRcvBalance.wacCost || currentRcvBalance.unitCost) : 0;
  const incomingRcvQty = parseFloat(rcvQty) || 0;
  const incomingRcvCost = parseFloat(rcvCost) || 0;
  const calculatedNewWac =
    existingRcvOnHand + incomingRcvQty > 0
      ? (existingRcvOnHand * existingRcvWac + incomingRcvQty * incomingRcvCost) / (existingRcvOnHand + incomingRcvQty)
      : incomingRcvCost;

  // Live Available Check for Issue Modal
  const currentIssBalance = balances.find((b) => b.warehouseId === issWarehouse && b.itemId === issItemId);
  const currentIssAvailable = currentIssBalance ? (currentIssBalance.availableQty ?? currentIssBalance.onHandQty) : 0;
  const enteredIssQty = parseFloat(issQty) || 0;
  const isOverdraft = enteredIssQty > currentIssAvailable;

  // Handlers
  const handleReceiveStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (incomingRcvQty <= 0 || incomingRcvCost < 0) {
      alert('يرجى إدخال كمية موجبة وسعر وحدة صحيح');
      return;
    }

    const targetWh = warehouses.find((w) => w.id === rcvWarehouse);
    const existing = balances.find((b) => b.warehouseId === rcvWarehouse && b.itemId === rcvItemId);

    const newOnHand = (existing?.onHandQty || 0) + incomingRcvQty;
    const newWac = calculatedNewWac;
    const newTotalVal = (newOnHand - (existing?.damagedQty || 0)) * newWac;

    if (existing) {
      setBalances(
        balances.map((b) =>
          b.id === existing.id
            ? {
                ...b,
                onHandQty: newOnHand,
                availableQty: (b.availableQty ?? b.onHandQty) + incomingRcvQty,
                wacCost: newWac,
                unitCost: newWac,
                totalValue: newTotalVal,
                availabilityStatus: newOnHand > (b.reorderPoint || 0) ? 'IN_STOCK' : 'LOW_STOCK',
              }
            : b
        )
      );
    }

    const newMovement: InventoryMovementRow = {
      id: `mov-${Date.now()}`,
      movementNumber: `MOV-RCV-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
      movementType: 'PURCHASE_RECEIPT',
      direction: 'IN',
      warehouseName: targetWh?.name || 'مستودع رئيسي',
      itemName: existing?.itemName || 'صنف مستلم',
      itemSku: existing?.itemSku || 'SKU-NEW',
      quantity: incomingRcvQty,
      unitCost: incomingRcvCost,
      totalCost: incomingRcvQty * incomingRcvCost,
      batchNumber: rcvBatch || undefined,
      notes: rcvNotes,
      occurredAt: 'الآن',
      isReversed: false,
    };

    setMovements([newMovement, ...movements]);
    setIsReceiveModalOpen(false);
  };

  const handleIssueStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOverdraft) {
      alert(`الرصيد المتاح (${currentIssAvailable}) غير كافٍ لصرف الكمية (${enteredIssQty})`);
      return;
    }

    const targetWh = warehouses.find((w) => w.id === issWarehouse);
    const existing = currentIssBalance!;
    const newOnHand = existing.onHandQty - enteredIssQty;
    const currentCost = existing.wacCost || existing.unitCost;

    setBalances(
      balances.map((b) =>
        b.id === existing.id
          ? {
              ...b,
              onHandQty: newOnHand,
              availableQty: Math.max(0, (b.availableQty ?? b.onHandQty) - enteredIssQty),
              totalValue: (newOnHand - (b.damagedQty || 0)) * currentCost,
              availabilityStatus:
                newOnHand <= 0 ? 'OUT_OF_STOCK' : newOnHand <= (b.reorderPoint || 0) ? 'LOW_STOCK' : 'IN_STOCK',
            }
          : b
      )
    );

    const newMovement: InventoryMovementRow = {
      id: `mov-${Date.now()}`,
      movementNumber: `MOV-ISS-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
      movementType: 'INTERNAL_CONSUMPTION',
      direction: 'OUT',
      warehouseName: targetWh?.name || 'مستودع صرف',
      itemName: existing.itemName,
      itemSku: existing.itemSku,
      quantity: enteredIssQty,
      unitCost: currentCost,
      totalCost: enteredIssQty * currentCost,
      notes: issNotes,
      occurredAt: 'الآن',
      isReversed: false,
    };

    setMovements([newMovement, ...movements]);
    setIsIssueModalOpen(false);
  };

  const handleReverseMovement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMovementForReversal) return;

    const original = selectedMovementForReversal;
    const newReversalMov: InventoryMovementRow = {
      id: `mov-rev-${Date.now()}`,
      movementNumber: `MOV-REV-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
      movementType: original.movementType,
      direction: original.direction === 'IN' ? 'OUT' : 'IN',
      warehouseName: original.warehouseName,
      itemName: original.itemName,
      itemSku: original.itemSku,
      quantity: original.quantity,
      unitCost: original.unitCost,
      totalCost: original.totalCost,
      notes: `عكس الحركة رقم ${original.movementNumber}: ${reversalReason}`,
      occurredAt: 'الآن',
      isReversed: false,
      reversalOfId: original.id,
    };

    setMovements(
      movements.map((m) => (m.id === original.id ? { ...m, isReversed: true } : m)).concat(newReversalMov)
    );

    setSelectedMovementForReversal(null);
    setReversalReason('');
  };

  const handleCreateWarehouse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!whCode || !whName) {
      alert('يرجى إدخال كود واسم المستودع');
      return;
    }

    const newWh: Warehouse = {
      id: `wh-${Date.now()}`,
      code: whCode.trim().toUpperCase(),
      name: whName.trim(),
      warehouseType: whType,
      branchName: 'المركز الرئيسي',
      status: 'ACTIVE',
      allowReceiving: whAllowRcv,
      allowIssuing: whAllowIss,
      allowTransfer: whAllowTrf,
    };

    setWarehouses([...warehouses, newWh]);
    setIsWarehouseModalOpen(false);
    setWhCode('');
    setWhName('');
  };

  const handleCreateTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (srcWh === dstWh) {
      alert('لا يمكن التحويل إلى نفس المستودع');
      return;
    }

    const src = warehouses.find((w) => w.id === srcWh);
    const dst = warehouses.find((w) => w.id === dstWh);

    const newTrf: StockTransfer = {
      id: `trf-${Date.now()}`,
      transferNumber: `TRF-2026-00${transfers.length + 43}`,
      sourceWarehouseName: src?.name ?? 'مستودع المصدر',
      destinationWarehouseName: dst?.name ?? 'مستودع الوجهة',
      status: 'IN_TRANSIT',
      itemCount: 1,
      requestedAt: 'الآن',
    };

    setTransfers([newTrf, ...transfers]);
    setIsTransferModalOpen(false);
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">نظام إدارة المستودعات والمخزون (WMS)</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              المرحلة A: التأسيس والتكلفة المرجحة WAC
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            متابعة أرصدة المستودعات لحظياً، دفتر الحركات المركزي غير القابل للتعديل، ومتوسط التكلفة المرجح (WAC)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsReceiveModalOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-xs shadow-emerald-600/20"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>استلام مخزون جديد</span>
          </button>

          <button
            onClick={() => setIsIssueModalOpen(true)}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-xs shadow-rose-600/20"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>صرف مخزون تشغيلي</span>
          </button>

          <button
            onClick={() => setIsTransferModalOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-xs shadow-indigo-600/20"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>طلب مناقلة</span>
          </button>

          <button
            onClick={() => setIsWarehouseModalOpen(true)}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>مستودع جديد</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>القيمة الإجمالية للمخزون</span>
            <Boxes className="w-5 h-5 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {totalValuation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
          </p>
          <span className="text-xs text-slate-400 mt-1 block">محسوبة بمتوسط التكلفة المرجح (WAC)</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>الأصناف المتوفرة</span>
            <PackageCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 mt-2">{inStockCount} أصناف</p>
          <span className="text-xs text-slate-400 mt-1 block">فوق حد إعادة الطلب وتلبي الاحتياج</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>تحت حد الطلب / نافذ</span>
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <p className="text-2xl font-bold text-amber-600">{lowStockCount}</p>
            <span className="text-xs text-slate-400">منخفض</span>
            <span className="text-slate-300">|</span>
            <p className="text-2xl font-bold text-rose-600">{outOfStockCount}</p>
            <span className="text-xs text-slate-400">نافذ</span>
          </div>
          <span className="text-xs text-amber-600/80 mt-1 block">تحتاج إلى إصدار أوامر شراء عاجلة</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>المستودعات ومراكز التخزين</span>
            <WarehouseIcon className="w-5 h-5 text-slate-700" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{warehouses.filter((w) => w.id !== 'wh-all').length} مراكز</p>
          <span className="text-xs text-slate-400 mt-1 block">رئيسية، فروع، مواد خام، وحجر</span>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('BALANCES')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'BALANCES'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>أرصدة المستودعات والتكلفة المرجحة ({filteredBalances.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('WAREHOUSES')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'WAREHOUSES'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <WarehouseIcon className="w-4 h-4" />
          <span>إدارة المستودعات ({warehouses.filter((w) => w.id !== 'wh-all').length})</span>
        </button>

        <button
          onClick={() => setActiveTab('MOVEMENTS')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'MOVEMENTS'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>دفتر حركات المخزون المركزي ({movements.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('TRANSFERS')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'TRANSFERS'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>المناقلات بين الفروع ({transfers.length})</span>
        </button>
      </div>

      {/* Tab 1: Stock Balances */}
      {activeTab === 'BALANCES' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input
                  type="text"
                  placeholder="بحث باسم الصنف أو SKU أو المستودع..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-1 overflow-x-auto">
                {INITIAL_WAREHOUSES.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => setSelectedWarehouse(w.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedWarehouse === w.id
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">الحالة:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white"
              >
                <option value="ALL">جميع الحالات</option>
                <option value="IN_STOCK">متوفر (In Stock)</option>
                <option value="LOW_STOCK">تحت حد الطلب (Low Stock)</option>
                <option value="OUT_OF_STOCK">نافذ (Out of Stock)</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4">الصنف والرمز (SKU)</th>
                    <th className="py-3 px-4">المستودع</th>
                    <th className="py-3 px-4 text-center">الرصيد الفعلي (On-Hand)</th>
                    <th className="py-3 px-4 text-center">المحجوز</th>
                    <th className="py-3 px-4 text-center">في الطريق</th>
                    <th className="py-3 px-4 text-center">التالف</th>
                    <th className="py-3 px-4 text-center">الرصيد المتاح</th>
                    <th className="py-3 px-4 text-left">التكلفة المرجحة (WAC)</th>
                    <th className="py-3 px-4 text-left">إجمالي القيمة</th>
                    <th className="py-3 px-4 text-center">حالة الوفرة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBalances.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-slate-400">
                        لا توجد أصناف تطابق معايير البحث المحددة
                      </td>
                    </tr>
                  ) : (
                    filteredBalances.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-800">{b.itemName}</div>
                          <span className="font-mono text-xs text-indigo-600 font-medium">{b.itemSku}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-700">{b.warehouseName}</div>
                          <span className="text-xs text-slate-400 font-mono">{b.warehouseCode}</span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                          {b.onHandQty}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-xs text-slate-500">
                          {b.reservedQty}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-xs text-blue-600">
                          {b.inTransitQty || 0}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-xs text-rose-500">
                          {b.damagedQty || 0}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                            {b.availableQty ?? (b.onHandQty - b.reservedQty)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-left font-mono text-slate-700">
                          {(b.wacCost || b.unitCost).toFixed(2)} ر.س
                        </td>
                        <td className="py-3 px-4 text-left font-mono font-bold text-slate-900">
                          {b.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              b.availabilityStatus === 'OUT_OF_STOCK'
                                ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                : b.availabilityStatus === 'LOW_STOCK'
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {b.availabilityStatus === 'OUT_OF_STOCK'
                              ? 'نافذ'
                              : b.availabilityStatus === 'LOW_STOCK'
                              ? 'تحت حد الطلب'
                              : 'متوفر'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Warehouses */}
      {activeTab === 'WAREHOUSES' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {warehouses
            .filter((w) => w.id !== 'wh-all')
            .map((wh) => (
              <div key={wh.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-900">{wh.name}</h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                        {wh.code}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 mt-1 block">{wh.branchName || 'مستودع مركزي'}</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    نشط
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>نوع المستودع:</span>
                    <span className="font-bold text-slate-800">
                      {wh.warehouseType === 'MAIN'
                        ? 'مستودع رئيسي'
                        : wh.warehouseType === 'BRANCH'
                        ? 'مستودع فرع'
                        : wh.warehouseType === 'RAW_MATERIALS'
                        ? 'مواد خام وتجهيز'
                        : 'حجر صحي وتوالف'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>الاستلام المباشر:</span>
                    <span className={wh.allowReceiving !== false ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                      {wh.allowReceiving !== false ? 'مسموح' : 'غير مفعل'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>الصرف المباشر:</span>
                    <span className={wh.allowIssuing !== false ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                      {wh.allowIssuing !== false ? 'مسموح' : 'غير مفعل'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>المناقلة بين الفروع:</span>
                    <span className={wh.allowTransfer !== false ? 'text-indigo-600 font-bold' : 'text-slate-400'}>
                      {wh.allowTransfer !== false ? 'مسموح' : 'غير مفعل'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                  <span className="text-slate-400">عدد الأصناف المخزنة:</span>
                  <span className="font-bold font-mono text-slate-800">
                    {balances.filter((b) => b.warehouseId === wh.id).length} صنف
                  </span>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Tab 3: Central Movements Ledger */}
      {activeTab === 'MOVEMENTS' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              <div>
                <h4 className="font-bold text-sm text-slate-800">دفتر حركات المخزون الثابت (Immutable Transaction Ledger)</h4>
                <p className="text-xs text-slate-500">
                  الحركات مسجلة بشكل دائم ولا يمكن حذفها. التصحيح يتم حصرياً عبر حركات عكسية موثقة.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-slate-600 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
              {movements.length} حركة مسجلة
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4">رقم الحركة</th>
                    <th className="py-3 px-4">نوع الحركة والاتجاه</th>
                    <th className="py-3 px-4">المستودع</th>
                    <th className="py-3 px-4">الصنف</th>
                    <th className="py-3 px-4 text-center">الكمية</th>
                    <th className="py-3 px-4 text-left">سعر الوحدة</th>
                    <th className="py-3 px-4 text-left">التكلفة الإجمالية</th>
                    <th className="py-3 px-4">ملاحظات</th>
                    <th className="py-3 px-4 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <span className="font-mono text-xs font-bold text-slate-800">{m.movementNumber}</span>
                        {m.reversalOfId && (
                          <span className="block text-[10px] text-indigo-600 font-mono mt-0.5">
                            عكس حركة سابقة
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            m.direction === 'IN'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {m.direction === 'IN' ? 'وارد (IN)' : 'صادر (OUT)'} - {m.movementType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">{m.warehouseName}</td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">{m.itemName}</div>
                        <span className="font-mono text-xs text-slate-400">{m.itemSku}</span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">{m.quantity}</td>
                      <td className="py-3 px-4 text-left font-mono text-slate-600">{m.unitCost.toFixed(2)} ر.س</td>
                      <td className="py-3 px-4 text-left font-mono font-bold text-slate-900">
                        {m.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 max-w-xs truncate">{m.notes || '—'}</td>
                      <td className="py-3 px-4 text-center">
                        {m.isReversed ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            معكوسة
                          </span>
                        ) : (
                          <button
                            onClick={() => setSelectedMovementForReversal(m)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold hover:underline flex items-center justify-center gap-1 mx-auto"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>عكس الحركة</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Transfers */}
      {activeTab === 'TRANSFERS' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-800">حركات المناقلات بين المستودعات والفروع</h3>
            <span className="text-xs text-slate-400">حفظ كتلة المخزون (Conservation of Stock)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">رقم المناقلة</th>
                  <th className="py-3 px-4">من مستودع</th>
                  <th className="py-3 px-4">إلى مستودع</th>
                  <th className="py-3 px-4 text-center">عدد الأصناف</th>
                  <th className="py-3 px-4 text-center">تاريخ الطلب</th>
                  <th className="py-3 px-4 text-center">حالة المناقلة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-xs text-indigo-600">{t.transferNumber}</td>
                    <td className="py-3 px-4 text-slate-700">{t.sourceWarehouseName}</td>
                    <td className="py-3 px-4 text-slate-700">{t.destinationWarehouseName}</td>
                    <td className="py-3 px-4 text-center font-mono">{t.itemCount}</td>
                    <td className="py-3 px-4 text-center text-xs text-slate-500 font-mono">{t.requestedAt}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          t.status === 'IN_TRANSIT'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : t.status === 'RECEIVED'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {t.status === 'IN_TRANSIT' ? 'في الطريق (In Transit)' : 'تم الاستلام (Received)'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal 1: Receive Stock */}
      {isReceiveModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
                <span>استلام مخزون جديد (توريد / شراء)</span>
              </h3>
              <button onClick={() => setIsReceiveModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleReceiveStock} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المستودع المستلم</label>
                <select
                  value={rcvWarehouse}
                  onChange={(e) => setRcvWarehouse(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {warehouses
                    .filter((w) => w.id !== 'wh-all' && w.allowReceiving !== false)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الصنف المستلم</label>
                <select
                  value={rcvItemId}
                  onChange={(e) => setRcvItemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {INITIAL_BALANCES.map((b) => (
                    <option key={b.itemId} value={b.itemId}>
                      {b.itemName} ({b.itemSku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">الكمية المستلمة</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={rcvQty}
                    onChange={(e) => setRcvQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">سعر الوحدة (ر.س)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rcvCost}
                    onChange={(e) => setRcvCost(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                    required
                  />
                </div>
              </div>

              {/* Dynamic WAC calculation preview */}
              <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-indigo-900 font-semibold">
                  <span>التكلفة المرجحة الحالية (WAC):</span>
                  <span className="font-mono">{existingRcvWac.toFixed(2)} ر.س</span>
                </div>
                <div className="flex items-center justify-between text-indigo-900 font-bold border-t border-indigo-200 pt-1">
                  <span>التكلفة المرجحة الجديدة بعد الاستلام:</span>
                  <span className="font-mono text-sm text-indigo-700">{calculatedNewWac.toFixed(2)} ر.س</span>
                </div>
                <span className="text-[10px] text-slate-500 block">
                  المعادلة: (الرصيد الحالي × التكلفة الحالية + الكمية الواردة × سعر الوارد) ÷ (الرصيد الإجمالي الجديد)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">رقم التشغيلة / الدفعة (Batch)</label>
                <input
                  type="text"
                  value={rcvBatch}
                  onChange={(e) => setRcvBatch(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ملاحظات / مرجع الفاتورة</label>
                <input
                  type="text"
                  value={rcvNotes}
                  onChange={(e) => setRcvNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium shadow-xs hover:bg-emerald-700"
                >
                  تأكيد استلام المخزون
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Issue Stock */}
      {isIssueModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-rose-600" />
                <span>صرف مخزون تشغيلي داخلي</span>
              </h3>
              <button onClick={() => setIsIssueModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleIssueStock} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">مستودع الصرف</label>
                <select
                  value={issWarehouse}
                  onChange={(e) => setIssWarehouse(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {warehouses
                    .filter((w) => w.id !== 'wh-all' && w.allowIssuing !== false)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الصنف المصروف</label>
                <select
                  value={issItemId}
                  onChange={(e) => setIssItemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {INITIAL_BALANCES.map((b) => (
                    <option key={b.itemId} value={b.itemId}>
                      {b.itemName} ({b.itemSku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">الكمية المطلوبة للصرف</label>
                  <span className="text-xs text-slate-500 font-mono">
                    الرصيد المتاح حالياً: <b className="text-indigo-600 font-bold">{currentIssAvailable}</b>
                  </span>
                </div>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={issQty}
                  onChange={(e) => setIssQty(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl border text-sm font-mono ${
                    isOverdraft ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200'
                  }`}
                  required
                />
                {isOverdraft && (
                  <p className="text-xs text-rose-600 font-bold mt-1">
                    ⚠️ تنبيه: الكمية المطلوبة تتجاوز الرصيد المتاح. يمنع النظام صرف أي كمية بالسالب.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">سبب الصرف والملاحظات</label>
                <input
                  type="text"
                  value={issNotes}
                  onChange={(e) => setIssNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsIssueModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isOverdraft}
                  className={`px-5 py-2 rounded-xl text-white text-sm font-medium shadow-xs ${
                    isOverdraft ? 'bg-slate-300 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  تأكيد صرف المخزون
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Reverse Movement */}
      {selectedMovementForReversal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-indigo-600" />
                <span>عكس حركة المخزون رقم {selectedMovementForReversal.movementNumber}</span>
              </h3>
              <button onClick={() => setSelectedMovementForReversal(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleReverseMovement} className="space-y-4">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
                <div className="font-bold">⚠️ قواعد العكس غير القابل للتعديل:</div>
                <p>
                  سيتم إنشاء حركة عكسية جديدة بالاتجاه المعاكس ({selectedMovementForReversal.direction === 'IN' ? 'صادر OUT' : 'وارد IN'}) وربطها بالحركة الأصلية مع تعديل رصيد المستودع تلقائياً.
                </p>
              </div>

              <div className="space-y-1 text-xs text-slate-700 bg-slate-50 p-3 rounded-xl">
                <div>الصنف: <b>{selectedMovementForReversal.itemName}</b></div>
                <div>الكمية المعكوسة: <b className="font-mono">{selectedMovementForReversal.quantity}</b></div>
                <div>المستودع: <b>{selectedMovementForReversal.warehouseName}</b></div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">سبب العكس الإلزامي</label>
                <input
                  type="text"
                  placeholder="مثال: خطأ في كمية الإدخال من قبل أمين المستودع"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedMovementForReversal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-xs hover:bg-indigo-700"
                >
                  تأكيد عكس الحركة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: New Warehouse */}
      {isWarehouseModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <WarehouseIcon className="w-5 h-5 text-slate-900" />
                <span>إضافة مستودع / مركز تخزين جديد</span>
              </h3>
              <button onClick={() => setIsWarehouseModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateWarehouse} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">كود المستودع</label>
                  <input
                    type="text"
                    placeholder="WH-JED-01"
                    value={whCode}
                    onChange={(e) => setWhCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono uppercase"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">نوع المستودع</label>
                  <select
                    value={whType}
                    onChange={(e) => setWhType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  >
                    <option value="MAIN">مستودع رئيسي (MAIN)</option>
                    <option value="BRANCH">مستودع فرع (BRANCH)</option>
                    <option value="RAW_MATERIALS">مواد خام وتجهيز (RAW_MATERIALS)</option>
                    <option value="FINISHED_GOODS">بضاعة تامة (FINISHED_GOODS)</option>
                    <option value="PACKAGING">تغليف وتعبئة (PACKAGING)</option>
                    <option value="DAMAGED_RETURNS">توالف ورواجع (DAMAGED_RETURNS)</option>
                    <option value="INSPECTION_QUARANTINE">حجر وفحص جودة (QUARANTINE)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">اسم المستودع</label>
                <input
                  type="text"
                  placeholder="مستودع فرع جدة التحلية"
                  value={whName}
                  onChange={(e) => setWhName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  required
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200">
                <span className="text-xs font-bold text-slate-700 block">الصلاحيات التشغيلية للمستودع:</span>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whAllowRcv}
                    onChange={(e) => setWhAllowRcv(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>السماح بالاستلام المباشر للمخزون (Purchase Receiving)</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whAllowIss}
                    onChange={(e) => setWhAllowIss(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>السماح بالصرف المباشر للاستهلاك (Operational Issuing)</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whAllowTrf}
                    onChange={(e) => setWhAllowTrf(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>السماح بالمناقلات البينية (Inter-Warehouse Transfers)</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsWarehouseModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium shadow-xs hover:bg-slate-800"
                >
                  حفظ المستودع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 5: New Transfer */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="font-bold text-lg text-slate-800 mb-4 pb-2 border-b border-slate-100">
              إنشاء طلب مناقلة مخزنية بين الفروع
            </h3>
            <form onSubmit={handleCreateTransfer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المستودع المصدر (خصم الكمية)</label>
                <select
                  value={srcWh}
                  onChange={(e) => setSrcWh(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {warehouses
                    .filter((w) => w.id !== 'wh-all' && w.allowTransfer !== false)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المستودع المستلم (إضافة الكمية)</label>
                <select
                  value={dstWh}
                  onChange={(e) => setDstWh(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {warehouses
                    .filter((w) => w.id !== 'wh-all' && w.allowTransfer !== false)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الكمية المحولة</label>
                <input
                  type="number"
                  min="1"
                  value={transferQty}
                  onChange={(e) => setTransferQty(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 border border-slate-200">
                يتم قفل المخزون وحفظ حركة المناقلة مع التحقق الصارم من توفر الرصيد في مستودع المصدر.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-xs hover:bg-indigo-700"
                >
                  تأكيد وإرسال المناقلة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
