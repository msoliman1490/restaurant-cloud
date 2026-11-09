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
  ClipboardCheck,
  CheckCircle2,
  Truck,
  Lock,
} from 'lucide-react';
import { StockBalance, Warehouse, StockTransfer, InventoryMovementRow, StocktakeOrder } from '../types';

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
    totalShippedQty: 40,
    totalReceivedQty: 0,
    totalDamagedQty: 0,
    totalLostQty: 0,
    requestedAt: '2026-11-08 09:30',
    approvedAt: '2026-11-08 10:15',
    notes: 'تحويل مبرد دوري لتغذية المستودع',
  },
  {
    id: 'trf-2',
    transferNumber: 'TRF-2026-0041',
    sourceWarehouseName: 'المستودع المركزي (الملز)',
    destinationWarehouseName: 'مستودع فرع الملقا',
    status: 'RECEIVED',
    itemCount: 6,
    totalShippedQty: 60,
    totalReceivedQty: 58,
    totalDamagedQty: 2,
    totalLostQty: 0,
    requestedAt: '2026-11-07 14:15',
    approvedAt: '2026-11-07 15:00',
    notes: 'تم الاستلام مع رصد 2 وحدة تالفة أثناء النقل',
  },
  {
    id: 'trf-3',
    transferNumber: 'TRF-2026-0043',
    sourceWarehouseName: 'المستودع المركزي (الملز)',
    destinationWarehouseName: 'مستودع فرع العليا',
    status: 'DRAFT',
    itemCount: 2,
    totalShippedQty: 0,
    totalReceivedQty: 0,
    totalDamagedQty: 0,
    totalLostQty: 0,
    requestedAt: '2026-11-09 10:00',
    notes: 'طلب تغذية عاجل قيد انتظار المراجعة والاعتماد',
  },
];

