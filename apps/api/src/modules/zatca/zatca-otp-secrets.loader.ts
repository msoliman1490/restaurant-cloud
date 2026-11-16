import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ZatcaSimulationOtpEntry {
  legalEntityId: string;
  unitIdentifier?: string;
  otp: string;
}

export interface ZatcaSimulationSecretsSummary {
  source: 'env_json' | 'secrets_file' | 'none';
  configuredLegalEntityIds: string[];
  configuredUnitKeys: string[];
  totalEntries: number;
}

interface SecretsFileShape {
  environment?: string;
  legalEntities?: Record<
    string,
    {
      defaultOtp?: string;
      units?: Record<string, string>;
    }
  >;
  entries?: Record<string, string>;
}

const DUMMY_OTPS = new Set(['000000', '123456', '111111', '999999']);

/**
 * Loads ZATCA Simulation OTPs from protected Staging environment variables or
 * gitignored secret files without ever exposing OTP values in logs or errors.
 */
export class ZatcaOtpSecretsLoader {
  private readonly defaultSecretsPath: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.defaultSecretsPath = path.join(
      workspaceRoot,
      '.zatca-secrets',
      'simulation.zatca.secrets.json',
    );
  }

  private readSecretsPayload(): {
    source: 'env_json' | 'secrets_file' | 'none';
    payload: SecretsFileShape | null;
  } {
    const rawJson = process.env.ZATCA_SIMULATION_OTP_MAP_JSON?.trim();
    if (rawJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        throw new Error(
          'ZATCA_SIMULATION_OTP_MAP_JSON is not valid JSON (details redacted).',
        );
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('ZATCA_SIMULATION_OTP_MAP_JSON must be a JSON object.');
      }
      const shape = parsed as SecretsFileShape;
      if (shape.environment && shape.environment !== 'SIMULATION') {
        throw new Error(
          'Refusing non-SIMULATION ZATCA OTP secret configuration on Staging.',
        );
      }
      return { source: 'env_json', payload: shape };
    }

    const filePath =
      process.env.ZATCA_SIMULATION_SECRETS_FILE?.trim() ||
      this.defaultSecretsPath;
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error(
          `ZATCA secrets file at ${path.basename(filePath)} is not valid JSON.`,
        );
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('ZATCA secrets file must contain a JSON object.');
      }
      const shape = parsed as SecretsFileShape;
      if (shape.environment && shape.environment !== 'SIMULATION') {
        throw new Error(
          'Refusing non-SIMULATION ZATCA OTP secrets file on Staging.',
        );
      }
      return { source: 'secrets_file', payload: shape };
    }

    return { source: 'none', payload: null };
  }

  /**
   * Returns non-sensitive metadata describing which Legal Entities and POS/EGS
   * units have Simulation OTPs configured. Never returns OTP values.
   */
  getSummary(): ZatcaSimulationSecretsSummary {
    const { source, payload } = this.readSecretsPayload();
    if (!payload) {
      return {
        source: 'none',
        configuredLegalEntityIds: [],
        configuredUnitKeys: [],
        totalEntries: 0,
      };
    }

    const legalEntityIds = new Set<string>();
    const unitKeys = new Set<string>();

    if (payload.legalEntities) {
      for (const [leId, cfg] of Object.entries(payload.legalEntities)) {
        if (cfg?.defaultOtp?.trim()) {
          legalEntityIds.add(leId);
        }
        if (cfg?.units) {
          for (const [unitId, otp] of Object.entries(cfg.units)) {
            if (otp?.trim()) {
              legalEntityIds.add(leId);
              unitKeys.add(`${leId}:${unitId}`);
            }
          }
        }
      }
    }

    if (payload.entries) {
      for (const [key, otp] of Object.entries(payload.entries)) {
        if (otp?.trim()) {
          unitKeys.add(key);
          const [leId] = key.split(':');
          if (leId) legalEntityIds.add(leId);
        }
      }
    }

    return {
      source,
      configuredLegalEntityIds: Array.from(legalEntityIds).sort(),
      configuredUnitKeys: Array.from(unitKeys).sort(),
      totalEntries: unitKeys.size + legalEntityIds.size,
    };
  }

  /**
   * Resolves a Simulation OTP for a specific Legal Entity and POS/EGS unit.
   * Throws a redacted error if missing or invalid; never echoes the OTP.
   */
  resolveSimulationOtp(params: {
    environment: 'SIMULATION' | 'PRODUCTION';
    legalEntityId: string;
    unitIdentifier?: string;
    rejectDummyOtp?: boolean;
  }): string {
    if (params.environment !== 'SIMULATION') {
      throw new Error(
        'ZatcaOtpSecretsLoader is restricted to SIMULATION environment only.',
      );
    }

    const { payload } = this.readSecretsPayload();
    if (!payload) {
      throw new Error(
        `Missing ZATCA Simulation OTP configuration for legalEntity=${params.legalEntityId}. Configure ZATCA_SIMULATION_OTP_MAP_JSON or .zatca-secrets/simulation.zatca.secrets.json.`,
      );
    }

    const compositeKey = params.unitIdentifier
      ? `${params.legalEntityId}:${params.unitIdentifier}`
      : params.legalEntityId;

    const candidate =
      payload.entries?.[compositeKey] ??
      (params.unitIdentifier
        ? payload.legalEntities?.[params.legalEntityId]?.units?.[
            params.unitIdentifier
          ]
        : undefined) ??
      payload.legalEntities?.[params.legalEntityId]?.defaultOtp ??
      payload.entries?.[params.legalEntityId];

    const otp = candidate?.trim();
    if (!otp || !/^\d{6}$/.test(otp)) {
      throw new Error(
        `ZATCA Simulation OTP for ${compositeKey} is missing or not a 6-digit Fatoora OTP.`,
      );
    }

    if (params.rejectDummyOtp !== false && DUMMY_OTPS.has(otp)) {
      throw new Error(
        `ZATCA Simulation OTP for ${compositeKey} appears to be a placeholder/dummy OTP and cannot be used for Official Simulation Acceptance.`,
      );
    }

    return otp;
  }
}
