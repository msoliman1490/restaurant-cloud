import { useState, useRef } from 'react';
import {
  Plus,
  Search,
  Check,
  X,
  Edit2,
  Trash2,
  Archive,
  RotateCcw,
  DollarSign,
  TrendingUp,
  Image as ImageIcon,
  Camera,
  Layers,
  Tag,
  AlertTriangle,
  LayoutGrid,
  List,
  Upload,
  Info,
} from 'lucide-react';
import { ProductItem, Category } from '../types';

const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-all', code: 'ALL', nameAr: 'جميع الأصناف', nameEn: 'All Categories', displayOrder: 0, isActive: true },
  { id: 'cat-1', code: 'BURGERS', nameAr: 'برجر وساندوتشات', nameEn: 'Burgers & Sandwiches', displayOrder: 1, isActive: true },
  { id: 'cat-2', code: 'PIZZA', nameAr: 'بيتزا ومعجنات', nameEn: 'Pizza & Bakery', displayOrder: 2, isActive: true },
  { id: 'cat-3', code: 'DRINKS', nameAr: 'مشروبات وعصائر', nameEn: 'Beverages & Juices', displayOrder: 3, isActive: true },
  { id: 'cat-4', code: 'DESSERTS', nameAr: 'حلويات وآيس كريم', nameEn: 'Desserts', displayOrder: 4, isActive: true },
  { id: 'cat-5', code: 'RAW_ING', nameAr: 'مواد أولية ومكونات', nameEn: 'Raw Ingredients', displayOrder: 5, isActive: true },
];

const PRODUCT_TYPES = [
  { value: 'SALEABLE', labelAr: 'منتج جاهز للبيع (Saleable)', desc: 'وجبات وأصناف مباشرة للعملاء' },
  { value: 'MANUFACTURED', labelAr: 'منتج تصنيع داخلي (Manufactured)', desc: 'يُنتج عبر وصفات بالمطبخ المركزي' },
  { value: 'SEMI_FINISHED', labelAr: 'نصف مصنّع (Semi-Finished)', desc: 'صلصات وعجائن تُحضر مسبقاً' },
  { value: 'RAW_MATERIAL', labelAr: 'مادة خام (Raw Material)', desc: 'لحوم، خضروات، زيوت تستخدم بالطبخ' },
  { value: 'COMPOSITE_BUNDLE', labelAr: 'باقة كومبو مجمعة (Bundle)', desc: 'وجبة متكاملة تضم عدة أصناف' },
  { value: 'SERVICE', labelAr: 'خدمة (Service)', desc: 'توصيل، رسوم خدمة، حفلات' },
  { value: 'NON_INVENTORY', labelAr: 'غير مخزني (Non-Inventory)', desc: 'أدوات استهلاكية ومطبوعات' },
];

const INITIAL_PRODUCTS: ProductItem[] = [
  {
    id: 'prod-1',
    sku: 'BRG-001',
    barcode: '62810001001',
    barcodes: [
      { barcode: '62810001001', barcodeType: 'EAN13', isPrimary: true },
      { barcode: 'BRG-001-ALT', barcodeType: 'CODE128', isPrimary: false },
    ],
    nameAr: 'برجر أنجوس كلاسيك',
    nameEn: 'Angus Classic Burger',
    description: 'شريحة لحم أنجوس فاخر مع جبن شيدر ذائب وصوص أنجوس السري بخبز البريوش الطازج',
    categoryId: 'cat-1',
    categoryName: 'برجر وساندوتشات',
    productType: 'SALEABLE',
    baseUom: 'PCS (حبة)',
    defaultCost: 14.5,
    defaultPrice: 35.0,
    taxRate: 0.15,
    minStockLevel: 20,
    maxStockLevel: 200,
    isSold: true,
    isPurchased: false,
    isRecipeIngredient: false,
    isActive: true,
    isArchived: false,
    primaryImageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&auto=format&fit=crop&q=60',
    onHandQty: 145,
  },
  {
    id: 'prod-2',
    sku: 'BRG-002',
    barcode: '62810001002',
    barcodes: [{ barcode: '62810001002', barcodeType: 'EAN13', isPrimary: true }],
    nameAr: 'برجر دجاج كرسبي مقرمش',
    nameEn: 'Crispy Chicken Burger',
    description: 'صدر دجاج مقرمش متبل بخلطة الأعشاب مع سلطة كول سلو وصلصة المايونيز الحار',
    categoryId: 'cat-1',
    categoryName: 'برجر وساندوتشات',
    productType: 'SALEABLE',
    baseUom: 'PCS (حبة)',
    defaultCost: 11.0,
    defaultPrice: 28.0,
    taxRate: 0.15,
    minStockLevel: 15,
    maxStockLevel: 150,
    isSold: true,
    isPurchased: false,
    isRecipeIngredient: false,
    isActive: true,
    isArchived: false,
    primaryImageUrl: 'https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?w=400&auto=format&fit=crop&q=60',
    onHandQty: 82,
  },
  {
    id: 'prod-3',
    sku: 'RAW-BEEF',
    barcode: '62810009001',
    barcodes: [{ barcode: '62810009001', barcodeType: 'CODE128', isPrimary: true }],
    nameAr: 'لحم بقري أنجوس مفروم (خام)',
    nameEn: 'Minced Angus Beef Raw',
    description: 'مادة خام مستوردة تستخدم في تشكيل أقراص البرجر بالمطبخ المركزي',
    categoryId: 'cat-5',
    categoryName: 'مواد أولية ومكونات',
    productType: 'RAW_MATERIAL',
    baseUom: 'KG (كيلوجرام)',
    defaultCost: 38.0,
    defaultPrice: 0.0,
    taxRate: 0.15,
    minStockLevel: 50,
    maxStockLevel: 500,
    isSold: false,
    isPurchased: true,
    isRecipeIngredient: true,
    isActive: true,
    isArchived: false,
    onHandQty: 320,
  },
];

