export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface TenantRef {
  id: string;
  code: string;
  name: string;
}

export interface RoleRef {
  id?: string;
  name: string;
}

export interface LegalEntity {
  id: string;
  tenantId: string;
  legalName: string;
  commercialName?: string | null;
  crNumber?: string | null;
  vatNumber: string;
  functionalCurrency: string;
}

export interface Branch {
  id: string;
  tenantId: string;
  legalEntityId: string;
  code: string;
  name: string;
  businessType: string;
}

export interface Warehouse {
  id: string;
  tenantId: string;
  branchId?: string | null;
  code: string;
  name: string;
}

export interface Device {
  id: string;
  tenantId: string;
  branchId: string;
  deviceCode: string;
}

export interface TenantHierarchy {
  legalEntities: LegalEntity[];
  branches: Branch[];
  warehouses: Warehouse[];
  devices: Device[];
}

export interface LoginResponseData {
  token: string;
  user: User;
  role: RoleRef | null;
  permissions: string[];
  activeTenant: TenantRef;
  availableTenants: TenantRef[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
