import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { C14nCanonicalization, ExclusiveCanonicalization } from 'xml-crypto';
import * as xpath from 'xpath';
import { ZatcaCryptoService } from '../src/modules/zatca/zatca-crypto.service';
import { ZatcaUblService } from '../src/modules/zatca/zatca-ubl.service';
import { ZatcaGatewayService } from '../src/modules/zatca/zatca-gateway.service';
import { ZatcaOtpSecretsLoader } from '../src/modules/zatca/zatca-otp-secrets.loader';
import {
  SubmissionType,
  ZatcaEnvironment,
  ZatcaInvoiceSubtype,
} from '@restaurant-cloud/domain-kernel';

/**
 * Independent XAdES-BES + C14N + QR TLV validator (does NOT call ZatcaCryptoService).
 */
function independentValidateZatcaSignedXml(
  signedXml: string,
  expectedPublicKeyPem: string,
  requireTag9: boolean,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
  if (!doc?.documentElement) return { valid: false, errors: ['Invalid XML'] };

  // 1. Check UBL 2.1 structure: UBLExtensions first child, cac:Signature present
  const firstElem = Array.from(doc.documentElement.childNodes).find(
    (n) => n.nodeType === 1,
  ) as Element | undefined;
  if (firstElem?.localName !== 'UBLExtensions') {
    errors.push('ext:UBLExtensions must be the first child of Invoice');
  }

  // 2. Check SignedInfo algorithms, XPath transforms, and Reference URIs
  const xpaths = (
    xpath.select("//*[local-name()='XPath']", doc as unknown as Node) as unknown as Node[]
  ).map((n) => n.textContent?.trim());
  for (const requiredXpath of [
    'not(//ancestor-or-self::ext:UBLExtensions)',
    'not(//ancestor-or-self::cac:Signature)',
    "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
  ]) {
    if (!xpaths.includes(requiredXpath)) {
      errors.push(`Missing ZATCA XPath transform: ${requiredXpath}`);
    }
  }

  const sigMethod = (
    xpath.select(
      "//*[local-name()='SignatureMethod']/@Algorithm",
      doc as unknown as Node,
    ) as unknown as Attr[]
  )[0]?.value;
  if (sigMethod !== 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256') {
    errors.push(`Unexpected SignatureMethod: ${sigMethod}`);
  }

  // 3. Independent Invoice Hash check (strip UBLExtensions, root cac:Signature, QR)
  const strippedDoc = new DOMParser().parseFromString(signedXml, 'text/xml');
  for (const q of [
    "//*[local-name()='UBLExtensions']",
    "//*[local-name()='Signature' and parent::*[local-name()='Invoice']]",
    "//*[local-name()='AdditionalDocumentReference' and *[local-name()='ID' and normalize-space(text())='QR']]",
  ]) {
    const nodes = xpath.select(q, strippedDoc as unknown as Node) as unknown as Node[];
    for (const n of nodes) {
      n.parentNode?.removeChild(n);
    }
  }
  const canonicalInvoice = String(
    new C14nCanonicalization().process(
      strippedDoc.documentElement as unknown as Document,
      {},
    ),
  ).replace(/\r\n/g, '\n');
  const computedInvoiceHash = crypto
    .createHash('sha256')
    .update(canonicalInvoice, 'utf8')
    .digest('base64');

  const refInvoiceDigest = (
    xpath.select(
      "//*[local-name()='Reference' and @URI='']/*[local-name()='DigestValue']",
      doc as unknown as Node,
    ) as unknown as Node[]
  )[0]?.textContent?.trim();
  if (computedInvoiceHash !== refInvoiceDigest) {
    errors.push('Independent invoice digest mismatch');
  }

  // 4. Independent SignedProperties Exc-C14N digest check + CertDigest + IssuerSerial
  const spNode = (
    xpath.select(
      "//*[local-name()='SignedProperties' and @Id='xadesSignedProperties']",
      doc as unknown as Node,
    ) as unknown as Node[]
  )[0];
  const spRefDigest = (
    xpath.select(
      "//*[local-name()='Reference' and @URI='#xadesSignedProperties']/*[local-name()='DigestValue']",
      doc as unknown as Node,
    ) as unknown as Node[]
  )[0]?.textContent?.trim();
  if (!spNode || !spRefDigest) {
    errors.push('Missing SignedProperties or its Reference');
  } else {
    const spXml = new XMLSerializer().serializeToString(
      spNode as unknown as Parameters<XMLSerializer['serializeToString']>[0],
    );
    const spDoc = new DOMParser().parseFromString(spXml, 'text/xml');
    const canonicalSp = String(
      new ExclusiveCanonicalization().process(
        spDoc.documentElement as unknown as Document,
        {},
      ),
    ).replace(/\r\n/g, '\n');
    const computedSpDigest = crypto
      .createHash('sha256')
      .update(canonicalSp, 'utf8')
      .digest('base64');
    if (computedSpDigest !== spRefDigest) {
      errors.push('Independent SignedProperties digest mismatch');
    }
  }

  // 5. Independent X509Certificate + CertDigest + ECDSA SignatureValue check
  const x509B64 = (
    xpath.select("//*[local-name()='X509Certificate']", doc as unknown as Node) as unknown as Node[]
  )[0]?.textContent?.trim();
  const certDigestVal = (
    xpath.select(
      "//*[local-name()='CertDigest']/*[local-name()='DigestValue']",
      doc as unknown as Node,
    ) as unknown as Node[]
  )[0]?.textContent?.trim();
  const siNode = (
    xpath.select("//*[local-name()='SignedInfo']", doc as unknown as Node) as unknown as Node[]
  )[0];
  const sigVal = (
    xpath.select("//*[local-name()='SignatureValue']", doc as unknown as Node) as unknown as Node[]
  )[0]?.textContent?.trim();

  if (!x509B64 || !siNode || !sigVal) {
    errors.push('Missing X509Certificate, SignedInfo, or SignatureValue');
  } else {
    const certDer = Buffer.from(x509B64, 'base64');
    const x509 = new crypto.X509Certificate(certDer);
    const computedCertDigest = crypto.createHash('sha256').update(certDer).digest('base64');
    if (computedCertDigest !== certDigestVal) {
      errors.push('X509 CertDigest mismatch');
    }
    const certPubPem = x509.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    if (certPubPem !== expectedPublicKeyPem) {
      errors.push('X509Certificate public key does not match expected public key');
    }
    const siXml = new XMLSerializer().serializeToString(
      siNode as unknown as Parameters<XMLSerializer['serializeToString']>[0],
    );
    const siDoc = new DOMParser().parseFromString(siXml, 'text/xml');
    const canonicalSi = String(
      new C14nCanonicalization().process(siDoc.documentElement as unknown as Document, {}),
    ).replace(/\r\n/g, '\n');
    const sigOk = crypto.verify(
      'sha256',
      Buffer.from(canonicalSi, 'utf8'),
      x509.publicKey,
      Buffer.from(sigVal, 'base64'),
    );
    if (!sigOk) {
      errors.push('Independent ECDSA SignatureValue verification failed');
    }
  }

  // 6. Independent QR TLV check
  const qrText = (
    xpath.select(
      "//*[local-name()='AdditionalDocumentReference' and *[local-name()='ID' and normalize-space(text())='QR']]//*[local-name()='EmbeddedDocumentBinaryObject']",
      doc as unknown as Node,
    ) as unknown as Node[]
  )[0]?.textContent?.trim();
  if (!qrText) {
    errors.push('Missing QR EmbeddedDocumentBinaryObject');
  } else {
    const buf = Buffer.from(qrText, 'base64');
    const tags: Record<number, Buffer> = {};
    let off = 0;
    while (off < buf.length) {
      const t = buf[off++] ?? 0;
      let l = buf[off++] ?? 0;
      if (l === 0x82) {
        l = ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
        off += 2;
      }
      tags[t] = buf.subarray(off, off + l);
      off += l;
    }
    if (tags[6]?.toString('utf8') !== computedInvoiceHash) {
      errors.push('QR Tag 6 does not match independent invoice hash');
    }
    if (tags[7]?.toString('utf8') !== sigVal) {
      errors.push('QR Tag 7 does not match XML SignatureValue');
    }
    if (requireTag9 && (!tags[9] || tags[9].length === 0)) {
      errors.push('QR Tag 9 missing for Simplified B2C');
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('Phase 3.7 — ZATCA Signature Compliance Hardening (XAdES-BES + C14N + QR TLV)', () => {
  const cryptoService = new ZatcaCryptoService();
  const ublService = new ZatcaUblService();

  function buildSampleInput(params: {
    invoiceTypeCode: '388' | '381' | '383';
    invoiceSubtype: ZatcaInvoiceSubtype;
    docNumber: string;
    uuid: string;
    icv: number;
  }) {
    return {
      uuid: params.uuid,
      documentNumber: params.docNumber,
      issueDate: '2026-11-14',
      issueTime: '12:00:00',
      invoiceTypeCode: params.invoiceTypeCode,
      invoiceSubtype: params.invoiceSubtype,
      currency: 'SAR',
      icv: params.icv,
      pih: cryptoService.getGenesisPih(),
      seller: {
        nameAr: 'شركة مطاعم السحاب',
        nameEn: 'Cloud Restaurants Co.',
        vatNumber: '310122393500003',
        crNumber: '1010123456',
        streetName: 'King Fahd Rd',
        buildingNumber: '1234',
        districtName: 'Al Olaya',
        cityName: 'Riyadh',
        postalZone: '12211',
        countryCode: 'SA',
      },
      buyer:
        params.invoiceSubtype === ZatcaInvoiceSubtype.STANDARD_B2B
          ? {
              name: 'شركة المشتري التجريبية',
              vatNumber: '300000000000003',
              cityName: 'Riyadh',
              countryCode: 'SA',
            }
          : undefined,
      originalDocumentNumber:
        params.invoiceTypeCode === '388' ? undefined : 'INV-ORIG-001',
      originalDocumentUuid:
        params.invoiceTypeCode === '388'
          ? undefined
          : '11111111-1111-4111-8111-111111111111',
      zatcaReasonCode:
        params.invoiceTypeCode === '388' ? undefined : 'Correction of price',
      subtotal: 100,
      discountTotal: 0,
      taxAmount: 15,
      grandTotal: 115,
      lines: [
        {
          id: '1',
          name: 'Signature Meal',
          quantity: 1,
          unitPrice: 100,
          taxRate: 15,
        },
      ],
    };
  }

  const scenarios: Array<{
    label: string;
    invoiceTypeCode: '388' | '381' | '383';
    invoiceSubtype: ZatcaInvoiceSubtype;
    requireTag9: boolean;
  }> = [
    {
      label: 'Standard Tax Invoice (388 / 0100000)',
      invoiceTypeCode: '388',
      invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      requireTag9: false,
    },
    {
      label: 'Simplified Tax Invoice (388 / 0200000)',
      invoiceTypeCode: '388',
      invoiceSubtype: ZatcaInvoiceSubtype.SIMPLIFIED_B2C,
      requireTag9: true,
    },
    {
      label: 'Credit Note (381 / 0100000)',
      invoiceTypeCode: '381',
      invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      requireTag9: false,
    },
    {
      label: 'Debit Note (383 / 0200000)',
      invoiceTypeCode: '383',
      invoiceSubtype: ZatcaInvoiceSubtype.SIMPLIFIED_B2C,
      requireTag9: true,
    },
  ];

  for (const sc of scenarios) {
    it(`signs and verifies ${sc.label} with XAdES-BES, C14N, X.509 cert, and QR TLV`, () => {
      const { privateKeyPem, publicKeyPem, publicKeyDerBase64 } =
        cryptoService.generateEcdsaKeyPair();
      const uuid = crypto.randomUUID();
      const input = buildSampleInput({
        invoiceTypeCode: sc.invoiceTypeCode,
        invoiceSubtype: sc.invoiceSubtype,
        docNumber: `DOC-${sc.invoiceTypeCode}-001`,
        uuid,
        icv: 1,
      });

      expect(ublService.validateUblAndBrKsa(input).valid).toBe(true);
      const ublXml = ublService.buildUblXml(input);
      const signingTimeIso = '2026-11-14T12:00:00Z';

      const xades = cryptoService.signZatcaXades({
        ublXml,
        privateKeyPem,
        signingTimeIso,
        allowSelfSignedFallback: true,
      });

      const qrBase64 = cryptoService.encodeQrTlv({
        sellerName: input.seller.nameAr,
        vatNumber: input.seller.vatNumber,
        timestamp: signingTimeIso,
        invoiceTotal: input.grandTotal.toFixed(2),
        vatTotal: input.taxAmount.toFixed(2),
        invoiceHashBase64: xades.invoiceHashBase64,
        ecdsaSignatureBase64: xades.signatureBase64,
        publicKeyBase64: publicKeyDerBase64,
        certificateSignatureBase64: sc.requireTag9
          ? xades.certificateSignatureBase64
          : undefined,
      });

      const signedXml = ublService.injectSignatureAndQr(
        ublXml,
        qrBase64,
        xades.signatureBase64,
        xades,
      );

      // Verify full XAdES-BES signature & digests
      const verifyRes = cryptoService.verifyZatcaXadesXml(signedXml, publicKeyPem);
      expect(verifyRes.valid).toBe(true);
      expect(verifyRes.invoiceDigestValid).toBe(true);
      expect(verifyRes.signedPropertiesDigestValid).toBe(true);
      expect(verifyRes.signatureValid).toBe(true);
      expect(verifyRes.invoiceHashBase64).toBe(xades.invoiceHashBase64);

      // Verify verification also works solely from embedded <ds:X509Certificate>
      const verifyFromEmbeddedCert = cryptoService.verifyZatcaXadesXml(signedXml);
      expect(verifyFromEmbeddedCert.valid).toBe(true);

      // Independent validator (separate from ZatcaCryptoService)
      const independent = independentValidateZatcaSignedXml(
        signedXml,
        publicKeyPem,
        sc.requireTag9,
      );
      expect(independent.errors).toEqual([]);
      expect(independent.valid).toBe(true);

      // Verify UBL/XAdES structural elements via DOM & XPath
      const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
      const firstElem = Array.from(doc.documentElement.childNodes).find(
        (n) => n.nodeType === 1,
      ) as Element | undefined;
      expect(firstElem?.localName).toBe('UBLExtensions');

      const refInvoice = xpath.select(
        "//*[local-name()='Reference' and @URI='']",
        doc as unknown as Node,
      ) as unknown[];
      const refProps = xpath.select(
        "//*[local-name()='Reference' and @URI='#xadesSignedProperties']",
        doc as unknown as Node,
      ) as unknown[];
      const x509Nodes = xpath.select(
        "//*[local-name()='X509Certificate']",
        doc as unknown as Node,
      ) as unknown[];
      const cacSigNodes = xpath.select(
        "//*[local-name()='Signature' and parent::*[local-name()='Invoice']]",
        doc as unknown as Node,
      ) as unknown[];

      expect(refInvoice.length).toBe(1);
      expect(refProps.length).toBe(1);
      expect(x509Nodes.length).toBe(1);
      expect(cacSigNodes.length).toBe(1);

      // Verify QR TLV tags & hash/signature/public-key binding
      const qrCheck = cryptoService.verifyQrTlv(qrBase64, {
        vatNumber: input.seller.vatNumber,
        invoiceTotal: '115.00',
        vatTotal: '15.00',
        invoiceHashBase64: xades.invoiceHashBase64,
        ecdsaSignatureBase64: xades.signatureBase64,
        publicKeyBase64: publicKeyDerBase64,
        requireTag9: sc.requireTag9,
      });
      expect(qrCheck.valid).toBe(true);
      expect(qrCheck.errors).toEqual([]);
      if (sc.requireTag9) {
        expect(qrCheck.tagsPresent).toContain(9);
      } else {
        expect(qrCheck.tagsPresent).not.toContain(9);
      }
    });
  }

  it('produces identical invoice hash across CRLF vs LF line endings and excluded-node mutations', () => {
    const { privateKeyPem } = cryptoService.generateEcdsaKeyPair();
    const input = buildSampleInput({
      invoiceTypeCode: '388',
      invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      docNumber: 'DOC-C14N-001',
      uuid: crypto.randomUUID(),
      icv: 2,
    });
    const ublXml = ublService.buildUblXml(input);
    const ublCrlf = ublXml.replace(/\n/g, '\r\n');

    expect(cryptoService.computeZatcaInvoiceHash(ublCrlf)).toBe(
      cryptoService.computeZatcaInvoiceHash(ublXml),
    );

    const xades = cryptoService.signZatcaXades({
      ublXml,
      privateKeyPem,
      allowSelfSignedFallback: true,
    });
    const signedXml = ublService.injectSignatureAndQr(
      ublXml,
      'DUMMY_QR',
      xades.signatureBase64,
      xades,
    );
    expect(cryptoService.computeZatcaInvoiceHash(signedXml)).toBe(
      xades.invoiceHashBase64,
    );
  });

  it('rejects any post-signing tampering of protected XML elements, UUID, SignedProperties, or SignatureValue', () => {
    const { privateKeyPem, publicKeyPem } = cryptoService.generateEcdsaKeyPair();
    const input = buildSampleInput({
      invoiceTypeCode: '388',
      invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      docNumber: 'DOC-TAMPER-001',
      uuid: crypto.randomUUID(),
      icv: 3,
    });
    const ublXml = ublService.buildUblXml(input);
    const xades = cryptoService.signZatcaXades({
      ublXml,
      privateKeyPem,
      signingTimeIso: '2026-11-14T12:00:00Z',
      allowSelfSignedFallback: true,
    });
    const signedXml = ublService.injectSignatureAndQr(
      ublXml,
      'QR_DATA',
      xades.signatureBase64,
      xades,
    );

    // 1. Tamper PayableAmount
    const tamperedAmount = signedXml.replace(
      '<cbc:PayableAmount currencyID="SAR">115.00</cbc:PayableAmount>',
      '<cbc:PayableAmount currencyID="SAR">116.00</cbc:PayableAmount>',
    );
    const resAmount = cryptoService.verifyZatcaXadesXml(tamperedAmount, publicKeyPem);
    expect(resAmount.valid).toBe(false);
    expect(resAmount.invoiceDigestValid).toBe(false);

    // 2. Tamper UUID
    const tamperedUuid = signedXml.replace(
      `<cbc:UUID>${input.uuid}</cbc:UUID>`,
      `<cbc:UUID>${crypto.randomUUID()}</cbc:UUID>`,
    );
    const resUuid = cryptoService.verifyZatcaXadesXml(tamperedUuid, publicKeyPem);
    expect(resUuid.valid).toBe(false);
    expect(resUuid.invoiceDigestValid).toBe(false);

    // 3. Tamper xades:SigningTime inside SignedProperties
    const tamperedProps = signedXml.replace(
      '<xades:SigningTime>2026-11-14T12:00:00Z</xades:SigningTime>',
      '<xades:SigningTime>2026-11-14T12:00:01Z</xades:SigningTime>',
    );
    const resProps = cryptoService.verifyZatcaXadesXml(tamperedProps, publicKeyPem);
    expect(resProps.valid).toBe(false);
    expect(resProps.signedPropertiesDigestValid).toBe(false);

    // 4. Tamper ds:SignatureValue
    const tamperedSig = signedXml.replace(
      `<ds:SignatureValue>${xades.signatureBase64}</ds:SignatureValue>`,
      `<ds:SignatureValue>${Buffer.from('tampered-signature').toString('base64')}</ds:SignatureValue>`,
    );
    const resSig = cryptoService.verifyZatcaXadesXml(tamperedSig, publicKeyPem);
    expect(resSig.valid).toBe(false);
    expect(resSig.signatureValid).toBe(false);
    expect(independentValidateZatcaSignedXml(tamperedAmount, publicKeyPem, false).valid).toBe(false);
  });

  it('rejects certificate or public key substitution in independent and service verification', () => {
    const key1 = cryptoService.generateEcdsaKeyPair();
    const key2 = cryptoService.generateEcdsaKeyPair();
    const input = buildSampleInput({
      invoiceTypeCode: '388',
      invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      docNumber: 'DOC-KEY-SWAP-001',
      uuid: crypto.randomUUID(),
      icv: 4,
    });
    const ublXml = ublService.buildUblXml(input);
    const xades1 = cryptoService.signZatcaXades({
      ublXml,
      privateKeyPem: key1.privateKeyPem,
      signingTimeIso: '2026-11-14T12:00:00Z',
      allowSelfSignedFallback: true,
    });
    const xades2 = cryptoService.signZatcaXades({
      ublXml,
      privateKeyPem: key2.privateKeyPem,
      signingTimeIso: '2026-11-14T12:00:00Z',
      allowSelfSignedFallback: true,
    });
    const qrBase64 = cryptoService.encodeQrTlv({
      sellerName: input.seller.nameAr,
      vatNumber: input.seller.vatNumber,
      timestamp: '2026-11-14T12:00:00Z',
      invoiceTotal: '115.00',
      vatTotal: '15.00',
      invoiceHashBase64: xades1.invoiceHashBase64,
      ecdsaSignatureBase64: xades1.signatureBase64,
      publicKeyBase64: key1.publicKeyDerBase64,
    });
    const signedXml = ublService.injectSignatureAndQr(ublXml, qrBase64, xades1.signatureBase64, xades1);

    // Wrong public key
    expect(cryptoService.verifyZatcaXadesXml(signedXml, key2.publicKeyPem).valid).toBe(false);
    expect(independentValidateZatcaSignedXml(signedXml, key2.publicKeyPem, false).valid).toBe(false);

    // Swap X509Certificate inside XML to key2's cert
    const swappedCertXml = signedXml.replace(
      `<ds:X509Certificate>${xades1.certificateBase64}</ds:X509Certificate>`,
      `<ds:X509Certificate>${xades2.certificateBase64}</ds:X509Certificate>`,
    );
    expect(cryptoService.verifyZatcaXadesXml(swappedCertXml).valid).toBe(false);
    expect(independentValidateZatcaSignedXml(swappedCertXml, key1.publicKeyPem, false).valid).toBe(false);
  });

  it('blocks document signing & Simulation Gateway submission when real CSID is missing or self-signed', async () => {
    const { privateKeyPem } = cryptoService.generateEcdsaKeyPair();
    const input = buildSampleInput({
      invoiceTypeCode: '388',
      invoiceSubtype: ZatcaInvoiceSubtype.SIMPLIFIED_B2C,
      docNumber: 'DOC-NO-CSID-001',
      uuid: crypto.randomUUID(),
      icv: 5,
    });
    const ublXml = ublService.buildUblXml(input);

    // 1. Default allowSelfSignedFallback=false rejects missing/mock CSID
    expect(() =>
      cryptoService.signZatcaXades({
        ublXml,
        privateKeyPem,
      }),
    ).toThrow();
    expect(() =>
      cryptoService.signZatcaXades({
        ublXml,
        privateKeyPem,
        certificatePemOrBase64: Buffer.from('MOCK_CSID').toString('base64'),
      }),
    ).toThrow();

    // 2. Self-signed certificate generated for unit testing is rejected when allowSelfSignedFallback=false
    const unitTestXades = cryptoService.signZatcaXades({
      ublXml,
      privateKeyPem,
      allowSelfSignedFallback: true,
    });
    expect(cryptoService.isSelfSignedX509(unitTestXades.certificateBase64)).toBe(true);
    expect(() =>
      cryptoService.signZatcaXades({
        ublXml,
        privateKeyPem,
        certificatePemOrBase64: unitTestXades.certificateBase64,
        allowSelfSignedFallback: false,
      }),
    ).toThrow();

    // 3. ZatcaGatewayService.submitInvoice rejects self-signed / mock CSID in SIMULATION
    const gateway = new ZatcaGatewayService();
    await expect(
      gateway.submitInvoice({
        environment: ZatcaEnvironment.SIMULATION,
        submissionType: SubmissionType.REPORTING,
        binarySecurityToken: unitTestXades.certificateBase64,
        secret: 'dummy-secret',
        invoiceHash: unitTestXades.invoiceHashBase64,
        uuid: input.uuid,
        signedXmlBase64: Buffer.from(ublXml, 'utf8').toString('base64'),
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('never leaks OTPs or private keys in secret loader errors/summaries or signed XML', () => {
    const secretOtp = '847291';
    const prev = process.env.ZATCA_SIMULATION_OTP_MAP_JSON;
    try {
      process.env.ZATCA_SIMULATION_OTP_MAP_JSON = JSON.stringify({
        environment: 'SIMULATION',
        legalEntities: { 'le-1': { units: { 'pos-1': secretOtp } } },
      });
      const loader = new ZatcaOtpSecretsLoader();
      const summaryJson = JSON.stringify(loader.getSummary());
      expect(summaryJson).not.toContain(secretOtp);

      expect(() =>
        loader.resolveSimulationOtp({
          environment: 'SIMULATION',
          legalEntityId: 'le-1',
          unitIdentifier: 'pos-missing',
        }),
      ).toThrow();
    } finally {
      if (prev === undefined) delete process.env.ZATCA_SIMULATION_OTP_MAP_JSON;
      else process.env.ZATCA_SIMULATION_OTP_MAP_JSON = prev;
    }

    const { privateKeyPem } = cryptoService.generateEcdsaKeyPair();
    const input = buildSampleInput({
      invoiceTypeCode: '388',
      invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      docNumber: 'DOC-NO-LEAK-001',
      uuid: crypto.randomUUID(),
      icv: 6,
    });
    const ublXml = ublService.buildUblXml(input);
    const xades = cryptoService.signZatcaXades({
      ublXml,
      privateKeyPem,
      allowSelfSignedFallback: true,
    });
    expect(xades.ublExtensionsXml).not.toContain('PRIVATE KEY');
    expect(xades.ublExtensionsXml).not.toContain(privateKeyPem);
  });

  describe('CA Trust, Validity Dates, KeyUsage, and EGS/LegalEntity Binding', () => {
    function derLen(n: number): Buffer {
      if (n < 0x80) return Buffer.from([n]);
      const out: number[] = [];
      let v = n;
      while (v > 0) {
        out.unshift(v & 0xff);
        v >>= 8;
      }
      return Buffer.from([0x80 | out.length, ...out]);
    }
    function derTag(tag: number, content: Buffer): Buffer {
      return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
    }
    function derSeq(items: Buffer[]): Buffer {
      return derTag(0x30, Buffer.concat(items));
    }
    function derSet(items: Buffer[]): Buffer {
      return derTag(0x31, Buffer.concat(items));
    }
    function derOid(oid: string): Buffer {
      const p = oid.split('.').map(Number);
      const out: number[] = [40 * (p[0] ?? 0) + (p[1] ?? 0)];
      for (let i = 2; i < p.length; i++) {
        let val = p[i] ?? 0;
        const enc: number[] = [val & 0x7f];
        val >>= 7;
        while (val > 0) {
          enc.unshift((val & 0x7f) | 0x80);
          val >>= 7;
        }
        out.push(...enc);
      }
      return derTag(0x06, Buffer.from(out));
    }
    function derUtf8(s: string): Buffer {
      return derTag(0x0c, Buffer.from(s, 'utf8'));
    }
    function derPrintable(s: string): Buffer {
      return derTag(0x13, Buffer.from(s, 'ascii'));
    }
    function derAtv(oid: string, val: Buffer): Buffer {
      return derSet([derSeq([derOid(oid), val])]);
    }

    function buildTestX509CertPem(params: {
      subjectCn: string;
      issuerCn: string;
      subjectPublicKeyPem: string;
      issuerPrivateKeyPem: string;
      isCa: boolean;
      notBefore: Date;
      notAfter: Date;
      vatNumber?: string;
      unitSerialNumber?: string;
    }): string {
      const pubDer = crypto
        .createPublicKey(params.subjectPublicKeyPem)
        .export({ type: 'spki', format: 'der' }) as Buffer;
      const serial = crypto.randomBytes(8);
      serial[0] = ((serial[0] ?? 1) & 0x7f) || 0x01;
      const sigAlg = derSeq([derOid('1.2.840.10045.4.3.2')]);
      const subject = derSeq([
        derAtv('2.5.4.6', derPrintable('SA')),
        derAtv('2.5.4.3', derUtf8(params.subjectCn)),
      ]);
      const issuer = derSeq([
        derAtv('2.5.4.6', derPrintable('SA')),
        derAtv('2.5.4.3', derUtf8(params.issuerCn)),
      ]);
      const utc = (d: Date) =>
        derTag(
          0x17,
          Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z', 'ascii'),
        );
      const validity = derSeq([utc(params.notBefore), utc(params.notAfter)]);

      const basicConstraintsVal = params.isCa
        ? derSeq([derTag(0x01, Buffer.from([0xff]))])
        : derSeq([]);
      const extBasicConstraints = derSeq([
        derOid('2.5.29.19'),
        derTag(0x01, Buffer.from([0xff])),
        derTag(0x04, basicConstraintsVal),
      ]);

      const exts: Buffer[] = [extBasicConstraints];
      if (params.vatNumber || params.unitSerialNumber) {
        const sanItems: Buffer[] = [];
        if (params.unitSerialNumber) {
          sanItems.push(derAtv('2.5.4.5', derPrintable(params.unitSerialNumber)));
        }
        if (params.vatNumber) {
          sanItems.push(derAtv('0.9.2342.19200300.100.1.1', derUtf8(params.vatNumber)));
        }
        const sanVal = derSeq([derTag(0xa4, derSeq(sanItems))]);
        exts.push(derSeq([derOid('2.5.29.17'), derTag(0x04, sanVal)]));
      }

      const tbs = derSeq([
        derTag(0xa0, derTag(0x02, Buffer.from([0x02]))),
        derTag(0x02, serial),
        sigAlg,
        issuer,
        validity,
        subject,
        pubDer,
        derTag(0xa3, derSeq(exts)),
      ]);
      const sig = crypto.sign('sha256', tbs, params.issuerPrivateKeyPem);
      const der = derSeq([tbs, sigAlg, derTag(0x03, Buffer.concat([Buffer.from([0x00]), sig]))]);
      const b64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') || '';
      return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`;
    }

    it('rejects untrusted CA, missing trust store, expired cert, CA-as-CSID, and wrong EGS/LegalEntity binding', async () => {
      const now = new Date();
      const validFrom = new Date(now.getTime() - 3600 * 1000);
      const validTo = new Date(now.getTime() + 24 * 3600 * 1000);
      const expiredFrom = new Date(now.getTime() - 48 * 3600 * 1000);
      const expiredTo = new Date(now.getTime() - 3600 * 1000);

      const trustedCaKeys = cryptoService.generateEcdsaKeyPair();
      const untrustedCaKeys = cryptoService.generateEcdsaKeyPair();
      const egsKeys = cryptoService.generateEcdsaKeyPair();

      const trustedCaPem = buildTestX509CertPem({
        subjectCn: 'ZATCA-TEST-TRUSTED-CA',
        issuerCn: 'ZATCA-TEST-TRUSTED-CA',
        subjectPublicKeyPem: trustedCaKeys.publicKeyPem,
        issuerPrivateKeyPem: trustedCaKeys.privateKeyPem,
        isCa: true,
        notBefore: validFrom,
        notAfter: validTo,
      });

      const untrustedCaPem = buildTestX509CertPem({
        subjectCn: 'ATTACKER-ROGUE-CA',
        issuerCn: 'ATTACKER-ROGUE-CA',
        subjectPublicKeyPem: untrustedCaKeys.publicKeyPem,
        issuerPrivateKeyPem: untrustedCaKeys.privateKeyPem,
        isCa: true,
        notBefore: validFrom,
        notAfter: validTo,
      });

      const validCsidPem = buildTestX509CertPem({
        subjectCn: '310122393500003',
        issuerCn: 'ZATCA-TEST-TRUSTED-CA',
        subjectPublicKeyPem: egsKeys.publicKeyPem,
        issuerPrivateKeyPem: trustedCaKeys.privateKeyPem,
        isCa: false,
        notBefore: validFrom,
        notAfter: validTo,
        vatNumber: '310122393500003',
        unitSerialNumber: '1-RC|2-POS1|3-EGS001',
      });

      const untrustedCsidPem = buildTestX509CertPem({
        subjectCn: '310122393500003',
        issuerCn: 'ATTACKER-ROGUE-CA',
        subjectPublicKeyPem: egsKeys.publicKeyPem,
        issuerPrivateKeyPem: untrustedCaKeys.privateKeyPem,
        isCa: false,
        notBefore: validFrom,
        notAfter: validTo,
        vatNumber: '310122393500003',
        unitSerialNumber: '1-RC|2-POS1|3-EGS001',
      });

      const expiredCsidPem = buildTestX509CertPem({
        subjectCn: '310122393500003',
        issuerCn: 'ZATCA-TEST-TRUSTED-CA',
        subjectPublicKeyPem: egsKeys.publicKeyPem,
        issuerPrivateKeyPem: trustedCaKeys.privateKeyPem,
        isCa: false,
        notBefore: expiredFrom,
        notAfter: expiredTo,
        vatNumber: '310122393500003',
        unitSerialNumber: '1-RC|2-POS1|3-EGS001',
      });

      // 1. Valid CA-signed CSID with matching CA trust & EGS/LegalEntity binding passes
      const ok = cryptoService.validateCsidCertificateTrust({
        certificatePemOrBase64: validCsidPem,
        trustedCaCertsPem: [trustedCaPem],
        expectedBinding: {
          vatNumber: '310122393500003',
          unitSerialNumber: '1-RC|2-POS1|3-EGS001',
          requireExplicitCertBinding: true,
        },
        now,
      });
      expect(ok.trustedRootSubject).toContain('ZATCA-TEST-TRUSTED-CA');

      // 2. Cryptographically valid cert from UNTRUSTED CA (subject !== issuer!) MUST be rejected
      expect(() =>
        cryptoService.validateCsidCertificateTrust({
          certificatePemOrBase64: untrustedCsidPem,
          trustedCaCertsPem: [trustedCaPem],
          now,
        }),
      ).toThrow(ForbiddenException);

      // 3. Empty CA trust store MUST be rejected (subject !== issuer alone is never enough)
      const prevTrust = process.env.ZATCA_TRUSTED_CA_CERTS_PEM;
      delete process.env.ZATCA_TRUSTED_CA_CERTS_PEM;
      try {
        expect(() =>
          cryptoService.validateCsidCertificateTrust({
            certificatePemOrBase64: validCsidPem,
            now,
          }),
        ).toThrow(ForbiddenException);

        // 4. Gateway submitInvoice & requestProductionCsid reject untrusted CA cert in SIMULATION
        process.env.ZATCA_TRUSTED_CA_CERTS_PEM = trustedCaPem;
        const gateway = new ZatcaGatewayService();
        const untrustedBst = Buffer.from(untrustedCsidPem, 'utf8').toString('base64');
        await expect(
          gateway.submitInvoice({
            environment: ZatcaEnvironment.SIMULATION,
            submissionType: SubmissionType.REPORTING,
            binarySecurityToken: untrustedBst,
            secret: 'dummy',
            invoiceHash: 'dummy',
            uuid: crypto.randomUUID(),
            signedXmlBase64: Buffer.from('<Invoice/>', 'utf8').toString('base64'),
          }),
        ).rejects.toThrow(ForbiddenException);

        await expect(
          gateway.requestProductionCsid({
            environment: ZatcaEnvironment.SIMULATION,
            complianceRequestId: 'req-1',
            binarySecurityToken: untrustedBst,
            secret: 'dummy',
            unitIdentifier: 'EGS001',
          }),
        ).rejects.toThrow(ForbiddenException);
      } finally {
        if (prevTrust === undefined) delete process.env.ZATCA_TRUSTED_CA_CERTS_PEM;
        else process.env.ZATCA_TRUSTED_CA_CERTS_PEM = prevTrust;
      }

      // 5. Expired cert MUST be rejected
      expect(() =>
        cryptoService.validateCsidCertificateTrust({
          certificatePemOrBase64: expiredCsidPem,
          trustedCaCertsPem: [trustedCaPem],
          now,
        }),
      ).toThrow(ForbiddenException);

      // 6. CA cert passed as CSID MUST be rejected (ca === true)
      expect(() =>
        cryptoService.validateCsidCertificateTrust({
          certificatePemOrBase64: untrustedCaPem,
          trustedCaCertsPem: [trustedCaPem, untrustedCaPem],
          now,
        }),
      ).toThrow(ForbiddenException);

      // 7. Wrong Legal Entity VAT or wrong POS/EGS serial MUST be rejected
      expect(() =>
        cryptoService.validateCsidCertificateTrust({
          certificatePemOrBase64: validCsidPem,
          trustedCaCertsPem: [trustedCaPem],
          expectedBinding: {
            vatNumber: '399999999999993',
            unitSerialNumber: '1-RC|2-POS1|3-EGS001',
          },
          now,
        }),
      ).toThrow(ForbiddenException);

      expect(() =>
        cryptoService.validateCsidCertificateTrust({
          certificatePemOrBase64: validCsidPem,
          trustedCaCertsPem: [trustedCaPem],
          expectedBinding: {
            vatNumber: '310122393500003',
            unitSerialNumber: '1-RC|2-POS99|3-OTHER',
          },
          now,
        }),
      ).toThrow(ForbiddenException);
    });
  });
});
