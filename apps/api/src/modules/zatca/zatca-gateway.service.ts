import { Injectable, ForbiddenException, BadGatewayException } from '@nestjs/common';
import { SubmissionType, ZatcaEnvironment } from '@restaurant-cloud/domain-kernel';
import { ZatcaCryptoService } from './zatca-crypto.service';

export interface ZatcaGatewayCsidResponse {
  requestId: string;
  binarySecurityToken: string;
  secret: string;
  certificatePem: string;
  certificateSerial: string;
  expiresAt: string;
  liveHttp?: boolean;
}

export interface ZatcaGatewaySubmitRequest {
  environment: string;
  submissionType: SubmissionType | string;
  binarySecurityToken: string;
  secret: string;
  invoiceHash: string;
  uuid: string;
  signedXmlBase64: string;
  complianceCheck?: boolean;
  timeoutMs?: number;
}

export interface ZatcaGatewaySubmitResponse {
  ok: boolean;
  httpStatus: number;
  status: 'CLEARED' | 'REPORTED' | 'REJECTED' | 'RETRYABLE_ERROR';
  requestId?: string;
  clearedXml?: string;
  warnings: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
  retryable: boolean;
  liveHttp?: boolean;
}

export type ZatcaTransportAdapter = {
  submitInvoice: (req: ZatcaGatewaySubmitRequest) => Promise<ZatcaGatewaySubmitResponse>;
};

@Injectable()
export class ZatcaGatewayService {
  private customAdapter: ZatcaTransportAdapter | null = null;
  private defaultTimeoutMs = 15_000;
  private readonly cryptoTrust = new ZatcaCryptoService();

  setTransportAdapter(adapter: ZatcaTransportAdapter | null) {
    this.customAdapter = adapter;
  }

  isLiveHttpEnabled(): boolean {
    return process.env.ZATCA_USE_LIVE_HTTP === 'true';
  }

  private assertEnvironmentAllowed(environment: string) {
    const isProdAllowed =
      environment !== ZatcaEnvironment.PRODUCTION ||
      (process.env.ZATCA_ALLOW_PRODUCTION_CALLS === 'true' &&
        process.env.ZATCA_PRODUCTION_APPROVED === 'true' &&
        process.env.NODE_ENV === 'production');

    if (!isProdAllowed) {
      throw new ForbiddenException(
        'ممنوع الاتصال ببيئة ZATCA Production من بيئة Staging أو قبل اعتماد الإطلاق النهائي.',
      );
    }
  }

  getBaseUrl(environment: string): string {
    this.assertEnvironmentAllowed(environment);
    if (environment === ZatcaEnvironment.SIMULATION) {
      return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation';
    }
    if (environment === ZatcaEnvironment.PRODUCTION) {
      return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core';
    }
    return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private buildBasicAuth(binarySecurityToken: string, secret: string): string {
    return `Basic ${Buffer.from(`${binarySecurityToken}:${secret}`, 'utf8').toString('base64')}`;
  }

  private parseValidationMessages(data: any): {
    warnings: Array<{ code: string; message: string }>;
    errors: Array<{ code: string; message: string }>;
  } {
    const warnings = Array.isArray(data?.validationResults?.warningMessages)
      ? data.validationResults.warningMessages.map((w: any) => ({
          code: String(w.code || w.category || 'WARNING'),
          message: String(w.message || ''),
        }))
      : [];
    const errors = Array.isArray(data?.validationResults?.errorMessages)
      ? data.validationResults.errorMessages.map((e: any) => ({
          code: String(e.code || e.category || 'ERROR'),
          message: String(e.message || ''),
        }))
      : [];
    return { warnings, errors };
  }

  async requestComplianceCsid(params: {
    environment: string;
    csrPem: string;
    otp: string;
    unitIdentifier: string;
    forceLiveHttp?: boolean;
    timeoutMs?: number;
  }): Promise<ZatcaGatewayCsidResponse> {
    this.assertEnvironmentAllowed(params.environment);

    if (params.forceLiveHttp || this.isLiveHttpEnabled()) {
      const baseUrl = this.getBaseUrl(params.environment);
      const csrBase64 = Buffer.from(params.csrPem, 'utf8').toString('base64');
      const res = await this.fetchWithTimeout(
        `${baseUrl}/compliance`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Accept-Version': 'V2',
            OTP: params.otp.trim(),
          },
          body: JSON.stringify({ csr: csrBase64 }),
        },
        params.timeoutMs ?? this.defaultTimeoutMs,
      );

      const text = await res.text();
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        throw new BadGatewayException({
          message: `فشل طلب Compliance CSID من بوابة ZATCA (${res.status})`,
          httpStatus: res.status,
          zatcaResponse: json,
        });
      }