export const CatalogView: React.FC = () => {
  const [products, setProducts] = useState<ProductItem[]>(INITIAL_PRODUCTS);
  const [selectedCategory, setSelectedCategory] = useState<string>('cat-all');
  const [selectedProductType, setSelectedProductType] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  // Modals state
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'pricing' | 'inventory' | 'media'>('basic');

  // Dedicated Price Change Modal
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [targetProductForPrice, setTargetProductForPrice] = useState<ProductItem | null>(null);
  const [newPriceValue, setNewPriceValue] = useState('');
  const [priceChangeReason, setPriceChangeReason] = useState('');

  // Dedicated Cost Change Modal
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [targetProductForCost, setTargetProductForCost] = useState<ProductItem | null>(null);
  const [newCostValue, setNewCostValue] = useState('');
  const [costChangeReason, setCostChangeReason] = useState('');

  // Delete / Rejection Alert Modal
  const [deleteAlertModal, setDeleteAlertModal] = useState<{
    isOpen: boolean;
    product: ProductItem | null;
    isBlocked: boolean;
    message: string;
  }>({
    isOpen: false,
    product: null,
    isBlocked: false,
    message: '',
  });

  // Product Form State
  const [formData, setFormData] = useState({
    sku: '',
    nameAr: '',
    nameEn: '',
    description: '',
    categoryId: 'cat-1',
    productType: 'SALEABLE',
    barcode: '',
    barcodesList: [] as Array<{ barcode: string; barcodeType: string; isPrimary: boolean }>,
    baseUom: 'PCS (حبة)',
    defaultCost: '10.00',
    defaultPrice: '25.00',
    taxRate: '0.15',
    minStockLevel: '10',
    maxStockLevel: '100',
    isSold: true,
    isPurchased: true,
    isRecipeIngredient: false,
    isActive: true,
    primaryImageUrl: '',
    galleryImages: [] as string[],
  });

  // New barcode field in form
  const [tempBarcode, setTempBarcode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filtered list
  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === 'cat-all' || p.categoryId === selectedCategory;
    const matchesType = selectedProductType === 'ALL' || p.productType === selectedProductType;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && p.isActive && !p.isArchived) ||
      (statusFilter === 'ARCHIVED' && p.isArchived);

    const matchesSearch =
      p.nameAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery));

    return matchesCategory && matchesType && matchesStatus && matchesSearch;
  });

  const resetForm = () => {
    setFormData({
      sku: '',
      nameAr: '',
      nameEn: '',
      description: '',
      categoryId: 'cat-1',
      productType: 'SALEABLE',
      barcode: '',
      barcodesList: [],
      baseUom: 'PCS (حبة)',
      defaultCost: '10.00',
      defaultPrice: '25.00',
      taxRate: '0.15',
      minStockLevel: '10',
      maxStockLevel: '100',
      isSold: true,
      isPurchased: true,
      isRecipeIngredient: false,
      isActive: true,
      primaryImageUrl: '',
      galleryImages: [],
    });
    setTempBarcode('');
    setActiveTab('basic');
    setEditingProductId(null);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setModalMode('create');
    setIsProductModalOpen(true);
  };

  const handleOpenEditModal = (product: ProductItem) => {
    setFormData({
      sku: product.sku,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      description: product.description || '',
      categoryId: product.categoryId,
      productType: product.productType || 'SALEABLE',
      barcode: product.barcode || '',
      barcodesList: product.barcodes || (product.barcode ? [{ barcode: product.barcode, barcodeType: 'EAN13', isPrimary: true }] : []),
      baseUom: product.baseUom,
      defaultCost: product.defaultCost.toString(),
      defaultPrice: product.defaultPrice.toString(),
      taxRate: product.taxRate.toString(),
      minStockLevel: (product.minStockLevel ?? 0).toString(),
      maxStockLevel: (product.maxStockLevel ?? '').toString(),
      isSold: product.isSold ?? true,
      isPurchased: product.isPurchased ?? true,
      isRecipeIngredient: product.isRecipeIngredient ?? false,
      isActive: product.isActive,
      primaryImageUrl: product.primaryImageUrl || '',
      galleryImages: product.primaryImageUrl ? [product.primaryImageUrl] : [],
    });
    setEditingProductId(product.id);
    setModalMode('edit');
    setActiveTab('basic');
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sku || !formData.nameAr || !formData.nameEn) {
      alert('يرجى ملء الحقول الإلزامية: رمز SKU واسم الصنف بالعربية والإنجليزية');
      return;
    }

    const cat = INITIAL_CATEGORIES.find((c) => c.id === formData.categoryId);

    if (modalMode === 'create') {
      const newProd: ProductItem = {
        id: `prod-${Date.now()}`,
        sku: formData.sku.toUpperCase(),
        barcode: formData.barcode || formData.barcodesList[0]?.barcode,
        barcodes: formData.barcodesList,
        nameAr: formData.nameAr,
        nameEn: formData.nameEn,
        description: formData.description,
        categoryId: formData.categoryId,
        categoryName: cat?.nameAr ?? 'عام',
        productType: formData.productType,
        baseUom: formData.baseUom,
        defaultCost: parseFloat(formData.defaultCost) || 0,
        defaultPrice: parseFloat(formData.defaultPrice) || 0,
        taxRate: parseFloat(formData.taxRate) || 0.15,
        minStockLevel: parseFloat(formData.minStockLevel) || 0,
        maxStockLevel: parseFloat(formData.maxStockLevel) || undefined,
        isSold: formData.isSold,
        isPurchased: formData.isPurchased,
        isRecipeIngredient: formData.isRecipeIngredient,
        isActive: formData.isActive,
        isArchived: false,
        primaryImageUrl: formData.primaryImageUrl || formData.galleryImages[0],
        onHandQty: 0,
      };

      setProducts([newProd, ...products]);
    } else if (modalMode === 'edit' && editingProductId) {
      setProducts(
        products.map((p) => {
          if (p.id !== editingProductId) return p;
          return {
            ...p,
            sku: formData.sku.toUpperCase(),
            barcode: formData.barcode || formData.barcodesList[0]?.barcode,
            barcodes: formData.barcodesList,
            nameAr: formData.nameAr,
            nameEn: formData.nameEn,
            description: formData.description,
            categoryId: formData.categoryId,
            categoryName: cat?.nameAr ?? p.categoryName,
            productType: formData.productType,
            baseUom: formData.baseUom,
            // Notice: defaultPrice and defaultCost are managed via dedicated permission modals
            taxRate: parseFloat(formData.taxRate) || 0.15,
            minStockLevel: parseFloat(formData.minStockLevel) || 0,
            maxStockLevel: parseFloat(formData.maxStockLevel) || undefined,
            isSold: formData.isSold,
            isPurchased: formData.isPurchased,
            isRecipeIngredient: formData.isRecipeIngredient,
            isActive: formData.isActive,
            primaryImageUrl: formData.primaryImageUrl || formData.galleryImages[0],
          };
        })
      );
    }

    setIsProductModalOpen(false);
    resetForm();
  };

  // Add barcode to list
  const handleAddBarcode = () => {
    if (!tempBarcode.trim()) return;
    const exists = formData.barcodesList.some((b) => b.barcode === tempBarcode.trim());
    if (exists) {
      alert('الباركود مضاف مسبقاً');
      return;
    }
    const isFirst = formData.barcodesList.length === 0;
    setFormData({
      ...formData,
      barcodesList: [
        ...formData.barcodesList,
        { barcode: tempBarcode.trim(), barcodeType: 'CODE128', isPrimary: isFirst },
      ],
      barcode: isFirst ? tempBarcode.trim() : formData.barcode,
    });
    setTempBarcode('');
  };

  const handleRemoveBarcode = (code: string) => {
    const updated = formData.barcodesList.filter((b) => b.barcode !== code);
    setFormData({
      ...formData,
      barcodesList: updated,
      barcode: updated[0]?.barcode || '',
    });
  };

  // Image Upload handler simulation
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert('حجم الصورة يتجاوز الحد الأقصى المسموح (5 ميجابايت)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const resultUrl = event.target?.result as string;
      const updatedGallery = [...formData.galleryImages, resultUrl];
      setFormData({
        ...formData,
        galleryImages: updatedGallery,
        primaryImageUrl: formData.primaryImageUrl || resultUrl,
      });
    };
    reader.readAsDataURL(file);
  };

  // Dedicated Price Change
  const handleOpenPriceModal = (product: ProductItem) => {
    setTargetProductForPrice(product);
    setNewPriceValue(product.defaultPrice.toString());
    setPriceChangeReason('');
    setIsPriceModalOpen(true);
  };

  const handleApplyPriceChange = () => {
    if (!targetProductForPrice) return;
    const priceNum = parseFloat(newPriceValue);
    if (isNaN(priceNum) || priceNum < 0) {
      alert('يرجى إدخال سعر بيع صحيح');
      return;
    }

    setProducts(
      products.map((p) => {
        if (p.id !== targetProductForPrice.id) return p;
        return { ...p, defaultPrice: priceNum };
      })
    );

    setIsPriceModalOpen(false);
    setTargetProductForPrice(null);
  };

  // Dedicated Cost Change
  const handleOpenCostModal = (product: ProductItem) => {
    setTargetProductForCost(product);
    setNewCostValue(product.defaultCost.toString());
    setCostChangeReason('');
    setIsCostModalOpen(true);
  };

  const handleApplyCostChange = () => {
    if (!targetProductForCost) return;
    const costNum = parseFloat(newCostValue);
    if (isNaN(costNum) || costNum < 0) {
      alert('يرجى إدخال تكلفة مرجعية صحيحة');
      return;
    }

    setProducts(
      products.map((p) => {
        if (p.id !== targetProductForCost.id) return p;
        return { ...p, defaultCost: costNum };
      })
    );

    setIsCostModalOpen(false);
    setTargetProductForCost(null);
  };

  // Archive / Restore
  const handleToggleArchive = (product: ProductItem) => {
    const isArchiving = !product.isArchived;
    setProducts(
      products.map((p) => {
        if (p.id !== product.id) return p;
        return {
          ...p,
          isArchived: isArchiving,
          isActive: isArchiving ? false : true,
        };
      })
    );
  };

  // Conditional Delete
  const handleDeleteAttempt = (product: ProductItem) => {
    // If product has onHandQty or is used as ingredient or is historical item
    const hasHistoricalMovements = (product.onHandQty ?? 0) > 0 || product.isRecipeIngredient;

    if (hasHistoricalMovements) {
      setDeleteAlertModal({
        isOpen: true,
        product,
        isBlocked: true,
        message: `لا يمكن حذف الصنف '${product.nameAr}' (${product.sku}) لوجود حركات وعمليات تاريخية أو أرصدة مخزنية مرتبطة به (${product.onHandQty ?? 0} وحدة بالمخزون). يرجى أرشفة الصنف بدلاً من الحذف للحفاظ على سلامة القيود والبيانات المالية.`,
      });
    } else {
      setDeleteAlertModal({
        isOpen: true,
        product,
        isBlocked: false,
        message: `هل أنت متأكد من الحذف النهائي للصنف '${product.nameAr}'؟ هذه العملية لا رجعة فيها وسيتم حذف كافة الباركودات والصور المرتبطة به.`,
      });
    }
  };

  const handleConfirmDelete = () => {
    if (!deleteAlertModal.product || deleteAlertModal.isBlocked) return;
    setProducts(products.filter((p) => p.id !== deleteAlertModal.product!.id));
    setDeleteAlertModal({ isOpen: false, product: null, isBlocked: false, message: '' });
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-800">إدارة كتالوج الأصناف والمنتجات</h2>
            <span className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-indigo-200">
              إجمالي {products.length} صنف
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            إدارة متكاملة للأصناف، الباركودات المتعددة، معرض الصور، وتعديل الأسعار والتكاليف بحسب الصلاحيات
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'table' ? 'bg-white shadow-xs text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="عرض كجدول"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-white shadow-xs text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="عرض كبطاقات"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة صنف جديد</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث بالاسم، رمز SKU، أو الباركود..."
              className="w-full pl-4 pr-10 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            />
          </div>

          {/* Product Type Filter Dropdown & Status Filter */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <select
              value={selectedProductType}
              onChange={(e) => setSelectedProductType(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="ALL">جميع أنواع المنتجات</option>
              {PRODUCT_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>
                  {pt.labelAr}
                </option>
              ))}
            </select>

            <div className="bg-slate-100 p-0.5 rounded-xl flex items-center border border-slate-200 text-xs font-medium">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === 'ALL' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'
                }`}
              >
                الكل ({products.length})
              </button>
              <button
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === 'ACTIVE' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500'
                }`}
              >
                النشطة
              </button>
              <button
                onClick={() => setStatusFilter('ARCHIVED')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === 'ARCHIVED' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-500'
                }`}
              >
                المؤرشفة
              </button>
            </div>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-t border-slate-100 pt-3">
          {INITIAL_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === c.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {c.nameAr}
            </button>
          ))}
        </div>
      </div>

      {/* Products Display (Table or Grid) */}
      {viewMode === 'table' ? (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">الصورة</th>
                  <th className="py-3 px-4">رمز الصنف (SKU)</th>
                  <th className="py-3 px-4">اسم الصنف والباركود</th>
                  <th className="py-3 px-4">النوع والتصنيف</th>
                  <th className="py-3 px-4 text-left">التكلفة</th>
                  <th className="py-3 px-4 text-left">سعر البيع الأساسي</th>
                  <th className="py-3 px-4 text-left">السعر بالضريبة (15%)</th>
                  <th className="py-3 px-4 text-center">المخزون</th>
                  <th className="py-3 px-4 text-center">الحالة</th>
                  <th className="py-3 px-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredProducts.map((p) => {
                  const priceWithVat = (p.defaultPrice * (1 + p.taxRate)).toFixed(2);
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        p.isArchived ? 'bg-slate-50/40 opacity-75' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                          {p.primaryImageUrl ? (
                            <img src={p.primaryImageUrl} alt={p.nameAr} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-medium text-xs text-slate-700">
                        {p.sku}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800">{p.nameAr}</div>
                        <div className="text-xs text-slate-400 font-sans">{p.nameEn}</div>
                        {p.barcode && (
                          <div className="text-xs font-mono text-indigo-600 mt-0.5">
                            📊 {p.barcode}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                            {p.categoryName || 'عام'}
                          </span>
                          <div>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                              {p.productType || 'SALEABLE'}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-left font-mono text-slate-600">
                        {p.defaultCost.toFixed(2)} ر.س
                      </td>

                      <td className="py-3.5 px-4 text-left font-mono font-semibold text-slate-900">
                        {p.defaultPrice.toFixed(2)} ر.س
                      </td>

                      <td className="py-3.5 px-4 text-left font-mono font-semibold text-emerald-600">
                        {priceWithVat} ر.س
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            (p.onHandQty ?? 0) > 20
                              ? 'bg-emerald-50 text-emerald-700'
                              : (p.onHandQty ?? 0) > 0
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {p.onHandQty ?? 0} {p.baseUom.split(' ')[0]}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {p.isArchived ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                            <Archive className="w-3 h-3" /> مؤرشف
                          </span>
                        ) : p.isActive ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                            <Check className="w-3 h-3" /> نشط
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                            <X className="w-3 h-3" /> معطل
                          </span>
                        )}
                      </td>

                      {/* Operations Actions Dropdown / Buttons */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Edit Metadata */}
                          <button
                            onClick={() => handleOpenEditModal(p)}
                            title="تعديل المواصفات العامة (item.update)"
                            className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Dedicated Price Change */}
                          <button
                            onClick={() => handleOpenPriceModal(p)}
                            title="تغيير سعر البيع (item.change_price)"
                            className="p-1.5 rounded-lg text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>

                          {/* Dedicated Cost Change */}
                          <button
                            onClick={() => handleOpenCostModal(p)}
                            title="تغيير التكلفة المرجعية (item.change_cost)"
                            className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <TrendingUp className="w-4 h-4" />
                          </button>

                          {/* Archive / Restore Toggle */}
                          <button
                            onClick={() => handleToggleArchive(p)}
                            title={p.isArchived ? 'استعادة الصنف (item.restore)' : 'أرشفة الصنف (item.archive)'}
                            className={`p-1.5 rounded-lg transition-colors ${
                              p.isArchived
                                ? 'text-amber-600 hover:bg-amber-50'
                                : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50'
                            }`}
                          >
                            {p.isArchived ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteAttempt(p)}
                            title="حذف الصنف (item.delete)"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Grid / Card View */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredProducts.map((p) => {
            const priceWithVat = (p.defaultPrice * (1 + p.taxRate)).toFixed(2);
            return (
              <div
                key={p.id}
                className={`bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow ${
                  p.isArchived ? 'opacity-70' : ''
                }`}
              >
                <div>
                  <div className="h-40 bg-slate-100 relative overflow-hidden flex items-center justify-center">
                    {p.primaryImageUrl ? (
                      <img src={p.primaryImageUrl} alt={p.nameAr} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-10 h-10 text-slate-300" />
                    )}
                    <span className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-mono px-2 py-0.5 rounded-md">
                      {p.sku}
                    </span>
                    {p.isArchived && (
                      <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md">
                        مؤرشف
                      </span>
                    )}
                  </div>

                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        {p.categoryName}
                      </span>
                      <span className="text-[10px] font-mono text-indigo-600">{p.barcode}</span>
                    </div>

                    <h3 className="font-bold text-slate-800 text-base line-clamp-1">{p.nameAr}</h3>
                    <p className="text-xs text-slate-400 font-sans line-clamp-1">{p.nameEn}</p>

                    <div className="pt-2 flex items-baseline justify-between border-t border-slate-100">
                      <div>
                        <span className="text-lg font-bold text-emerald-600 font-mono">{priceWithVat}</span>
                        <span className="text-xs text-slate-500 mr-1">ر.س بالضريبة</span>
                      </div>
                      <div className="text-left font-mono text-xs text-slate-500">
                        تكلفة: {p.defaultCost.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">
                    مخزون: {p.onHandQty ?? 0}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenPriceModal(p)}
                      title="تغيير السعر"
                      className="p-1 rounded text-emerald-600 hover:bg-emerald-100"
                    >
                      <DollarSign className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleOpenEditModal(p)}
                      title="تعديل المواصفات"
                      className="p-1 rounded text-indigo-600 hover:bg-indigo-100"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteAttempt(p)}
                      title="حذف"
                      className="p-1 rounded text-rose-500 hover:bg-rose-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 1. Modal: Full Product Add / Edit (Tabbed Enterprise Architecture)    */}
      {/* ==================================================================== */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  {modalMode === 'create' ? 'إضافة صنف جديد للكتالوج' : `تعديل الصنف: ${formData.nameAr}`}
                </h3>
                <p className="text-xs text-slate-500">
                  {modalMode === 'create'
                    ? 'أدخل بيانات الصنف، الباركودات، الأسعار، والمواصفات المخزنية'
                    : 'تعديل المواصفات الفنية مع خضوع الأسعار والتكلفة للصلاحيات المنفصلة'}
                </p>
              </div>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-100/60 px-4 pt-2 gap-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('basic')}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-xl transition-colors border-b-2 ${
                  activeTab === 'basic'
                    ? 'border-indigo-600 bg-white text-indigo-700 shadow-xs'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Tag className="w-3.5 h-3.5" />
                <span>1. البيانات الأساسية والباركود</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('pricing')}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-xl transition-colors border-b-2 ${
                  activeTab === 'pricing'
                    ? 'border-indigo-600 bg-white text-indigo-700 shadow-xs'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <DollarSign className="w-3.5 h-3.5" />
                <span>2. التسعير والتكلفة والضرائب</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('inventory')}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-xl transition-colors border-b-2 ${
                  activeTab === 'inventory'
                    ? 'border-indigo-600 bg-white text-indigo-700 shadow-xs'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>3. المخزون والوحدات</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('media')}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-xl transition-colors border-b-2 ${
                  activeTab === 'media'
                    ? 'border-indigo-600 bg-white text-indigo-700 shadow-xs'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>4. معرض الصور والملفات</span>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveProduct} className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* TAB 1: BASIC INFORMATION & BARCODES */}
              {activeTab === 'basic' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        رمز الصنف (SKU) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.sku}
                        onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                        placeholder="e.g. BRG-001"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        نوع المنتج (Product Type) <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={formData.productType}
                        onChange={(e) => setFormData({ ...formData, productType: e.target.value })}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      >
                        {PRODUCT_TYPES.map((pt) => (
                          <option key={pt.value} value={pt.value}>
                            {pt.labelAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        اسم الصنف (بالعربية) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.nameAr}
                        onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
                        placeholder="مثال: برجر دجاج كلاسيك"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        اسم الصنف (بالإنجليزية) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.nameEn}
                        onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                        placeholder="e.g. Classic Chicken Burger"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-sans focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        التصنيف الرئيسي (Category) <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={formData.categoryId}
                        onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      >
                        {INITIAL_CATEGORIES.filter((c) => c.id !== 'cat-all').map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nameAr} ({c.nameEn})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        الوحدة الأساسية (Base UoM)
                      </label>
                      <select
                        value={formData.baseUom}
                        onChange={(e) => setFormData({ ...formData, baseUom: e.target.value })}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      >
                        <option value="PCS (حبة)">PCS (حبة)</option>
                        <option value="KG (كيلوجرام)">KG (كيلوجرام)</option>
                        <option value="G (جرام)">G (جرام)</option>
                        <option value="L (لتر)">L (لتر)</option>
                        <option value="ML (مليلتر)">ML (مليلتر)</option>
                        <option value="BOX (صندوق/كرتون)">BOX (صندوق/كرتون)</option>
                      </select>
                    </div>
                  </div>

                  {/* Multiple Barcodes Management */}
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                    <label className="block text-xs font-semibold text-slate-700">
                      إدارة الباركودات المتعددة (Primary & Alternative Barcodes)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tempBarcode}
                        onChange={(e) => setTempBarcode(e.target.value)}
                        placeholder="أدخل الباركود واضغط إضافة..."
                        className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono bg-white focus:ring-2 focus:ring-indigo-500/20"
                      />
                      <button
                        type="button"
                        onClick={handleAddBarcode}
                        className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
                      >
                        إضافة باركود
                      </button>
                    </div>

                    {formData.barcodesList.length > 0 ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {formData.barcodesList.map((b, idx) => (
                          <span
                            key={idx}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-mono ${
                              b.isPrimary
                                ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                : 'bg-white text-slate-700 border border-slate-200'
                            }`}
                          >
                            <span>{b.barcode}</span>
                            {b.isPrimary && <span className="text-[10px] bg-indigo-600 text-white px-1.5 rounded">رئيسي</span>}
                            <button
                              type="button"
                              onClick={() => handleRemoveBarcode(b.barcode)}
                              className="text-slate-400 hover:text-rose-600"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">لا توجد باركودات مسجلة بعد</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      الوصف التسويقي أو الفني
                    </label>
                    <textarea
                      rows={3}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="أدخل وصفًا تفصيليًا للمكونات أو طريقة التقديم..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>
              )}

              {/* TAB 2: PRICING, COSTS & TAXES */}
              {activeTab === 'pricing' && (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl flex items-start gap-2 text-xs text-amber-800">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <span className="font-bold">فصل الصلاحيات المحاسبية:</span> تعديل الأسعار والتكاليف يخضع لسجل تدقيق غير قابل للتعديل (Audit Log) وصلاحيات مخصصة (<code>item.change_price</code> و<code>item.change_cost</code>).
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        سعر البيع الأساسي (بدون ضريبة)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.defaultPrice}
                        onChange={(e) => setFormData({ ...formData, defaultPrice: e.target.value })}
                        disabled={modalMode === 'edit'}
                        className={`w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono ${
                          modalMode === 'edit' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                        }`}
                      />
                      {modalMode === 'edit' && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          استخدم زر (تعديل السعر $) في الجدول لتغيير السعر بصلاحية مستقلة.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        التكلفة المرجعية للشراء/الإنتاج
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.defaultCost}
                        onChange={(e) => setFormData({ ...formData, defaultCost: e.target.value })}
                        disabled={modalMode === 'edit'}
                        className={`w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono ${
                          modalMode === 'edit' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                        }`}
                      />
                      {modalMode === 'edit' && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          استخدم زر (تعديل التكلفة 📈) في الجدول لتسجيل مبرر تغيير التكلفة.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        نسبة ضريبة القيمة المضافة (VAT Rate)
                      </label>
                      <select
                        value={formData.taxRate}
                        onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="0.15">15% (النسبة القياسية بالسعودية)</option>
                        <option value="0.00">0% (معفى من الضريبة)</option>
                      </select>
                    </div>

                    {/* Instant Calculator Preview Card */}
                    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex flex-col justify-center">
                      <span className="text-xs text-emerald-800 font-semibold">
                        السعر النهائي شامل الضريبة (فاتورة العميل):
                      </span>
                      <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
                        {(
                          (parseFloat(formData.defaultPrice) || 0) *
                          (1 + (parseFloat(formData.taxRate) || 0.15))
                        ).toFixed(2)}{' '}
                        ر.س
                      </div>
                      <span className="text-[11px] text-emerald-600 mt-0.5">
                        مقدار الضريبة: {(
                          (parseFloat(formData.defaultPrice) || 0) *
                          (parseFloat(formData.taxRate) || 0.15)
                        ).toFixed(2)} ر.س
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: INVENTORY POLICIES & THRESHOLDS */}
              {activeTab === 'inventory' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        الحد الأدنى للمخزون (نقطة إعادة الطلب)
                      </label>
                      <input
                        type="number"
                        value={formData.minStockLevel}
                        onChange={(e) => setFormData({ ...formData, minStockLevel: e.target.value })}
                        placeholder="10"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        الحد الأقصى للمخزون
                      </label>
                      <input
                        type="number"
                        value={formData.maxStockLevel}
                        onChange={(e) => setFormData({ ...formData, maxStockLevel: e.target.value })}
                        placeholder="100"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                    <span className="block text-xs font-bold text-slate-700">خصائص الاستخدام التشغيلي:</span>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isSold}
                        onChange={(e) => setFormData({ ...formData, isSold: e.target.checked })}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      <span className="text-sm text-slate-700">صنف متاح للبيع في نقاط البيع والتطبيقات (POS / Online)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isPurchased}
                        onChange={(e) => setFormData({ ...formData, isPurchased: e.target.checked })}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      <span className="text-sm text-slate-700">صنف قابل للشراء بأوامر الشراء من الموردين (Purchasable)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isRecipeIngredient}
                        onChange={(e) => setFormData({ ...formData, isRecipeIngredient: e.target.checked })}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      <span className="text-sm text-slate-700">مكون يدخل في وصفات تصنيع المطبخ (Recipe Ingredient)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      <span className="text-sm text-slate-700">تفعيل الصنف في النظام (Active)</span>
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 4: MEDIA & GALLERY */}
              {activeTab === 'media' && (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-indigo-500 transition-colors bg-slate-50">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageFileChange}
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      className="hidden"
                    />

                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <Upload className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-slate-700">
                        اسحب وأفلت الصور هنا، أو اضغط للاختيار من جهازك
                      </p>
                      <p className="text-xs text-slate-400">
                        يدعم صيغ JPG، PNG، WEBP، SVG بحد أقصى 5 ميجابايت لكل ملف
                      </p>

                      <div className="flex items-center gap-3 mt-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs"
                        >
                          اختيار ملف من الجهاز
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>التقاط بالكاميرا</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Gallery Preview Grid */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 mb-2">معرض صور الصنف (Gallery):</h4>
                    {formData.galleryImages.length > 0 ? (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {formData.galleryImages.map((imgUrl, idx) => {
                          const isPrimary = formData.primaryImageUrl === imgUrl;
                          return (
                            <div
                              key={idx}
                              className={`relative rounded-xl overflow-hidden border-2 aspect-square group ${
                                isPrimary ? 'border-indigo-600 ring-2 ring-indigo-500/20' : 'border-slate-200'
                              }`}
                            >
                              <img src={imgUrl} alt="Product media" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                                {!isPrimary && (
                                  <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, primaryImageUrl: imgUrl })}
                                    className="bg-white text-indigo-700 text-[10px] font-bold px-2 py-1 rounded shadow-xs"
                                  >
                                    تعيين كرئيسية
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = formData.galleryImages.filter((_, i) => i !== idx);
                                    setFormData({
                                      ...formData,
                                      galleryImages: updated,
                                      primaryImageUrl: isPrimary ? updated[0] || '' : formData.primaryImageUrl,
                                    });
                                  }}
                                  className="bg-rose-600 text-white p-1 rounded hover:bg-rose-700"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                              {isPrimary && (
                                <span className="absolute top-1 right-1 bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                  رئيسية
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">لم يتم إرفاق صور لهذا الصنف حتى الآن.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-sm font-medium"
                >
                  إلغاء
                </button>

                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl text-sm font-semibold shadow-sm shadow-indigo-600/20"
                >
                  {modalMode === 'create' ? 'حفظ وإضافة الصنف' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. Dedicated Modal: Price Change (item.change_price)                 */}
      {/* ==================================================================== */}
      {isPriceModalOpen && targetProductForPrice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <DollarSign className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-800">تعديل سعر البيع (item.change_price)</h3>
              </div>
              <button onClick={() => setIsPriceModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              تعديل سعر الصنف <strong>{targetProductForPrice.nameAr}</strong> ({targetProductForPrice.sku}).
              سيتم تسجيل التعديل في سجل التدقيق ومراعاة الفروع.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  السعر الحالي: <span className="font-mono">{targetProductForPrice.defaultPrice.toFixed(2)} ر.س</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newPriceValue}
                    onChange={(e) => setNewPriceValue(e.target.value)}
                    placeholder="أدخل سعر البيع الجديد..."
                    className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-slate-200 font-mono text-base font-bold text-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                    ر.س
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سبب التغيير (للتسجيل بسجل التدقيق)
                </label>
                <input
                  type="text"
                  value={priceChangeReason}
                  onChange={(e) => setPriceChangeReason(e.target.value)}
                  placeholder="مثال: تحديث تسعيرة العيد / تغيير تكلفة المواد"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPriceModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleApplyPriceChange}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-xs"
              >
                اعتماد السعر الجديد
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. Dedicated Modal: Cost Change (item.change_cost)                   */}
      {/* ==================================================================== */}
      {isCostModalOpen && targetProductForCost && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-800">تعديل التكلفة المرجعية (item.change_cost)</h3>
              </div>
              <button onClick={() => setIsCostModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              تعديل التكلفة للصنف <strong>{targetProductForCost.nameAr}</strong>. التعديل لا يمس التكلفة التاريخية لطلبات الشراء أو حركات المخزون السابقة.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  التكلفة الحالية: <span className="font-mono">{targetProductForCost.defaultCost.toFixed(2)} ر.س</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newCostValue}
                    onChange={(e) => setNewCostValue(e.target.value)}
                    placeholder="أدخل التكلفة الجديدة..."
                    className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-slate-200 font-mono text-base font-bold text-blue-600 focus:ring-2 focus:ring-blue-500/20"
                  />
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                    ر.س
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  مبرر التغيير (Audit Reason)
                </label>
                <input
                  type="text"
                  value={costChangeReason}
                  onChange={(e) => setCostChangeReason(e.target.value)}
                  placeholder="مثال: زيادة أسعار المورد الرئيسي"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCostModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleApplyCostChange}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-xs"
              >
                اعتماد التكلفة الجديدة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. Modal: Conditional Delete / Rejection Alert Dialog                 */}
      {/* ==================================================================== */}
      {deleteAlertModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  deleteAlertModal.isBlocked ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'
                }`}
              >
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">
                  {deleteAlertModal.isBlocked ? 'تعذّر حذف الصنف (محمي بحركات تاريخية)' : 'تأكيد الحذف النهائي للصنف'}
                </h3>
                <span className="text-xs text-slate-500 font-mono">{deleteAlertModal.product?.sku}</span>
              </div>
            </div>

            <div
              className={`p-4 rounded-2xl text-xs leading-relaxed ${
                deleteAlertModal.isBlocked ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-rose-50 text-rose-900 border border-rose-200'
              }`}
            >
              {deleteAlertModal.message}
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteAlertModal({ isOpen: false, product: null, isBlocked: false, message: '' })}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                إغلاق
              </button>

              {deleteAlertModal.isBlocked ? (
                <button
                  type="button"
                  onClick={() => {
                    if (deleteAlertModal.product) {
                      handleToggleArchive(deleteAlertModal.product);
                      setDeleteAlertModal({ isOpen: false, product: null, isBlocked: false, message: '' });
                    }
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>أرشفة الصنف الآن</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-xs"
                >
                  تأكيد الحذف نهائياً
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