const INITIAL_STOCKTAKES: StocktakeOrder[] = [
  {
    id: 'stk-1',
    orderNumber: 'STK-2026-0012',
    warehouseName: 'مستودع فرع العليا',
    stocktakeType: 'FULL',
    countFrequency: 'PERIODIC',
    status: 'IN_PROGRESS',
    freezeMovements: true,
    itemCount: 3,
    countedCount: 0,
    totalVarianceQty: 0,
    totalVarianceAmount: 0,
    createdAt: '2026-11-09 08:00',
    notes: 'جرد ربع سنوي شامل لمستودع فرع العليا مع تجميد الحركات',
  },
  {
    id: 'stk-2',
    orderNumber: 'STK-2026-0011',
    warehouseName: 'المستودع المركزي (الملز)',
    stocktakeType: 'PARTIAL',
    countFrequency: 'SURPRISE',
    status: 'APPROVED',
    freezeMovements: false,
    itemCount: 2,
    countedCount: 2,
    totalVarianceQty: 2,
    totalVarianceAmount: 29.0,
    createdAt: '2026-11-07 10:30',
    countedAt: '2026-11-07 14:00',
    approvedAt: '2026-11-07 16:30',
    notes: 'جرد مفاجئ لأصناف اللحوم وتم اعتماد التسوية المخزنية',
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
  const [activeTab, setActiveTab] = useState<'BALANCES' | 'WAREHOUSES' | 'MOVEMENTS' | 'TRANSFERS' | 'STOCKTAKE'>('BALANCES');

  const [warehouses, setWarehouses] = useState<Warehouse[]>(INITIAL_WAREHOUSES);
  const [balances, setBalances] = useState<StockBalance[]>(INITIAL_BALANCES);
  const [movements, setMovements] = useState<InventoryMovementRow[]>(INITIAL_MOVEMENTS);
  const [transfers, setTransfers] = useState<StockTransfer[]>(INITIAL_TRANSFERS);
  const [stocktakes, setStocktakes] = useState<StocktakeOrder[]>(INITIAL_STOCKTAKES);

  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('wh-all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
  const [isStocktakeModalOpen, setIsStocktakeModalOpen] = useState(false);
  const [selectedMovementForReversal, setSelectedMovementForReversal] = useState<InventoryMovementRow | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  // Transfer Inspection / Receive Modal
  const [selectedTransferForReceive, setSelectedTransferForReceive] = useState<StockTransfer | null>(null);
  const [rcvTrfReceivedQty, setRcvTrfReceivedQty] = useState('20');
  const [rcvTrfDamagedQty, setRcvTrfDamagedQty] = useState('0');
  const [rcvTrfLostQty, setRcvTrfLostQty] = useState('0');
  const [rcvTrfNotes, setRcvTrfNotes] = useState('');

  // Stocktake Order Modal
  const [stkWh, setStkWh] = useState('wh-2');
  const [stkType, setStkType] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [stkFreq, setStkFreq] = useState<'PERIODIC' | 'SURPRISE'>('PERIODIC');
  const [stkFreeze, setStkFreeze] = useState(false);
  const [stkNotes, setStkNotes] = useState('');

  // Stocktake Count Entry Modal
  const [selectedStocktakeForCount, setSelectedStocktakeForCount] = useState<StocktakeOrder | null>(null);
  const [countedItems, setCountedItems] = useState<Array<{ id: string; name: string; sku: string; sysQty: number; countQty: number; unitCost: number }>>([
    { id: 'prod-1', name: 'برجر أنجوس كلاسيك (شريحة خام)', sku: 'BRG-001', sysQty: 85, countQty: 85, unitCost: 14.5 },
    { id: 'prod-2', name: 'برجر دجاج كرسبي مقرمش', sku: 'BRG-002', sysQty: 18, countQty: 15, unitCost: 11.0 },
    { id: 'prod-5', name: 'كوكاكولا عبوة معدنية 330 مل', sku: 'BEV-001', sysQty: 350, countQty: 355, unitCost: 2.2 },
  ]);

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
    const qty = parseFloat(transferQty) || 10;

    const newTrf: StockTransfer = {
      id: `trf-${Date.now()}`,
      transferNumber: `TRF-2026-00${transfers.length + 44}`,
      sourceWarehouseName: src?.name ?? 'مستودع المصدر',
      destinationWarehouseName: dst?.name ?? 'مستودع الوجهة',
      status: 'DRAFT',
      itemCount: 1,
      totalShippedQty: qty,
      totalReceivedQty: 0,
      totalDamagedQty: 0,
      totalLostQty: 0,
      requestedAt: 'الآن',
      notes: `طلب مناقلة كمية ${qty} بين الفروع`,
    };

    setTransfers([newTrf, ...transfers]);
    setIsTransferModalOpen(false);
  };

  const handleApproveTransfer = (id: string) => {
    setTransfers(
      transfers.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'APPROVED',
              approvedAt: 'الآن',
            }
          : t
      )
    );
  };

  const handleRejectTransfer = (id: string) => {
    const reason = prompt('أدخل سبب رفض طلب المناقلة:');
    if (!reason) return;
    setTransfers(
      transfers.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'REJECTED',
              notes: `${t.notes || ''} [مرفوض: ${reason}]`,
            }
          : t
      )
    );
  };

  const handleDispatchTransfer = (id: string) => {
    setTransfers(
      transfers.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'IN_TRANSIT',
            }
          : t
      )
    );
  };

  const handleOpenReceiveModal = (trf: StockTransfer) => {
    setSelectedTransferForReceive(trf);
    setRcvTrfReceivedQty(String(trf.totalShippedQty || 20));
    setRcvTrfDamagedQty('0');
    setRcvTrfLostQty('0');
    setRcvTrfNotes('');
  };

  const handleConfirmReceiveTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTransferForReceive) return;

    const rcv = parseFloat(rcvTrfReceivedQty) || 0;
    const dmg = parseFloat(rcvTrfDamagedQty) || 0;
    const lost = parseFloat(rcvTrfLostQty) || 0;
    const totalProcessed = rcv + dmg + lost;

    if (totalProcessed <= 0) {
      alert('يرجى إدخال كمية استلام صحيحة');
      return;
    }

    const shipped = selectedTransferForReceive.totalShippedQty || 0;
    if (totalProcessed > shipped && shipped > 0) {
      alert(`لا يمكن استلام كمية (${totalProcessed}) تفوق الكمية المشحونة (${shipped})`);
      return;
    }

    const isFullyReceived = totalProcessed >= shipped;

    setTransfers(
      transfers.map((t) =>
        t.id === selectedTransferForReceive.id
          ? {
              ...t,
              status: isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
              totalReceivedQty: (t.totalReceivedQty || 0) + rcv,
              totalDamagedQty: (t.totalDamagedQty || 0) + dmg,
              totalLostQty: (t.totalLostQty || 0) + lost,
              notes: `${t.notes || ''} [استلام: ${rcv} سليم، ${dmg} تالف، ${lost} مفقود]`,
            }
          : t
      )
    );

    setSelectedTransferForReceive(null);
  };

  const handleCloseTransfer = (id: string) => {
    if (!confirm('هل أنت متأكد من رغبتك في إغلاق المناقلة وتسوية الكميات غير المستلمة؟')) return;
    setTransfers(
      transfers.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'CLOSED',
              notes: `${t.notes || ''} [تم الإغلاق النهائي]`,
            }
          : t
      )
    );
  };

  // Stocktake Handlers
  const handleCreateStocktake = (e: React.FormEvent) => {
    e.preventDefault();
    const wh = warehouses.find((w) => w.id === stkWh);
    const newOrder: StocktakeOrder = {
      id: `stk-${Date.now()}`,
      orderNumber: `STK-2026-00${stocktakes.length + 13}`,
      warehouseName: wh?.name || 'مستودع فرع العليا',
      stocktakeType: stkType,
      countFrequency: stkFreq,
      status: 'DRAFT',
      freezeMovements: stkFreeze,
      itemCount: 3,
      countedCount: 0,
      totalVarianceQty: 0,
      totalVarianceAmount: 0,
      createdAt: 'الآن',
      notes: stkNotes || 'أمر جرد دوري',
    };

    setStocktakes([newOrder, ...stocktakes]);
    setIsStocktakeModalOpen(false);
    setStkNotes('');
  };

  const handleStartStocktake = (id: string) => {
    setStocktakes(
      stocktakes.map((s) =>
        s.id === id
          ? {
              ...s,
              status: 'IN_PROGRESS',
            }
          : s
      )
    );
  };

  const handleOpenCountModal = (stk: StocktakeOrder) => {
    setSelectedStocktakeForCount(stk);
  };

  const handleSaveStocktakeCount = () => {
    if (!selectedStocktakeForCount) return;

    let netVarianceQty = 0;
    let netVarianceVal = 0;

    countedItems.forEach((item) => {
      const diff = item.countQty - item.sysQty;
      netVarianceQty += diff;
      netVarianceVal += diff * item.unitCost;
    });

    setStocktakes(
      stocktakes.map((s) =>
        s.id === selectedStocktakeForCount.id
          ? {
              ...s,
              status: 'COUNTED',
              countedCount: countedItems.length,
              totalVarianceQty: netVarianceQty,
              totalVarianceAmount: netVarianceVal,
              countedAt: 'الآن',
            }
          : s
      )
    );

    setSelectedStocktakeForCount(null);
  };

  const handleApproveStocktake = (id: string) => {
    const stk = stocktakes.find((s) => s.id === id);
    if (!stk) return;

    if (!confirm(`هل أنت متأكد من اعتماد تسوية الجرد؟ سيتم توليد قيد التسوية وحركات المخزون بصافي فرق (${stk.totalVarianceAmount >= 0 ? '+' : ''}${stk.totalVarianceAmount.toFixed(2)} ر.س).`)) {
      return;
    }

    setStocktakes(
      stocktakes.map((s) =>
        s.id === id
          ? {
              ...s,
              status: 'APPROVED',
              approvedAt: 'الآن',
            }
          : s
      )
    );

    // Add stock adjustment movement
    const adjMov: InventoryMovementRow = {
      id: `mov-adj-${Date.now()}`,
      movementNumber: `MOV-ADJ-${Date.now().toString(36).toUpperCase()}`,
      movementType: 'STOCK_ADJUSTMENT',
      direction: stk.totalVarianceQty >= 0 ? 'IN' : 'OUT',
      warehouseName: stk.warehouseName,
      itemName: 'تسوية فروقات جرد المخزون',
      itemSku: 'ADJ-STK',
      quantity: Math.abs(stk.totalVarianceQty),
      unitCost: Math.abs(stk.totalVarianceAmount) / (Math.abs(stk.totalVarianceQty) || 1),
      totalCost: Math.abs(stk.totalVarianceAmount),
      notes: `اعتماد التسوية لأمر الجرد ${stk.orderNumber}`,
      occurredAt: 'الآن',
      isReversed: false,
    };

    setMovements([adjMov, ...movements]);
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">نظام إدارة المستودعات والمخزون (WMS)</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              المرحلة B: المناقلات المحمية والجرد الفعلي والتسويات
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            متابعة أرصدة المستودعات لحظياً، دورة المناقلات والشحن، تثبيت الأرصدة وتسجيل الجرد الفعلي، واعتماد تسويات الفروقات
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
            onClick={() => setIsStocktakeModalOpen(true)}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-xs shadow-amber-600/20"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>أمر جرد جديد</span>
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
          <span>المناقلات والشحن ({transfers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('STOCKTAKE')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'STOCKTAKE'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ClipboardCheck className="w-4 h-4" />
          <span>أوامر الجرد والتسويات ({stocktakes.length})</span>
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
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-slate-800">حركات المناقلات بين المستودعات والفروع (Stock Transfers Lifecycle)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                دورة تشغيلية متكاملة: حجز الرصيد عند الاعتماد، العزل في الطريق عند الشحن، واستلام جزئي/كلي مع رصد التوالف
              </p>
            </div>
            <button
              onClick={() => setIsTransferModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 border border-indigo-200"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>طلب مناقلة جديد</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">رقم المناقلة</th>
                  <th className="py-3 px-4">من مستودع</th>
                  <th className="py-3 px-4">إلى مستودع</th>
                  <th className="py-3 px-4 text-center">الأصناف</th>
                  <th className="py-3 px-4 text-center">الكمية المشحونة</th>
                  <th className="py-3 px-4 text-center">المستلم / التالف</th>
                  <th className="py-3 px-4 text-center">تاريخ الطلب</th>
                  <th className="py-3 px-4 text-center">الحالة التشغيلية</th>
                  <th className="py-3 px-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-xs text-indigo-600">
                      <div>{t.transferNumber}</div>
                      {t.notes && <div className="text-[11px] text-slate-400 font-sans truncate max-w-[140px]">{t.notes}</div>}
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium text-xs">{t.sourceWarehouseName}</td>
                    <td className="py-3 px-4 text-slate-700 font-medium text-xs">{t.destinationWarehouseName}</td>
                    <td className="py-3 px-4 text-center font-mono text-xs">{t.itemCount} صنف</td>
                    <td className="py-3 px-4 text-center font-mono text-xs font-bold text-slate-800">
                      {t.totalShippedQty || '—'}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-xs">
                      {t.status === 'RECEIVED' || t.status === 'PARTIALLY_RECEIVED' ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-emerald-700 font-bold">{t.totalReceivedQty || 0}</span>
                          {(t.totalDamagedQty || 0) > 0 && (
                            <span className="text-amber-600 bg-amber-50 px-1 rounded text-[11px]">
                              {t.totalDamagedQty} تالف
                            </span>
                          )}
                          {(t.totalLostQty || 0) > 0 && (
                            <span className="text-rose-600 bg-rose-50 px-1 rounded text-[11px]">
                              {t.totalLostQty} فاقد
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center text-xs text-slate-500 font-mono">{t.requestedAt}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          t.status === 'DRAFT'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : t.status === 'APPROVED'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                            : t.status === 'IN_TRANSIT'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : t.status === 'PARTIALLY_RECEIVED'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : t.status === 'RECEIVED'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : t.status === 'CLOSED'
                            ? 'bg-slate-100 text-slate-600 border border-slate-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {t.status === 'DRAFT' && 'مسودة (Draft)'}
                        {t.status === 'APPROVED' && 'معتمد للحجز (Approved)'}
                        {t.status === 'IN_TRANSIT' && 'في الطريق (In Transit)'}
                        {t.status === 'PARTIALLY_RECEIVED' && 'استلام جزئي (Partial)'}
                        {t.status === 'RECEIVED' && 'مستلم بالكامل (Received)'}
                        {t.status === 'CLOSED' && 'مغلق (Closed)'}
                        {t.status === 'REJECTED' && 'مرفوض (Rejected)'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {t.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => handleApproveTransfer(t.id)}
                              className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 border border-indigo-200"
                              title="اعتماد وحجز الرصيد"
                            >
                              اعتماد
                            </button>
                            <button
                              onClick={() => handleRejectTransfer(t.id)}
                              className="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 border border-rose-200"
                              title="رفض الطلب"
                            >
                              رفض
                            </button>
                          </>
                        )}
                        {t.status === 'APPROVED' && (
                          <button
                            onClick={() => handleDispatchTransfer(t.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs"
                            title="شحن البضاعة ونقلها إلى In-Transit"
                          >
                            <Truck className="w-3 h-3" />
                            <span>شحن وإرسال</span>
                          </button>
                        )}
                        {(t.status === 'IN_TRANSIT' || t.status === 'PARTIALLY_RECEIVED') && (
                          <>
                            <button
                              onClick={() => handleOpenReceiveModal(t)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs"
                              title="استلام وفحص الوارد"
                            >
                              <PackageCheck className="w-3 h-3" />
                              <span>استلام وفحص</span>
                            </button>
                            <button
                              onClick={() => handleCloseTransfer(t.id)}
                              className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200"
                              title="إغلاق المناقلة"
                            >
                              إغلاق
                            </button>
                          </>
                        )}
                        {(t.status === 'RECEIVED' || t.status === 'CLOSED' || t.status === 'REJECTED') && (
                          <span className="text-xs text-slate-400 font-medium">مكتمل</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Stocktaking & Physical Inventory */}
      {activeTab === 'STOCKTAKE' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-800">أوامر الجرد المخزني الفعلي والتسويات (Physical Stocktake Engine)</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  تثبيت الأرصدة الدفترية تلقائياً، تسجيل العد الفعلي، احتساب الفروقات، وتوليد قيود وحركات التسوية المحاسبية
                </p>
              </div>
              <button
                onClick={() => setIsStocktakeModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shadow-xs shadow-amber-600/20"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>أمر جرد جديد</span>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4">رقم الجرد</th>
                    <th className="py-3 px-4">المستودع الخاضع للجرد</th>
                    <th className="py-3 px-4 text-center">نوع الجرد</th>
                    <th className="py-3 px-4 text-center">التكرار</th>
                    <th className="py-3 px-4 text-center">تجميد الحركات</th>
                    <th className="py-3 px-4 text-center">الأصناف</th>
                    <th className="py-3 px-4 text-center">فرق الكميات</th>
                    <th className="py-3 px-4 text-center">قيمة الفرق (ر.س)</th>
                    <th className="py-3 px-4 text-center">حالة الجرد</th>
                    <th className="py-3 px-4 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {stocktakes.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-xs text-indigo-600">
                        <div>{s.orderNumber}</div>
                        <div className="text-[11px] text-slate-400 font-sans">{s.createdAt}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-800 font-medium text-xs">{s.warehouseName}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                          {s.stocktakeType === 'FULL' ? 'شامل (Full)' : 'جزئي (Partial)'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                          {s.countFrequency === 'PERIODIC' ? 'دوري' : 'مفاجئ'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {s.freezeMovements ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                            <Lock className="w-3 h-3" />
                            <span>مجمّد</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">غير مجمد</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs">
                        {s.countedCount > 0 ? `${s.countedCount} / ${s.itemCount}` : `${s.itemCount} صنف`}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs font-bold">
                        {s.status === 'COUNTED' || s.status === 'APPROVED' ? (
                          <span className={s.totalVarianceQty < 0 ? 'text-rose-600' : s.totalVarianceQty > 0 ? 'text-emerald-600' : 'text-slate-600'}>
                            {s.totalVarianceQty > 0 ? `+${s.totalVarianceQty}` : s.totalVarianceQty}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs font-bold">
                        {s.status === 'COUNTED' || s.status === 'APPROVED' ? (
                          <span className={s.totalVarianceAmount < 0 ? 'text-rose-600' : s.totalVarianceAmount > 0 ? 'text-emerald-600' : 'text-slate-600'}>
                            {s.totalVarianceAmount > 0 ? `+${s.totalVarianceAmount.toFixed(2)}` : s.totalVarianceAmount.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            s.status === 'DRAFT'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : s.status === 'IN_PROGRESS'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : s.status === 'COUNTED'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : s.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {s.status === 'DRAFT' && 'مسودة أمر جرد'}
                          {s.status === 'IN_PROGRESS' && 'جاري الحصر والعد'}
                          {s.status === 'COUNTED' && 'تم العد بانتظار الاعتماد'}
                          {s.status === 'APPROVED' && 'معتمد وتمت التسوية'}
                          {s.status === 'REJECTED' && 'مرفوض'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {s.status === 'DRAFT' && (
                            <button
                              onClick={() => handleStartStocktake(s.id)}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs"
                              title="بدء عملية الجرد وتثبيت اللقطة الدفترية للأرصدة"
                            >
                              بدء الجرد
                            </button>
                          )}
                          {s.status === 'IN_PROGRESS' && (
                            <button
                              onClick={() => handleOpenCountModal(s)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-xs"
                              title="إدخال الكميات الفعلية المحصورة"
                            >
                              <ClipboardCheck className="w-3 h-3" />
                              <span>تسجيل العد</span>
                            </button>
                          )}
                          {s.status === 'COUNTED' && (
                            <button
                              onClick={() => handleApproveStocktake(s.id)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs"
                              title="اعتماد الفروقات وتوليد حركة التسوية المخزنية"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>اعتماد التسوية</span>
                            </button>
                          )}
                          {s.status === 'APPROVED' && (
                            <span className="text-xs text-emerald-700 font-bold flex items-center justify-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>تمت التسوية</span>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                  إنشاء طلب المناقلة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 6: Receive & Inspect Transfer */}
      {selectedTransferForReceive && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-emerald-600" />
                <span>استلام وفحص شحنة المناقلة</span>
              </h3>
              <button onClick={() => setSelectedTransferForReceive(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1 text-slate-700 border border-slate-200">
              <div>رقم المناقلة: <b className="font-mono text-indigo-600">{selectedTransferForReceive.transferNumber}</b></div>
              <div>المسار: من <b>{selectedTransferForReceive.sourceWarehouseName}</b> إلى <b>{selectedTransferForReceive.destinationWarehouseName}</b></div>
              <div>إجمالي الكمية المشحونة: <b className="font-mono text-slate-900">{selectedTransferForReceive.totalShippedQty} وحدة</b></div>
            </div>

            <form onSubmit={handleConfirmReceiveTransfer} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-emerald-800 mb-1">الكمية السليمة</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={rcvTrfReceivedQty}
                    onChange={(e) => setRcvTrfReceivedQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-emerald-300 text-sm font-mono font-bold text-emerald-700 bg-emerald-50/30"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-amber-800 mb-1">الكمية التالفة</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={rcvTrfDamagedQty}
                    onChange={(e) => setRcvTrfDamagedQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 text-sm font-mono text-amber-700 bg-amber-50/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-rose-800 mb-1">عجز الشحن / فاقد</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={rcvTrfLostQty}
                    onChange={(e) => setRcvTrfLostQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-rose-300 text-sm font-mono text-rose-700 bg-rose-50/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ملاحظات ومحضر فحص الاستلام</label>
                <input
                  type="text"
                  placeholder="مثال: تم الفحص ووجد كرتون به تلف ناتج عن سوء التثبيت أثناء النقل"
                  value={rcvTrfNotes}
                  onChange={(e) => setRcvTrfNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>

              <div className="p-3 bg-indigo-50/60 rounded-xl text-xs text-indigo-900 border border-indigo-100">
                يتم خصم الكميات من الرصيد المنقول (In-Transit) وإضافة الكميات السليمة إلى الرصيد المتاح بالمستودع المستلم، مع إثبات التوالف في حسابات خسائر الشحن.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedTransferForReceive(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium shadow-xs hover:bg-emerald-700"
                >
                  تأكيد استلام الشحنة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 7: Create Stocktake Order */}
      {isStocktakeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-amber-600" />
                <span>إنشاء أمر جرد مخزني جديد</span>
              </h3>
              <button onClick={() => setIsStocktakeModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStocktake} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المستودع الخاضع للجرد</label>
                <select
                  value={stkWh}
                  onChange={(e) => setStkWh(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {warehouses
                    .filter((w) => w.id !== 'wh-all')
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">نطاق الجرد</label>
                  <select
                    value={stkType}
                    onChange={(e) => setStkType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  >
                    <option value="FULL">جرد شامل لجميع الأصناف (FULL)</option>
                    <option value="PARTIAL">جرد جزئي لأصناف محددة (PARTIAL)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">تكرار الجرد</label>
                  <select
                    value={stkFreq}
                    onChange={(e) => setStkFreq(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  >
                    <option value="PERIODIC">جرد دوري مجدول (PERIODIC)</option>
                    <option value="SURPRISE">جرد مفاجئ رقابي (SURPRISE)</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stkFreeze}
                    onChange={(e) => setStkFreeze(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <span>تجميد حركات الصرف والتوريد على المستودع أثناء الجرد (Freeze Movements)</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ملاحظات وتعليمات الجرد</label>
                <input
                  type="text"
                  placeholder="مثال: جرد نهاية الشهر لقسم البروتينات والمشروبات"
                  value={stkNotes}
                  onChange={(e) => setStkNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsStocktakeModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium shadow-xs hover:bg-amber-700"
                >
                  إنشاء أمر الجرد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 8: Record Physical Count */}
      {selectedStocktakeForCount && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                <span>تسجيل العد الفعلي لجرد المخزون ({selectedStocktakeForCount.orderNumber})</span>
              </h3>
              <button onClick={() => setSelectedStocktakeForCount(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-500">
              أدخل الكمية الفعلية المحصورة يدوياً في المستودع. يتم حساب الفروقات المالية والكمية فوراً.
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-2.5 px-3">الصنف</th>
                    <th className="py-2.5 px-3 text-center">الرصيد الدفتري</th>
                    <th className="py-2.5 px-3 text-center">العد الفعلي</th>
                    <th className="py-2.5 px-3 text-center">فرق الكمية</th>
                    <th className="py-2.5 px-3 text-left">أثر القيمة (ر.س)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {countedItems.map((item, idx) => {
                    const diff = item.countQty - item.sysQty;
                    const valDiff = diff * item.unitCost;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-800">{item.name}</div>
                          <span className="font-mono text-slate-400">{item.sku}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-700">{item.sysQty}</td>
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="number"
                            step="any"
                            value={item.countQty}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const updated = [...countedItems];
                              updated[idx].countQty = val;
                              setCountedItems(updated);
                            }}
                            className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-center font-mono font-bold"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold">
                          <span className={diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                            {diff > 0 ? `+${diff}` : diff}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-left font-mono font-bold">
                          <span className={valDiff < 0 ? 'text-rose-600' : valDiff > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                            {valDiff > 0 ? `+${valDiff.toFixed(2)}` : valDiff.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-amber-50/70 rounded-xl text-xs text-amber-900 border border-amber-200">
              بعد حفظ العد، سيتحول أمر الجرد إلى حالة <b>تم العد (COUNTED)</b> ليقوم المدير المالي أو مدير العمليات بمراجعة الفروقات واعتماد التسوية.
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedStocktakeForCount(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveStocktakeCount}
                className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-xs hover:bg-indigo-700"
              >
                حفظ نتائج العد الفعلي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