      const bst = String(json.binarySecurityToken || '');
      const pemBody = Buffer.from(bst, 'base64').toString('utf8');
      return {
        requestId: String(json.requestID || ''),
        binarySecurityToken: bst,
        secret: String(json.secret || ''),
        certificatePem: pemBody.includes('BEGIN CERTIFICATE')
          ? pemBody
          : `-----BEGIN CERTIFICATE-----\n${bst}\n-----END CERTIFICATE-----`,
        certificateSerial: String(json.requestID || `ZATCA-${params.unitIdentifier}`),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        liveHttp: true,
      };
    }

    // Local Staging simulation when ZATCA_USE_LIVE_HTTP is not enabled
    const now = new Date();
    const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const serial = `ZATCA-COMP-${params.unitIdentifier}-${now.getTime().toString(36).toUpperCase()}`;
    const bst = Buffer.from(`${serial}:${params.environment}:COMPLIANCE`).toString('base64');
    return {
      requestId: `req-comp-${Date.now()}`,
      binarySecurityToken: bst,
      secret: `sec-comp-${params.unitIdentifier}-${Math.random().toString(36).slice(2, 10)}`,
      certificatePem: `-----BEGIN CERTIFICATE-----\n${bst}\n-----END CERTIFICATE-----`,
      certificateSerial: serial,
      expiresAt: expires.toISOString(),
      liveHttp: false,
    };
  }

  async requestProductionCsid(params: {
    environment: string;
    complianceRequestId: string;
    binarySecurityToken: string;
    secret: string;
    unitIdentifier: string;
    forceLiveHttp?: boolean;
    timeoutMs?: number;
  }): Promise<ZatcaGatewayCsidResponse> {
    this.assertEnvironmentAllowed(params.environment);

    if (
      params.environment === ZatcaEnvironment.SIMULATION ||
      params.environment === ZatcaEnvironment.PRODUCTION
    ) {
      this.assertRealCsidCertificate(params.binarySecurityToken, 'binarySecurityToken');
    }

    if (params.forceLiveHttp || this.isLiveHttpEnabled()) {
      const baseUrl = this.getBaseUrl(params.environment);
      const res = await this.fetchWithTimeout(
        `${baseUrl}/production/csids`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Accept-Version': 'V2',
            Authorization: this.buildBasicAuth(params.binarySecurityToken, params.secret),
          },
          body: JSON.stringify({ compliance_request_id: params.complianceRequestId }),
        },
        params.timeoutMs ?? this.defaultTimeoutMs,
      );

      const text = await res.text();
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        throw new BadGatewayException({
          message: `فشل إصدار Production CSID من بوابة ZATCA (${res.status})`,
          httpStatus: res.status,
          zatcaResponse: json,
        });
      }

      const bst = String(json.binarySecurityToken || '');
      return {
        requestId: String(json.requestID || ''),
        binarySecurityToken: bst,
        secret: String(json.secret || ''),
        certificatePem: `-----BEGIN CERTIFICATE-----\n${bst}\n-----END CERTIFICATE-----`,
        certificateSerial: String(json.requestID || `ZATCA-PROD-${params.unitIdentifier}`),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        liveHttp: true,
      };
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const serial = `ZATCA-PROD-${params.unitIdentifier}-${now.getTime().toString(36).toUpperCase()}`;
    const bst = Buffer.from(`${serial}:${params.environment}:PRODUCTION`).toString('base64');
    return {
      requestId: `req-prod-${Date.now()}`,
      binarySecurityToken: bst,
      secret: `sec-prod-${params.unitIdentifier}-${Math.random().toString(36).slice(2, 10)}`,
      certificatePem: `-----BEGIN CERTIFICATE-----\n${bst}\n-----END CERTIFICATE-----`,
      certificateSerial: serial,
      expiresAt: expires.toISOString(),
      liveHttp: false,
    };
  }

  private assertRealCsidCertificate(
    tokenOrBase64: string,
    label: string,
    expectedBinding?: { vatNumber?: string; unitSerialNumber?: string },
  ) {
    try {
      this.cryptoTrust.validateCsidCertificateTrust({
        certificatePemOrBase64: tokenOrBase64,
        expectedBinding,
      });
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      throw new ForbiddenException(
        `فشل التحقق من موثوقية شهادة CSID (${label}): ${err instanceof Error ? err.message : 'شهادة غير معتمدة'}`,
      );
    }
  }

  async submitInvoice(
    req: ZatcaGatewaySubmitRequest & { forceLiveHttp?: boolean },
  ): Promise<ZatcaGatewaySubmitResponse> {
    this.assertEnvironmentAllowed(req.environment);

    if (
      req.environment === ZatcaEnvironment.SIMULATION ||
      req.environment === ZatcaEnvironment.PRODUCTION
    ) {
      this.assertRealCsidCertificate(req.binarySecurityToken, 'binarySecurityToken');
      const xmlText = Buffer.from(req.signedXmlBase64 || '', 'base64').toString('utf8');
      const match = xmlText.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/);
      if (match?.[1]) {
        this.assertRealCsidCertificate(match[1], 'ds:X509Certificate');
      }
    }

    if (this.customAdapter) {
      return await this.customAdapter.submitInvoice(req);
    }

    if (req.forceLiveHttp || this.isLiveHttpEnabled()) {
      const baseUrl = this.getBaseUrl(req.environment);
      const isClearance = req.submissionType === SubmissionType.CLEARANCE;
      const endpoint = req.complianceCheck
        ? `${baseUrl}/compliance/invoices`
        : isClearance
        ? `${baseUrl}/invoices/clearance/single`
        : `${baseUrl}/invoices/reporting/single`;

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Accept-Version': 'V2',
        'Accept-Language': 'en',
        Authorization: this.buildBasicAuth(req.binarySecurityToken, req.secret),
      };
      if (isClearance && !req.complianceCheck) {
        headers['Clearance-Status'] = '1';
      }

      try {
        const res = await this.fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              invoiceHash: req.invoiceHash,
              uuid: req.uuid,
              invoice: req.signedXmlBase64,
            }),
          },
          req.timeoutMs ?? this.defaultTimeoutMs,
        );

        const text = await res.text();
        let json: any = {};
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }

        const { warnings, errors } = this.parseValidationMessages(json);

        if (res.status >= 500 || res.status === 408 || res.status === 429) {
          return {
            ok: false,
            httpStatus: res.status,
            status: 'RETRYABLE_ERROR',
            warnings,
            errors:
              errors.length > 0
                ? errors
                : [{ code: `HTTP_${res.status}`, message: `ZATCA Gateway temporary error (${res.status})` }],
            retryable: true,
            liveHttp: true,
          };
        }

        if (!res.ok) {
          return {
            ok: false,
            httpStatus: res.status,
            status: 'REJECTED',
            warnings,
            errors:
              errors.length > 0
                ? errors
                : [{ code: `HTTP_${res.status}`, message: String(json?.message || json?.raw || 'Rejected') }],
            retryable: false,
            liveHttp: true,
          };
        }

        const clearanceStatus = String(json.clearanceStatus || '').toUpperCase();
        const reportingStatus = String(json.reportingStatus || '').toUpperCase();
        const clearedXml = json.clearedInvoice
          ? Buffer.from(String(json.clearedInvoice), 'base64').toString('utf8')
          : undefined;

        const isAccepted =
          clearanceStatus === 'CLEARED' ||
          reportingStatus === 'REPORTED' ||
          res.status === 200 ||
          res.status === 202;

        if (!isAccepted) {
          return {
            ok: false,
            httpStatus: res.status,
            status: 'REJECTED',
            warnings,
            errors,
            retryable: false,
            liveHttp: true,
          };
        }

        return {
          ok: true,
          httpStatus: res.status,
          status: isClearance || clearanceStatus === 'CLEARED' ? 'CLEARED' : 'REPORTED',
          requestId: String(json.requestID || `zatca-${Date.now()}`),
          clearedXml,
          warnings,
          errors,
          retryable: false,
          liveHttp: true,
        };
      } catch (err: any) {
        const isAbort = err?.name === 'AbortError';
        return {
          ok: false,
          httpStatus: isAbort ? 504 : 503,
          status: 'RETRYABLE_ERROR',
          warnings: [],
          errors: [
            {
              code: isAbort ? 'GATEWAY_TIMEOUT' : 'NETWORK_ERROR',
              message: err?.message || 'Network/Timeout contacting ZATCA gateway',
            },
          ],
          retryable: true,
          liveHttp: true,
        };
      }
    }

    // Local Staging simulation when ZATCA_USE_LIVE_HTTP is not enabled
    const isClearance = req.submissionType === SubmissionType.CLEARANCE;
    return {
      ok: true,
      httpStatus: 200,
      status: isClearance ? 'CLEARED' : 'REPORTED',
      requestId: `zatca-${Date.now()}-${req.uuid.slice(0, 8)}`,
      clearedXml: isClearance ? Buffer.from(req.signedXmlBase64, 'base64').toString('utf8') : undefined,
      warnings: [],
      errors: [],
      retryable: false,
      liveHttp: false,
    };
  }
}
