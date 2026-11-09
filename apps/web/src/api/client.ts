import { ApiResponse } from './types';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'جلسة المستخدم منتهية أو غير مصرح بها. يرجى تسجيل الدخول مجدداً.') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'ليس لديك الصلاحيات الكافية للوصول إلى هذا المورد أو الباقة.') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

type UnauthorizedHandler = () => void;

class ApiClient {
  private token: string | null = null;
  private onUnauthorized: UnauthorizedHandler | null = null;
  private readonly baseUrl: string;

  constructor() {
    // Uses same-origin /api/v1 by default to benefit from Cloudflare reverse proxy / Vite proxy
    const envUrl = (import.meta as any).env?.VITE_API_URL;
    this.baseUrl = envUrl ? `${envUrl}/api/v1` : '/api/v1';
  }

  setToken(token: string | null) {
    this.token = token;
  }

  setOnUnauthorized(handler: UnauthorizedHandler | null) {
    this.onUnauthorized = handler;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = 15000
  ): Promise<T> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${cleanEndpoint}`;

    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');

    if (!(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized
      if (response.status === 401) {
        if (this.onUnauthorized) {
          this.onUnauthorized();
        }
        throw new UnauthorizedError();
      }

      // Handle 403 Forbidden
      if (response.status === 403) {
        let errorMsg = 'غير مصرح بالوصول إلى هذه البيانات أو الخاصية.';
        try {
          const errJson = await response.json();
          if (errJson.message) errorMsg = errJson.message;
        } catch {
          // Fallback
        }
        throw new ForbiddenError(errorMsg);
      }

      // Parse JSON body
      const json: ApiResponse<T> = await response.json().catch(() => ({
        success: false,
        message: 'استجابة غير صالحة من الخادم',
      }));

      if (!response.ok || json.success === false) {
        const errorMsg =
          json.message ||
          (typeof json.error === 'string' ? json.error : `خطأ من الخادم (${response.status})`);
        throw new ApiError(response.status, errorMsg, json);
      }

      return (json.data !== undefined ? json.data : (json as unknown)) as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof ApiError) {
        throw err;
      }

      if ((err as Error)?.name === 'AbortError') {
        throw new ApiError(
          504,
          'انتهت مهلة الاتصال بالخادم. يرجى التحقق من اتصال الشبكة وإعادة المحاولة.'
        );
      }

      throw new ApiError(
        500,
        (err as Error)?.message || 'تعذر الاتصال بخادم النظام المركزي. تأكد من عمل الخدمة.'
      );
    }
  }

  get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  put<T>(endpoint: string, body: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
