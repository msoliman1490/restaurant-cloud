import {
  LayoutDashboard,
  UtensilsCrossed,
  Boxes,
  ArrowLeftRight,
  Building2,
  Receipt,
  ShoppingCart,
  ChefHat,
  Utensils,
  BookOpen,
  Layers,
  Users,
  ShieldCheck,
  Settings,
  FileText,
  Lock,
  QrCode,
  Truck,
  UserCheck,
  Scale,
  CreditCard,
  Sparkles,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'onboarding'
  | 'pos'
  | 'catalog'
  | 'inventory'
  | 'transfers'
  | 'purchasing'
  | 'production'
  | 'dining'
  | 'accounting'
  | 'reconciliation'
  | 'period-closing'
  | 'zatca-v2'
  | 'entities'
  | 'users'
  | 'hr'
  | 'delivery'
  | 'roles'
  | 'settings'
  | 'audit'
  | 'industries'
  | 'subscription'
  | 'super-admin';

export interface NavItemConfig {
  id: NavTab;
  labelAr: string;
  labelEn: string;
  icon: LucideIcon;
  requiredPermissions?: string[];
  requiredIndustry?: string;
  requiresPlatformAdmin?: boolean;
  cashierAllowed?: boolean;
  badgeCount?: number;
}

export interface NavGroupConfig {
  id: string;
  titleAr: string;
  titleEn: string;
  defaultOpen?: boolean;
  items: NavItemConfig[];
}

export const NAVIGATION_GROUPS: NavGroupConfig[] = [
  {
    id: 'main',
    titleAr: 'الرئيسية',
    titleEn: 'Main',
    defaultOpen: true,
    items: [
      {
        id: 'dashboard',
        labelAr: 'لوحة التحكم',
        labelEn: 'Dashboard',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    id: 'sales_ops',
    titleAr: 'المبيعات والتشغيل',
    titleEn: 'Sales & Operations',
    defaultOpen: true,
    items: [
      {
        id: 'pos',
        labelAr: 'نقاط البيع POS',
        labelEn: 'Point of Sale (POS)',
        icon: Receipt,
        cashierAllowed: true,
      },
      {
        id: 'dining',
        labelAr: 'إدارة الصالة والطاولات',
        labelEn: 'Dining & Tables',
        icon: Utensils,
        requiredIndustry: 'RESTAURANT',
        requiredPermissions: ['dining.table.view', 'dining.read', 'dining.manage'],
      },
      {
        id: 'delivery',
        labelAr: 'التوصيل والسائقون',
        labelEn: 'Delivery & Drivers',
        icon: Truck,
        requiredPermissions: ['delivery.view', 'delivery.manage'],
      },
      {
        id: 'catalog',
        labelAr: 'قائمة المنتجات والتسعير',
        labelEn: 'Catalog & Pricing',
        icon: UtensilsCrossed,
        requiredPermissions: ['catalog.read', 'catalog.manage'],
      },
      {
        id: 'production',
        labelAr: 'الوصفات والتصنيع BOM',
        labelEn: 'Recipes & Production (BOM)',
        icon: ChefHat,
        requiredPermissions: ['production.read', 'production.manage'],
      },
    ],
  },
  {
    id: 'inventory_purchasing',
    titleAr: 'المخزون والمشتريات',
    titleEn: 'Inventory & Purchasing',
    defaultOpen: true,
    items: [
      {
        id: 'inventory',
        labelAr: 'أرصدة المخزون والتكلفة',
        labelEn: 'Inventory & Costing',
        icon: Boxes,
        requiredPermissions: ['inventory.read', 'inventory.manage'],
      },
      {
        id: 'transfers',
        labelAr: 'التحويلات والمناقلات',
        labelEn: 'Inter-Branch Transfers',
        icon: ArrowLeftRight,
        requiredPermissions: ['inventory.read', 'inventory.manage'],
      },
      {
        id: 'purchasing',
        labelAr: 'المشتريات وسلاسل الإمداد',
        labelEn: 'Purchasing & Suppliers',
        icon: ShoppingCart,
        requiredPermissions: ['purchasing.read', 'purchasing.manage'],
      },
    ],
  },
  {
    id: 'admin_hr',
    titleAr: 'الإدارة والموارد',
    titleEn: 'Administration & HR',
    defaultOpen: true,
    items: [
      {
        id: 'entities',
        labelAr: 'الشركات والفروع',
        labelEn: 'Companies & Branches',
        icon: Building2,
        requiredPermissions: ['tenant.read', 'tenant.manage'],
      },
      {
        id: 'users',
        labelAr: 'المستخدمون',
        labelEn: 'Users',
        icon: Users,
        requiredPermissions: ['iam.read', 'iam.manage'],
      },
      {
        id: 'hr',
        labelAr: 'الموظفون والموارد البشرية',
        labelEn: 'Employees & HR',
        icon: UserCheck,
        requiredPermissions: ['hr.view', 'hr.manage'],
      },
      {
        id: 'roles',
        labelAr: 'الأدوار والصلاحيات',
        labelEn: 'Roles & Permissions',
        icon: ShieldCheck,
        requiredPermissions: ['iam.read', 'iam.manage'],
      },
    ],
  },
  {
    id: 'finance',
    titleAr: 'المالية والمحاسبة',
    titleEn: 'Finance & Accounting',
    defaultOpen: true,
    items: [
      {
        id: 'accounting',
        labelAr: 'المحاسبة ودفتر الأستاذ',
        labelEn: 'Accounting & General Ledger',
        icon: BookOpen,
        requiredPermissions: ['accounting.read', 'accounting.manage'],
      },
      {
        id: 'reconciliation',
        labelAr: 'المصالحات والتقارير المالية',
        labelEn: 'Reconciliation & Reports',
        icon: Scale,
        requiredPermissions: ['accounting.read', 'accounting.manage'],
      },
      {
        id: 'period-closing',
        labelAr: 'إقفال الفترات المالية',
        labelEn: 'Financial Period Closing',
        icon: Lock,
        requiredPermissions: ['accounting.read', 'accounting.manage'],
      },
    ],
  },
  {
    id: 'compliance',
    titleAr: 'التكامل والامتثال',
    titleEn: 'Integrations & Compliance',
    defaultOpen: true,
    items: [
      {
        id: 'zatca-v2',
        labelAr: 'الفوترة الإلكترونية ZATCA',
        labelEn: 'ZATCA E-Invoicing',
        icon: QrCode,
        requiredPermissions: ['zatca.read', 'zatca.manage'],
      },
      {
        id: 'audit',
        labelAr: 'سجل الرقابة Audit',
        labelEn: 'Audit Log',
        icon: FileText,
        requiredPermissions: ['audit.read', 'audit.manage'],
      },
      {
        id: 'settings',
        labelAr: 'إعدادات المنشأة',
        labelEn: 'Organization Settings',
        icon: Settings,
        requiredPermissions: ['tenant.read', 'tenant.manage'],
      },
      {
        id: 'industries',
        labelAr: 'قطاعات المنشأة وباقات الاشتراك',
        labelEn: 'Industry Sectors & Plans',
        icon: Layers,
        requiredPermissions: ['tenant.read', 'tenant.manage'],
      },
      {
        id: 'onboarding',
        labelAr: 'معالج تهيئة المنشأة',
        labelEn: 'Setup Wizard',
        icon: Sparkles,
        requiredPermissions: ['tenant.read', 'tenant.manage'],
      },
      {
        id: 'subscription',
        labelAr: 'الاشتراك والفوترة',
        labelEn: 'Subscription & Billing',
        icon: CreditCard,
        requiredPermissions: ['tenant.read', 'tenant.manage'],
      },
      {
        id: 'super-admin',
        labelAr: 'إدارة المنصة (Super Admin)',
        labelEn: 'Platform Super Admin',
        icon: ShieldAlert,
        requiresPlatformAdmin: true,
      },
    ],
  },
];
