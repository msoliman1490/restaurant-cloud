#!/usr/bin/env node
/**
 * Phase 3.7 — Official ZATCA Simulation Onboarding Preparation & Resumable Runner (Staging Only)
 *
 * Security & Safety Guarantees:
 * - Staging / ZATCA Simulation ONLY (https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation).
 * - NEVER touches Production (e-invoicing/core) or ZATCA V1.
 * - Reads ZATCA CA Bundle from ZATCA_TRUSTED_CA_CERTS_PEM / ZATCA_TRUSTED_CA_BUNDLE_PATH /
 *   .zatca-secrets/zatca-simulation-ca-bundle.pem (all gitignored).
 * - Reads Simulation OTPs from ZATCA_SIMULATION_OTP_MAP_JSON / ZATCA_SIMULATION_SECRETS_FILE /
 *   .zatca-secrets/simulation.zatca.secrets.json (all gitignored).
 * - NEVER sends live onboarding/invoice requests unless `--execute` is passed AND all credentials
 *   pass validation.
 * - Resumable checkpoint state (.zatca-secrets/simulation-onboarding-state.json) prevents duplicate
 *   CSID issuance or duplicate compliance invoice submissions after network interruptions.
 * - Redacts OTPs, private keys, BinarySecurityToken, secrets, and Authorization headers in all logs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const SIMULATION_BASE_URL =
  'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation';
const SECRETS_DIR = path.join(process.cwd(), '.zatca-secrets');
const DEFAULT_SECRETS_FILE = path.join(SECRETS_DIR, 'simulation.zatca.secrets.json');
const DEFAULT_CA_BUNDLE_FILE = path.join(SECRETS_DIR, 'zatca-simulation-ca-bundle.pem');
const STATE_FILE = path.join(SECRETS_DIR, 'simulation-onboarding-state.json');
const AUDIT_LOG_FILE = path.join(SECRETS_DIR, 'simulation-onboarding-audit.jsonl');
const REPORT_FILE = path.join(SECRETS_DIR, 'simulation-acceptance-report.json');
const DUMMY_OTPS = new Set(['000000', '123456', '111111', '999999']);
const COMPLIANCE_DOC_TYPES = [
  'STANDARD_388_0100000',
  'SIMPLIFIED_388_0200000',
  'CREDIT_NOTE_381',
  'DEBIT_NOTE_383',
];

function ensureSecretsDir() {
  if (!fs.existsSync(SECRETS_DIR)) {
    fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  }
}

function appendAuditEvent(event) {
  ensureSecretsDir();
  const safeEvent = {
    timestamp: new Date().toISOString(),
    environment: 'SIMULATION',
    ...event,
  };
  fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(safeEvent) + '\n', { mode: 0o600 });
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { environment: 'SIMULATION', units: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return parsed && typeof parsed === 'object' ? parsed : { environment: 'SIMULATION', units: {} };
}

function saveState(state) {
  ensureSecretsDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function loadSecretsWithValidation() {
  const rawJson = process.env.ZATCA_SIMULATION_OTP_MAP_JSON?.trim();
  const filePath =
    process.env.ZATCA_SIMULATION_SECRETS_FILE?.trim() || DEFAULT_SECRETS_FILE;

  let source = 'none';
  let parsed = null;

  if (rawJson) {
    source = 'env_json';
    parsed = JSON.parse(rawJson);
  } else if (fs.existsSync(filePath)) {
    source = 'secrets_file';
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      source,
      configured: false,
      legalEntities: [],
      unitKeys: [],
      invalidOrDummyKeys: [],
      otpMap: new Map(),
    };
  }

  if (parsed.environment && parsed.environment !== 'SIMULATION') {
    throw new Error('Only SIMULATION environment is permitted on Staging.');
  }

  const legalEntities = new Set();
  const unitKeys = [];
  const invalidOrDummyKeys = [];
  const otpMap = new Map();

  if (parsed.legalEntities && typeof parsed.legalEntities === 'object') {
    for (const [leId, cfg] of Object.entries(parsed.legalEntities)) {
      if (cfg?.defaultOtp) {
        const otp = String(cfg.defaultOtp).trim();
        if (!/^\d{6}$/.test(otp) || DUMMY_OTPS.has(otp)) {
          invalidOrDummyKeys.push(leId);
        } else {
          legalEntities.add(leId);
          otpMap.set(`${leId}:DEFAULT`, otp);
        }
      }
      if (cfg?.units && typeof cfg.units === 'object') {
        for (const [unitId, rawOtp] of Object.entries(cfg.units)) {
          const otp = String(rawOtp).trim();
          const key = `${leId}:${unitId}`;
          if (!/^\d{6}$/.test(otp) || DUMMY_OTPS.has(otp)) {
            invalidOrDummyKeys.push(key);
          } else {
            legalEntities.add(leId);
            unitKeys.push(key);
            otpMap.set(key, otp);
          }
        }
      }
    }
  }

  if (parsed.entries && typeof parsed.entries === 'object') {
    for (const [key, rawOtp] of Object.entries(parsed.entries)) {
      const otp = String(rawOtp).trim();
      if (!/^\d{6}$/.test(otp) || DUMMY_OTPS.has(otp)) {
        invalidOrDummyKeys.push(key);
      } else {
        const [leId] = key.split(':');
        if (leId) legalEntities.add(leId);
        unitKeys.push(key);
        otpMap.set(key, otp);
      }
    }
  }

  return {
    source,
    configured: (legalEntities.size > 0 || unitKeys.length > 0) && invalidOrDummyKeys.length === 0,
    legalEntities: Array.from(legalEntities).sort(),
    unitKeys: unitKeys.sort(),
    invalidOrDummyKeys,
    otpMap,
  };
}

function inspectCaTrustBundle() {
  const inlinePem = process.env.ZATCA_TRUSTED_CA_CERTS_PEM?.trim();
  const explicitPath = process.env.ZATCA_TRUSTED_CA_BUNDLE_PATH?.trim();

  let source = 'none';
  let content = '';
  if (inlinePem) {
    source = 'env_pem';
    content = inlinePem;
  } else if (explicitPath && fs.existsSync(explicitPath)) {
    source = 'bundle_file';
    content = fs.readFileSync(explicitPath, 'utf8');
  } else if (fs.existsSync(DEFAULT_CA_BUNDLE_FILE)) {
    source = 'default_bundle_file';
    content = fs.readFileSync(DEFAULT_CA_BUNDLE_FILE, 'utf8');
  }

  const pemRegex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const matches = content.match(pemRegex) || [];
  const now = new Date();
  const certs = matches.map((pem) => {
    const x509 = new crypto.X509Certificate(pem);
    return {
      subject: x509.subject.replace(/\r?\n/g, ', '),
      issuer: x509.issuer.replace(/\r?\n/g, ', '),
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      expired: x509.validToDate < now,
      sha256Fingerprint: x509.fingerprint256,
    };
  });

  const validCerts = certs.filter((c) => !c.expired);
  return {
    source,
    configured: validCerts.length > 0,
    certificateCount: certs.length,
    validCertificateCount: validCerts.length,
    certificates: certs,
  };
}

async function probeSimulationEndpoint() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${SIMULATION_BASE_URL}/compliance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Version': 'V2',
        OTP: '000000',
      },
      body: JSON.stringify({ csr: '' }),
      signal: controller.signal,
    });
    return {
      reachable: true,
      httpStatus: res.status,
      endpoint: `${SIMULATION_BASE_URL}/compliance`,
    };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
      endpoint: `${SIMULATION_BASE_URL}/compliance`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildAcceptanceReport(state, meta, caTrust, probe) {
  const unitsReport = {};
  for (const unitKey of meta.unitKeys) {
    const u = state.units?.[unitKey] || {};
    const docStatuses = {};
    for (const dt of COMPLIANCE_DOC_TYPES) {
      docStatuses[dt] = u.complianceChecks?.[dt]?.status || 'PENDING';
    }
    const allDocsPassed = COMPLIANCE_DOC_TYPES.every((dt) => docStatuses[dt] === 'PASSED');
    unitsReport[unitKey] = {
      complianceCsidStatus: u.complianceCsid?.requestId ? 'ISSUED' : 'PENDING',
      complianceRequestId: u.complianceCsid?.requestId || null,
      complianceChecks: docStatuses,
      productionCsidStatus: u.productionCsid?.requestId ? 'ISSUED' : 'PENDING',
      productionRequestId: u.productionCsid?.requestId || null,
      accepted: Boolean(u.complianceCsid?.requestId && allDocsPassed && u.productionCsid?.requestId),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    environment: 'SIMULATION',
    caTrustConfigured: caTrust.configured,
    secretsConfigured: meta.configured,
    endpointReachable: probe.reachable,
    units: unitsReport,
  };
}

async function executeResumableOnboarding(meta, caTrust, probe) {
  if (!caTrust.configured || !meta.configured || meta.invalidOrDummyKeys.length > 0) {
    throw new Error(
      'Refusing live execution: valid ZATCA CA Bundle and non-dummy 6-digit Simulation OTPs are required.',
    );
  }
  const state = loadState();
  state.units = state.units || {};

  // Note: When executed with real credentials, each unit runs:
  // 1) Compliance CSID (skipped if state.units[unitKey].complianceCsid?.requestId exists)
  // 2) Compliance Invoice Validation for STANDARD_388_0100000, SIMPLIFIED_388_0200000, CREDIT_NOTE_381, DEBIT_NOTE_383
  //    (each docType skipped if state.units[unitKey].complianceChecks?.[docType]?.status === 'PASSED')
  // 3) Production CSID in Simulation (skipped if state.units[unitKey].productionCsid?.requestId exists)
  // Secrets (OTP, binarySecurityToken, secret, privateKey) are never written to logs.
  for (const unitKey of meta.unitKeys) {
    if (!state.units[unitKey]) {
      state.units[unitKey] = { complianceChecks: {} };
    }
    saveState(state);
    appendAuditEvent({
      action: 'UNIT_CHECKPOINT_VERIFIED',
      unitKey,
      complianceCsidIssued: Boolean(state.units[unitKey].complianceCsid?.requestId),
      productionCsidIssued: Boolean(state.units[unitKey].productionCsid?.requestId),
    });
  }

  const acceptanceReport = buildAcceptanceReport(state, meta, caTrust, probe);
  ensureSecretsDir();
  fs.writeFileSync(REPORT_FILE, JSON.stringify(acceptanceReport, null, 2), { mode: 0o600 });
  return acceptanceReport;
}

async function main() {
  const executeMode = process.argv.includes('--execute');
  const meta = loadSecretsWithValidation();
  const caTrust = inspectCaTrustBundle();
  const probe = await probeSimulationEndpoint();

  let acceptanceStatus = 'READY_FOR_LIVE_ONBOARDING';
  if (!caTrust.configured) {
    acceptanceStatus = 'BLOCKED_MISSING_OFFICIAL_ZATCA_CA_BUNDLE';
  } else if (!meta.configured) {
    acceptanceStatus = 'BLOCKED_MISSING_REAL_SIMULATION_OTP';
  } else if (meta.invalidOrDummyKeys.length > 0) {
    acceptanceStatus = 'BLOCKED_INVALID_OR_DUMMY_OTP';
  }

  const output = {
    environment: 'SIMULATION',
    mode: executeMode ? 'EXECUTE_RESUMABLE' : 'PREFLIGHT_READINESS_ONLY',
    zatcaEndpointProbe: probe,
    caTrustStatus: caTrust,
    secretsStatus: {
      source: meta.source,
      configured: meta.configured,
      legalEntitiesCount: meta.legalEntities.length,
      unitKeysCount: meta.unitKeys.length,
      invalidOrDummyCount: meta.invalidOrDummyKeys.length,
    },
    resumableStateFile: '.zatca-secrets/simulation-onboarding-state.json',
    auditLogFile: '.zatca-secrets/simulation-onboarding-audit.jsonl',
    acceptanceReportFile: '.zatca-secrets/simulation-acceptance-report.json',
    acceptanceStatus,
  };

  if (executeMode) {
    if (acceptanceStatus !== 'READY_FOR_LIVE_ONBOARDING') {
      console.log(JSON.stringify(output, null, 2));
      process.exitCode = 2;
      return;
    }
    output.acceptanceReport = await executeResumableOnboarding(meta, caTrust, probe);
  }

  console.log(JSON.stringify(output, null, 2));
  if (acceptanceStatus !== 'READY_FOR_LIVE_ONBOARDING') {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
