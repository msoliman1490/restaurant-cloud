import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  User,
  TenantRef,
  RoleRef,
  LegalEntity,
  Branch,
  TenantHierarchy,
  LoginResponseData,
} from '../api/types';
import { apiClient } from '../api/client';

interface AuthState {
  user: User | null;
  token: string | null;
  role: RoleRef | null;
  permissions: string[];
  activeTenant: TenantRef | null;
  availableTenants: TenantRef[];
  activeLegalEntity: LegalEntity | null;
  activeBranch: Branch | null;
  hierarchy: TenantHierarchy | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string, tenantCode?: string) => Promise<void>;
  logout: () => void;
  selectTenant: (tenantCode: string) => Promise<void>;
  selectBranch: (branchId: string) => void;
  hasPermission: (permissionCode: string) => boolean;
  refreshHierarchy: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'restaurant_cloud_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    role: null,
    permissions: [],
    activeTenant: null,
    availableTenants: [],
    activeLegalEntity: null,
    activeBranch: null,
    hierarchy: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const logout = useCallback(() => {
    apiClient.setToken(null);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors in restricted contexts
    }
    setState({
      user: null,
      token: null,
      role: null,
      permissions: [],
      activeTenant: null,
      availableTenants: [],
      activeLegalEntity: null,
      activeBranch: null,
      hierarchy: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  const loadHierarchy = useCallback(async (): Promise<TenantHierarchy | null> => {
    try {
      const hierarchy = await apiClient.get<TenantHierarchy>('/tenants/hierarchy');
      return hierarchy;
    } catch {
      return null;
    }
  }, []);

  // Set up 401 interceptor
  useEffect(() => {
    apiClient.setOnUnauthorized(logout);
    return () => apiClient.setOnUnauthorized(null);
  }, [logout]);

  // Session re-hydration on initial load (tab reload survival via sessionStorage)
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!stored) {
          setState((prev) => ({ ...prev, isLoading: false }));
          return;
        }

        const parsed = JSON.parse(stored) as {
          token: string;
          user: User;
          role: RoleRef | null;
          permissions: string[];
          activeTenant: TenantRef;
          availableTenants: TenantRef[];
          activeBranchId?: string;
        };

        apiClient.setToken(parsed.token);

        // Live re-validation with backend
        const me = await apiClient.get<{
          user: User;
          role: RoleRef;
          activeTenant: TenantRef;
          permissions: string[];
          availableTenants: TenantRef[];
        }>('/auth/me');

        const hierarchy = await loadHierarchy();

        const activeEntity = hierarchy?.legalEntities[0] || null;
        const activeBranch =
          hierarchy?.branches.find((b) => b.id === parsed.activeBranchId) ||
          hierarchy?.branches[0] ||
          null;

        setState({
          user: me.user,
          token: parsed.token,
          role: me.role,
          permissions: me.permissions,
          activeTenant: me.activeTenant,
          availableTenants: me.availableTenants,
          activeLegalEntity: activeEntity,
          activeBranch: activeBranch,
          hierarchy,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (err) {
        // If live token revalidation fails, wipe stale session cleanly
        logout();
      }
    };

    restoreSession();
  }, [loadHierarchy, logout]);

  const login = async (email: string, password: string, tenantCode?: string) => {
    const cleanPayload = {
      email: email.trim().toLowerCase(),
      password,
      tenantCode: tenantCode?.trim() || undefined,
    };

    const data = await apiClient.post<LoginResponseData>('/auth/login', cleanPayload);

    apiClient.setToken(data.token);

    // Fetch tenant organizational hierarchy
    const hierarchy = await loadHierarchy();
    const firstEntity = hierarchy?.legalEntities[0] || null;
    const firstBranch = hierarchy?.branches[0] || null;

    const newState: AuthState = {
      user: data.user,
      token: data.token,
      role: data.role,
      permissions: data.permissions || [],
      activeTenant: data.activeTenant,
      availableTenants: data.availableTenants || [data.activeTenant],
      activeLegalEntity: firstEntity,
      activeBranch: firstBranch,
      hierarchy,
      isAuthenticated: true,
      isLoading: false,
    };

    // Save session in sessionStorage (isolated to current browser tab)
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          token: data.token,
          user: data.user,
          role: data.role,
          permissions: data.permissions,
          activeTenant: data.activeTenant,
          availableTenants: data.availableTenants,
          activeBranchId: firstBranch?.id,
        })
      );
    } catch {
      // Ignore
    }

    setState(newState);
  };

  const selectBranch = (branchId: string) => {
    if (!state.hierarchy) return;
    const branch = state.hierarchy.branches.find((b) => b.id === branchId);
    if (!branch) return;

    const entity =
      state.hierarchy.legalEntities.find((e) => e.id === branch.legalEntityId) ||
      state.activeLegalEntity;

    setState((prev) => ({
      ...prev,
      activeBranch: branch,
      activeLegalEntity: entity,
    }));
  };

  const selectTenant = async (tenantCode: string) => {
    if (!state.user) return;
    // Switching tenant requires issuing a new JWT under the target tenant code
    // User must re-authenticate or session token must be refreshed for target tenant
    await login(state.user.email, '', tenantCode);
  };

  const hasPermission = (permissionCode: string): boolean => {
    if (!state.isAuthenticated) return false;
    // Owners and Admins have wildcard access
    if (state.role?.name === 'OWNER' || state.role?.name === 'ADMIN') return true;
    return state.permissions.includes(permissionCode);
  };

  const refreshHierarchy = async () => {
    const hierarchy = await loadHierarchy();
    if (hierarchy) {
      setState((prev) => ({ ...prev, hierarchy }));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        selectTenant,
        selectBranch,
        hasPermission,
        refreshHierarchy,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
