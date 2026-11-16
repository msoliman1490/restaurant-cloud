import { Injectable, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { C14nCanonicalization, ExclusiveCanonicalization } from 'xml-crypto';
import * as xpath from 'xpath';

export interface ZatcaX509Metadata {
  certificateBase64: string;
  certDigestBase64: string;
  issuerName: string;
  serialNumberDecimal: string;
  certificateSignatureBase64: string;
}

export interface ZatcaXadesSignResult extends ZatcaX509Metadata {
  invoiceHashBase64: string;
  signatureBase64: string;
  signedPropertiesDigestBase64: string;
  signingTimeIso: string;
  ublExtensionsXml: string;
  cacSignatureXml: string;
}

export interface ZatcaXadesVerifyResult {
  valid: boolean;
  invoiceHashBase64: string;
  invoiceDigestValid: boolean;
  signedPropertiesDigestValid: boolean;
  signatureValid: boolean;
  errors: string[];
}

export interface ZatcaQrTlvPayload {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  invoiceTotal: string;
  vatTotal: string;
  invoiceHashBase64: string;
  ecdsaSignatureBase64: string;
  publicKeyBase64: string;
  certificateSignatureBase64?: string;
}

@Injectable()
export class ZatcaCryptoService {
  private getEncryptionKey(): Buffer {
    const secret =
      process.env.ZATCA_KEY_ENCRYPTION_SECRET ||
      process.env.JWT_SECRET ||
      'restaurant-cloud-staging-zatca-v2-key';
    return crypto.createHash('sha256').update(secret).digest();
  }

  encryptSecret(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  decryptSecret(ciphertext: string, ivBase64: string, authTagBase64: string): string {
    try {
      const key = this.getEncryptionKey();
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new InternalServerErrorException('فشل فك تشفير المفتاح الخاص أو رمز الأمان');
    }
  }

  hashOtp(otp: string): string {
    return crypto.createHash('sha256').update(otp.trim()).digest('hex');
  }

  generateEcdsaKeyPair(): { privateKeyPem: string; publicKeyPem: string; publicKeyDerBase64: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const der = crypto
      .createPublicKey(publicKey)
      .export({ type: 'spki', format: 'der' }) as Buffer;
    return {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      publicKeyDerBase64: der.toString('base64'),
    };
  }

  private derLength(len: number): Buffer {
    if (len < 0x80) return Buffer.from([len]);
    const bytes: number[] = [];
    let tmp = len;
    while (tmp > 0) {
      bytes.unshift(tmp & 0xff);
      tmp >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  }

  private derTag(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), this.derLength(content.length), content]);
  }

  private derSequence(items: Buffer[]): Buffer {
    return this.derTag(0x30, Buffer.concat(items));
  }

  private derSet(items: Buffer[]): Buffer {
    return this.derTag(0x31, Buffer.concat(items));
  }

  private derOid(oid: string): Buffer {
    const parts = oid.split('.').map(Number);
    const out: number[] = [40 * (parts[0] ?? 0) + (parts[1] ?? 0)];
    for (let i = 2; i < parts.length; i++) {
      let val = parts[i] ?? 0;
      const enc: number[] = [val & 0x7f];
      val >>= 7;
      while (val > 0) {
        enc.unshift((val & 0x7f) | 0x80);
        val >>= 7;
      }
      out.push(...enc);
    }
    return this.derTag(0x06, Buffer.from(out));
  }

  private derUtf8(str: string): Buffer {
    return this.derTag(0x0c, Buffer.from(str, 'utf8'));
  }

  private derPrintable(str: string): Buffer {
    return this.derTag(0x13, Buffer.from(str, 'ascii'));
  }

  private derAtv(oid: string, valBuf: Buffer): Buffer {
    return this.derSet([this.derSequence([this.derOid(oid), valBuf])]);
  }

  buildZatcaCsrPem(params: {
    commonName: string;
    serialNumber: string;
    organizationIdentifier: string;
    organizationUnitName: string;
    organizationName: string;
    countryName: string;
    invoiceType: string;
    locationAddress: string;
    industryBusinessCategory: string;
    publicKeyDerBase64: string;
    privateKeyPem: string;
    environment?: string;
  }): string {
    const templateName =
      params.environment === 'PRODUCTION' ? 'ZATCA-Code-Signing' : 'PREZATCA-Code-Signing';

    // Subject DN: C, OU, O, CN
    const subject = this.derSequence([
      this.derAtv('2.5.4.6', this.derPrintable(params.countryName || 'SA')),
      this.derAtv('2.5.4.11', this.derUtf8(params.organizationUnitName)),
      this.derAtv('2.5.4.10', this.derUtf8(params.organizationName)),
      this.derAtv('2.5.4.3', this.derUtf8(params.commonName)),
    ]);

    const spki = Buffer.from(params.publicKeyDerBase64, 'base64');

    // Extension 1: Certificate Template Name (OID 1.3.6.1.4.1.311.20.2)
    const extTemplate = this.derSequence([
      this.derOid('1.3.6.1.4.1.311.20.2'),
      this.derTag(0x04, this.derPrintable(templateName)),
    ]);

    // Extension 2: SubjectAltName (2.5.29.17) -> dirName [4]
    const dirName = this.derSequence([
      this.derAtv('2.5.4.5', this.derPrintable(params.serialNumber)), // SN
      this.derAtv('0.9.2342.19200300.100.1.1', this.derUtf8(params.organizationIdentifier)), // UID
      this.derAtv('2.5.4.12', this.derUtf8(params.invoiceType || '1100')), // title
      this.derAtv('2.5.4.26', this.derUtf8(params.locationAddress || 'Riyadh')), // registeredAddress
      this.derAtv('2.5.4.15', this.derUtf8(params.industryBusinessCategory || 'Food & Beverage')), // businessCategory
    ]);
    const sanValue = this.derSequence([this.derTag(0xa4, dirName)]);
    const extSan = this.derSequence([this.derOid('2.5.29.17'), this.derTag(0x04, sanValue)]);

    // Attributes [0] -> extensionRequest (1.2.840.113549.1.9.14)
    const extReq = this.derSequence([
      this.derOid('1.2.840.113549.1.9.14'),
      this.derSet([this.derSequence([extTemplate, extSan])]),
    ]);
    const attributes = this.derTag(0xa0, extReq);

    // CertificationRequestInfo: version(0), subject, spki, attributes
    const cri = this.derSequence([this.derTag(0x02, Buffer.from([0x00])), subject, spki, attributes]);

    // Sign with ECDSA-SHA256 (OID 1.2.840.10045.4.3.2)
    const sig = crypto.sign('sha256', cri, params.privateKeyPem);
    const sigAlg = this.derSequence([this.derOid('1.2.840.10045.4.3.2')]);
    const bitStringSig = this.derTag(0x03, Buffer.concat([Buffer.from([0x00]), sig]));

    const csrDer = this.derSequence([cri, sigAlg, bitStringSig]);
    const b64 = csrDer.toString('base64');
    const wrapped = b64.match(/.{1,64}/g)?.join('\n') || b64;
    return `-----BEGIN CERTIFICATE REQUEST-----\n${wrapped}\n-----END CERTIFICATE REQUEST-----`;
  }

  computeSha256Base64(input: string | Buffer): string {
    return crypto.createHash('sha256').update(input).digest('base64');
  }

  getGenesisPih(): string {
    return this.computeSha256Base64('0');
  }

  /**
   * Canonicalizes an XML string using W3C C14N (or Exclusive C14N) via xml-crypto
   * and normalizes line endings to LF (\n) per ZATCA XML signing guidelines.
   */
  canonicalizeXml(xml: string, exclusive = false): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (!doc?.documentElement) {
      throw new InternalServerErrorException('تعذر تحليل مستند XML للتحويل المعياري C14N');
    }
    const c14n = exclusive ? new ExclusiveCanonicalization() : new C14nCanonicalization();
    const result = c14n.process(doc.documentElement as unknown as Document, {});
    return String(result).replace(/\r\n/g, '\n');
  }

  /**
   * Removes ZATCA-excluded nodes (ext:UBLExtensions, root cac:Signature, and QR
   * cac:AdditionalDocumentReference) before canonicalizing for invoice hashing.
   */
  stripExcludedZatcaNodes(xml: string): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (!doc?.documentElement) {
      throw new InternalServerErrorException('تعذر تحليل مستند XML لاستبعاد العقد المستثناة');
    }

    const excludedQueries = [
      "//*[local-name()='UBLExtensions']",
      "//*[local-name()='Signature' and parent::*[local-name()='Invoice']]",
      "//*[local-name()='AdditionalDocumentReference' and *[local-name()='ID' and normalize-space(text())='QR']]",
    ];

    for (const query of excludedQueries) {
      const nodes = xpath.select(query, doc as unknown as Node) as unknown as Node[];
      for (const node of nodes) {
        if (node?.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    }

    const serialized = new XMLSerializer().serializeToString(doc.documentElement);
    return this.canonicalizeXml(serialized, false);
  }

  /**
   * Computes the official ZATCA invoice hash: Base64(SHA-256(C14N(Invoice - excluded nodes))).
   */
  computeZatcaInvoiceHash(xml: string): string {
    const canonical = this.stripExcludedZatcaNodes(xml);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('base64');
  }

  private readDerLength(buf: Buffer, offset: number): { length: number; nextOffset: number } {
    const first = buf[offset] ?? 0;
    if ((first & 0x80) === 0) {
      return { length: first, nextOffset: offset + 1 };
    }
    const numBytes = first & 0x7f;
    let length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | (buf[offset + 1 + i] ?? 0);
    }
    return { length, nextOffset: offset + 1 + numBytes };
  }

  private extractX509SignatureBytes(der: Buffer): Buffer {
    // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }
    if (der[0] !== 0x30) {
      throw new InternalServerErrorException('بنية شهادة X.509 غير صالحة (ASN.1 SEQUENCE مفقود)');
    }
    const outer = this.readDerLength(der, 1);
    let pos = outer.nextOffset;
    for (let idx = 0; idx < 2; idx++) {
      const len = this.readDerLength(der, pos + 1);
      pos = len.nextOffset + len.length;
    }
    if (der[pos] !== 0x03) {
      throw new InternalServerErrorException('تعذر استخراج توقيع الشهادة (BIT STRING مفقود)');
    }
    const bitLen = this.readDerLength(der, pos + 1);
    const bitPayload = der.subarray(bitLen.nextOffset, bitLen.nextOffset + bitLen.length);
    if (bitPayload.length <= 1) {
      throw new InternalServerErrorException('قيمة توقيع شهادة X.509 فارغة');
    }
    // Skip unused-bits byte (0x00)
    return bitPayload.subarray(1);
  }

  isSelfSignedX509(certificatePemOrBase64: string): boolean {
    const der = this.decodeCertificateInputToDer(certificatePemOrBase64);
    if (!der) return false;
    try {
      const x509 = new crypto.X509Certificate(der);
      return x509.subject === x509.issuer && x509.verify(x509.publicKey);
    } catch {
      return false;
    }
  }

  private buildSelfSignedX509Der(privateKeyPem: string, commonName = 'ZATCA-STAGING-EGS'): Buffer {
    const pubDer = crypto
      .createPublicKey(privateKeyPem)
      .export({ type: 'spki', format: 'der' }) as Buffer;
    const serial = Buffer.from(crypto.randomBytes(8));
    serial[0] = (serial[0] ?? 0) & 0x7f;
    if (serial[0] === 0) serial[0] = 0x01;

    const sigAlg = this.derSequence([this.derOid('1.2.840.10045.4.3.2')]); // ecdsa-with-SHA256
    const issuer = this.derSequence([
      this.derAtv('2.5.4.6', this.derPrintable('SA')),
      this.derAtv('2.5.4.3', this.derUtf8(commonName)),
    ]);
    const now = new Date();
    const utc = (d: Date) =>
      this.derTag(
        0x17,
        Buffer.from(
          d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z',
          'ascii',
        ),
      );
    const validity = this.derSequence([
      utc(now),
      utc(new Date(now.getTime() + 365 * 24 * 3600 * 1000)),
    ]);

    const tbs = this.derSequence([
      this.derTag(0xa0, this.derTag(0x02, Buffer.from([0x02]))), // v3
      this.derTag(0x02, serial),
      sigAlg,
      issuer,
      validity,
      issuer,
      pubDer,
    ]);
    const sig = crypto.sign('sha256', tbs, privateKeyPem);
    return this.derSequence([
      tbs,
      sigAlg,
      this.derTag(0x03, Buffer.concat([Buffer.from([0x00]), sig])),
    ]);
  }

  private decodeCertificateInputToDer(certificatePemOrBase64?: string): Buffer | null {
    if (!certificatePemOrBase64?.trim()) return null;
    const raw = certificatePemOrBase64.trim();

    if (raw.includes('-----BEGIN CERTIFICATE-----')) {
      const b64 = raw.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, '');
      return Buffer.from(b64, 'base64');
    }

    const decoded = Buffer.from(raw, 'base64');
    const decodedText = decoded.toString('utf8');
    if (decodedText.includes('-----BEGIN CERTIFICATE-----')) {
      const b64 = decodedText.replace(
        /-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g,
        '',
      );
      return Buffer.from(b64, 'base64');
    }
    return decoded;
  }

  /**
   * Parses X.509 certificate metadata (DER Base64, SHA-256 CertDigest, Issuer DN,
   * decimal SerialNumber, and certificate signature bytes for QR Tag 9).
   */
  parseX509CertificateMetadata(
    certificatePemOrBase64?: string,
    fallbackPrivateKeyPem?: string,
    allowSelfSignedFallback = false,
  ): ZatcaX509Metadata {
    let der = this.decodeCertificateInputToDer(certificatePemOrBase64);
    let x509: crypto.X509Certificate | null = null;
    if (der) {
      try {
        x509 = new crypto.X509Certificate(der);
      } catch {
        x509 = null;
      }
    }

    if (!x509) {
      if (!allowSelfSignedFallback || !fallbackPrivateKeyPem) {
        throw new InternalServerErrorException(
          'شهادة CSID حقيقية من ZATCA مطلوبة؛ يمنع إصدار أو توقيع المستندات بدون شهادة X.509 صالحة.',
        );
      }
      der = this.buildSelfSignedX509Der(fallbackPrivateKeyPem);
      x509 = new crypto.X509Certificate(der);
    } else if (!allowSelfSignedFallback && x509.subject === x509.issuer && x509.verify(x509.publicKey)) {
      throw new InternalServerErrorException(
        'ممنوع استخدام شهادة X.509 ذاتية التوقيع (Self-Signed) في مسار إصدار أو إرسال مستندات ZATCA.',
      );
    }

    const certDer = der!;
    const certDigestBase64 = crypto.createHash('sha256').update(certDer).digest('base64');
    const issuerName = x509.issuer.replace(/\r?\n/g, ', ');
    const serialNumberDecimal = BigInt('0x' + x509.serialNumber).toString(10);
    const certificateSignatureBase64 = this.extractX509SignatureBytes(certDer).toString('base64');

    return {
      certificateBase64: certDer.toString('base64'),
      certDigestBase64,
      issuerName,
      serialNumberDecimal,
      certificateSignatureBase64,
    };
  }

  /**
   * Loads trusted ZATCA CA / SubCA certificates from explicit PEMs or
   * ZATCA_TRUSTED_CA_CERTS_PEM / ZATCA_TRUSTED_CA_BUNDLE_PATH.
   */
  loadTrustedCaCertificates(overridePems?: string[]): crypto.X509Certificate[] {
    const pemSources: string[] = [];
    if (overridePems?.length) {
      pemSources.push(...overridePems);
    } else {
      if (process.env.ZATCA_TRUSTED_CA_CERTS_PEM?.trim()) {
        pemSources.push(process.env.ZATCA_TRUSTED_CA_CERTS_PEM);
      }
      const bundlePath =
        process.env.ZATCA_TRUSTED_CA_BUNDLE_PATH?.trim() ||
        path.join(process.cwd(), '.zatca-secrets', 'zatca-simulation-ca-bundle.pem');
      if (bundlePath && fs.existsSync(bundlePath)) {
        pemSources.push(fs.readFileSync(bundlePath, 'utf8'));
      }
    }

    const certs: crypto.X509Certificate[] = [];
    const pemRegex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    for (const src of pemSources) {
      const matches = src.match(pemRegex);
      if (matches) {
        for (const pem of matches) {
          try {
            certs.push(new crypto.X509Certificate(pem));
          } catch {
            // Ignore malformed PEM block; valid count checked by caller
          }
        }
      }
    }
    return certs;
  }

  private verifyChainToTrustedRoot(
    leaf: crypto.X509Certificate,
    trustedCas: crypto.X509Certificate[],
    now: Date,
  ): { trusted: boolean; issuerSubject?: string; reason?: string } {
    if (trustedCas.length === 0) {
      return {
        trusted: false,
        reason:
          'لا توجد شهادات ZATCA CA موثوقة مهيأة (ZATCA_TRUSTED_CA_CERTS_PEM / ZATCA_TRUSTED_CA_BUNDLE_PATH).',
      };
    }

    let current: crypto.X509Certificate = leaf;
    for (let depth = 0; depth < 5; depth++) {
      const issuer = trustedCas.find(
        (ca) =>
          ca.validFromDate <= now &&
          now <= ca.validToDate &&
          current.checkIssued(ca) &&
          current.verify(ca.publicKey),
      );
      if (!issuer) {
        return {
          trusted: false,
          reason: 'شهادة CSID غير موقعة من شهادة CA موثوقة ومعتمدة أو أن شهادة الـ CA منتهية الصلاحية.',
        };
      }
      if (issuer.subject === issuer.issuer && issuer.verify(issuer.publicKey)) {
        return { trusted: true, issuerSubject: issuer.subject };
      }
      current = issuer;
    }

    return { trusted: false, reason: 'تجاوزت سلسلة الشهادات العمق الأقصى المسموح به.' };
  }

  /**
   * Cryptographically validates a ZATCA CSID X.509 certificate:
   * - Rejects self-signed certificates
   * - Enforces validity window (validFromDate <= now <= validToDate)
   * - Enforces end-entity (ca=false), ECDSA key, and signing keyUsage
   * - Verifies cryptographic signature chain against trusted ZATCA CA certificates
   * - Verifies Legal Entity VAT & EGS serial binding when present/required
   */
  validateCsidCertificateTrust(params: {
    certificatePemOrBase64: string;
    trustedCaCertsPem?: string[];
    expectedBinding?: {
      vatNumber?: string;
      unitSerialNumber?: string;
      requireExplicitCertBinding?: boolean;
    };
    now?: Date;
  }): {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    trustedRootSubject: string;
  } {
    const der = this.decodeCertificateInputToDer(params.certificatePemOrBase64);
    if (!der) {
      throw new ForbiddenException('شهادة CSID مفقودة أو فارغة.');
    }

    let x509: crypto.X509Certificate;
    try {
      x509 = new crypto.X509Certificate(der);
    } catch {
      throw new ForbiddenException('تنسيق شهادة X.509 CSID غير صالح.');
    }

    // 1. Reject self-signed certificates
    if (x509.subject === x509.issuer && x509.verify(x509.publicKey)) {
      throw new ForbiddenException('ممنوع قبول شهادة X.509 ذاتية التوقيع (Self-Signed).');
    }

    // 2. Enforce validity dates
    const now = params.now ?? new Date();
    if (now < x509.validFromDate) {
      throw new ForbiddenException('شهادة CSID لم يبدأ سريانها بعد.');
    }
    if (now > x509.validToDate) {
      throw new ForbiddenException('شهادة CSID منتهية الصلاحية.');
    }

    // 3. Enforce end-entity CSID, ECDSA algorithm, and signing KeyUsage / EKU
    if (x509.ca) {
      throw new ForbiddenException('شهادة CSID لا يجوز أن تكون شهادة CA.');
    }
    if (x509.publicKey.asymmetricKeyType !== 'ec') {
      throw new ForbiddenException('شهادة CSID يجب أن تستخدم مفتاح ECDSA.');
    }
    if (Array.isArray(x509.keyUsage) && x509.keyUsage.length > 0) {
      const hasSigningUsage = x509.keyUsage.some((u) =>
        /digitalSignature|nonRepudiation|contentCommitment|1\.3\.6\.1\.5\.5\.7\.3\.3|codeSigning/i.test(
          u,
        ),
      );
      if (!hasSigningUsage) {
        throw new ForbiddenException('شهادة CSID لا تحقق متطلبات Key Usage / Extended Key Usage للتوقيع.');
      }
    }

    // 4. Verify cryptographic chain against trusted ZATCA CA certificates
    const trustedCas = this.loadTrustedCaCertificates(params.trustedCaCertsPem);
    const chainCheck = this.verifyChainToTrustedRoot(x509, trustedCas, now);
    if (!chainCheck.trusted) {
      throw new ForbiddenException(
        chainCheck.reason || 'فشل التحقق من ثقة الجهة المصدرة للشهادة (CA Trust).',
      );
    }

    // 5. Verify Legal Entity VAT & POS/EGS Serial binding
    if (params.expectedBinding) {
      const searchableText = `${x509.subject}\n${x509.subjectAltName || ''}\n${der.toString('latin1')}`;
      const { vatNumber, unitSerialNumber, requireExplicitCertBinding } = params.expectedBinding;

      if (vatNumber) {
        const vatMatches: string[] = searchableText.match(/3\d{13}3/g) ?? [];
        if (vatMatches.length > 0 && !vatMatches.includes(vatNumber)) {
          throw new ForbiddenException(
            'شهادة CSID مرتبطة برقم ضريبي (Legal Entity) مختلف عن المنشأة المطلوبة.',
          );
        }
        if (requireExplicitCertBinding && !vatMatches.includes(vatNumber)) {
          throw new ForbiddenException(
            'شهادة CSID لا تحتوي على الرقم الضريبي للمنشأة القانونية المطلوبة.',
          );
        }
      }

      if (unitSerialNumber) {
        const serialMatches: string[] =
          searchableText.match(/1-[^|\x00-\x1f]+\|2-[^|\x00-\x1f]+\|3-[A-Za-z0-9-]+/g) ?? [];
        if (serialMatches.length > 0 && !serialMatches.includes(unitSerialNumber)) {
          throw new ForbiddenException(
            'شهادة CSID مرتبطة بوحدة POS/EGS مختلفة عن الوحدة المطلوبة.',
          );
        }
        if (requireExplicitCertBinding && !serialMatches.includes(unitSerialNumber)) {
          throw new ForbiddenException(
            'شهادة CSID لا تحتوي على معرف وحدة POS/EGS المطلوبة.',
          );
        }
      }
    }

    return {
      subject: x509.subject.replace(/\r?\n/g, ', '),
      issuer: x509.issuer.replace(/\r?\n/g, ', '),
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      trustedRootSubject: (chainCheck.issuerSubject || '').replace(/\r?\n/g, ', '),
    };
  }

  /**
   * Signs a UBL 2.1 invoice according to ZATCA Phase 2 XAdES-BES specification:
   * - Excludes UBLExtensions, root Signature, and QR AdditionalDocumentReference
   * - Canonicalizes with W3C C14N via xml-crypto
   * - Builds xades:SignedProperties and computes its Exc-C14N SHA-256 digest
   * - Signs canonicalized ds:SignedInfo with ECDSA-SHA256
   */
  signZatcaXades(params: {
    ublXml: string;
    privateKeyPem: string;
    certificatePemOrBase64?: string;
    signingTimeIso?: string;
    allowSelfSignedFallback?: boolean;
  }): ZatcaXadesSignResult {
    const invoiceHashBase64 = this.computeZatcaInvoiceHash(params.ublXml);
    const certMeta = this.parseX509CertificateMetadata(
      params.certificatePemOrBase64,
      params.privateKeyPem,
      Boolean(params.allowSelfSignedFallback),
    );
    const signingTimeIso =
      (params.signingTimeIso || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z');

    const signedPropertiesXml = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${signingTimeIso}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certMeta.certDigestBase64}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certMeta.issuerName}</ds:X509IssuerName><ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certMeta.serialNumberDecimal}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`;

    const canonicalSignedProps = this.canonicalizeXml(signedPropertiesXml, true);
    const signedPropertiesDigestBase64 = crypto
      .createHash('sha256')
      .update(canonicalSignedProps, 'utf8')
      .digest('base64');

    const signedInfoXml = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceHashBase64}</ds:DigestValue></ds:Reference><ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropertiesDigestBase64}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

    const canonicalSignedInfo = this.canonicalizeXml(signedInfoXml, false);
    const signatureBase64 = crypto
      .sign('sha256', Buffer.from(canonicalSignedInfo, 'utf8'), params.privateKeyPem)
      .toString('base64');

    const ublExtensionsXml = `  <ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
    <ext:UBLExtension>
      <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
      <ext:ExtensionContent>
        <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
          <sac:SignatureInformation>
            <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
            <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
            <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
              ${signedInfoXml}
              <ds:SignatureValue>${signatureBase64}</ds:SignatureValue>
              <ds:KeyInfo>
                <ds:X509Data>
                  <ds:X509Certificate>${certMeta.certificateBase64}</ds:X509Certificate>
                </ds:X509Data>
              </ds:KeyInfo>
              <ds:Object>
                <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">
                  ${signedPropertiesXml}
                </xades:QualifyingProperties>
              </ds:Object>
            </ds:Signature>
          </sac:SignatureInformation>
        </sig:UBLDocumentSignatures>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;

    const cacSignatureXml = `  <cac:Signature>
    <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
    <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
  </cac:Signature>`;

    return {
      ...certMeta,
      invoiceHashBase64,
      signatureBase64,
      signedPropertiesDigestBase64,
      signingTimeIso,
      ublExtensionsXml,
      cacSignatureXml,
    };
  }

  /**
   * Verifies a signed ZATCA UBL 2.1 XML document using xml-crypto C14N and ECDSA-SHA256:
   * 1. Recomputes invoice digest (excluding UBLExtensions, cac:Signature, QR)
   * 2. Recomputes xades:SignedProperties Exc-C14N digest
   * 3. Verifies ds:SignatureValue over canonicalized ds:SignedInfo
   */
  verifyZatcaXadesXml(signedXml: string, publicKeyPem?: string): ZatcaXadesVerifyResult {
    const errors: string[] = [];
    const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
    if (!doc?.documentElement) {
      return {
        valid: false,
        invoiceHashBase64: '',
        invoiceDigestValid: false,
        signedPropertiesDigestValid: false,
        signatureValid: false,
        errors: ['Invalid XML document'],
      };
    }

    const invoiceHashBase64 = this.computeZatcaInvoiceHash(signedXml);

    const invoiceRefNodes = xpath.select(
      "//*[local-name()='Reference' and @URI='']/*[local-name()='DigestValue']",
      doc as unknown as Node,
    ) as unknown as Node[];
    const embeddedInvoiceDigest = invoiceRefNodes[0]?.textContent?.trim() || '';
    const invoiceDigestValid =
      Boolean(embeddedInvoiceDigest) && embeddedInvoiceDigest === invoiceHashBase64;
    if (!invoiceDigestValid) {
      errors.push('Invoice digest mismatch (XML body tampered or canonicalization mismatch)');
    }

    const spNodes = xpath.select(
      "//*[local-name()='SignedProperties' and @Id='xadesSignedProperties']",
      doc as unknown as Node,
    ) as unknown as Node[];
    const spRefNodes = xpath.select(
      "//*[local-name()='Reference' and @URI='#xadesSignedProperties']/*[local-name()='DigestValue']",
      doc as unknown as Node,
    ) as unknown as Node[];
    let signedPropertiesDigestValid = false;
    if (spNodes[0] && spRefNodes[0]) {
      const spXml = new XMLSerializer().serializeToString(
        spNodes[0] as unknown as Parameters<XMLSerializer['serializeToString']>[0],
      );
      const canonicalSp = this.canonicalizeXml(spXml, true);
      const computedSpDigest = crypto
        .createHash('sha256')
        .update(canonicalSp, 'utf8')
        .digest('base64');
      const embeddedSpDigest = spRefNodes[0].textContent?.trim() || '';
      signedPropertiesDigestValid = computedSpDigest === embeddedSpDigest;
    }
    if (!signedPropertiesDigestValid) {
      errors.push('xades:SignedProperties digest mismatch');
    }

    const signedInfoNodes = xpath.select(
      "//*[local-name()='SignedInfo']",
      doc as unknown as Node,
    ) as unknown as Node[];
    const sigValNodes = xpath.select(
      "//*[local-name()='SignatureValue']",
      doc as unknown as Node,
    ) as unknown as Node[];
    const x509Nodes = xpath.select(
      "//*[local-name()='X509Certificate']",
      doc as unknown as Node,
    ) as unknown as Node[];

    let signatureValid = false;
    if (signedInfoNodes[0] && sigValNodes[0]) {
      const siXml = new XMLSerializer().serializeToString(
        signedInfoNodes[0] as unknown as Parameters<XMLSerializer['serializeToString']>[0],
      );
      const canonicalSi = this.canonicalizeXml(siXml, false);
      const sigVal = sigValNodes[0].textContent?.trim() || '';
      let verifyKey: string | crypto.KeyObject | undefined = publicKeyPem;
      if (!verifyKey && x509Nodes[0]?.textContent?.trim()) {
        const certDer = Buffer.from(x509Nodes[0].textContent.trim(), 'base64');
        verifyKey = new crypto.X509Certificate(certDer).publicKey;
      }
      if (verifyKey && sigVal) {
        try {
          signatureValid = crypto.verify(
            'sha256',
            Buffer.from(canonicalSi, 'utf8'),
            verifyKey,
            Buffer.from(sigVal, 'base64'),
          );
        } catch {
          signatureValid = false;
        }
      }
    }
    if (!signatureValid) {
      errors.push('ECDSA ds:SignatureValue verification failed');
    }

    return {
      valid: invoiceDigestValid && signedPropertiesDigestValid && signatureValid,
      invoiceHashBase64,
      invoiceDigestValid,
      signedPropertiesDigestValid,
      signatureValid,
      errors,
    };
  }

  signXmlHash(xml: string, privateKeyPem: string): { invoiceHashBase64: string; signatureBase64: string } {
    const canonical = this.stripExcludedZatcaNodes(xml);
    const invoiceHashBase64 = crypto.createHash('sha256').update(canonical, 'utf8').digest('base64');
    const signatureBase64 = crypto
      .sign('sha256', Buffer.from(canonical, 'utf8'), privateKeyPem)
      .toString('base64');
    return { invoiceHashBase64, signatureBase64 };
  }

  verifyXmlSignature(xml: string, signatureBase64: string, publicKeyPem: string): boolean {
    try {
      const canonical = this.stripExcludedZatcaNodes(xml);
      return crypto.verify(
        'sha256',
        Buffer.from(canonical, 'utf8'),
        publicKeyPem,
        Buffer.from(signatureBase64, 'base64'),
      );
    } catch {
      return false;
    }
  }

  private tlvField(tag: number, value: string | Buffer): Buffer {
    const valBuf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    if (valBuf.length <= 255) {
      return Buffer.concat([Buffer.from([tag, valBuf.length]), valBuf]);
    }
    // Extended length TLV if > 255 bytes
    return Buffer.concat([Buffer.from([tag, 0x82, (valBuf.length >> 8) & 0xff, valBuf.length & 0xff]), valBuf]);
  }

  encodeQrTlv(payload: ZatcaQrTlvPayload): string {
    const parts: Buffer[] = [
      this.tlvField(1, payload.sellerName),
      this.tlvField(2, payload.vatNumber),
      this.tlvField(3, payload.timestamp),
      this.tlvField(4, payload.invoiceTotal),
      this.tlvField(5, payload.vatTotal),
      this.tlvField(6, payload.invoiceHashBase64),
      this.tlvField(7, payload.ecdsaSignatureBase64),
      this.tlvField(8, Buffer.from(payload.publicKeyBase64, 'base64')),
    ];
    if (payload.certificateSignatureBase64) {
      parts.push(this.tlvField(9, Buffer.from(payload.certificateSignatureBase64, 'base64')));
    }
    return Buffer.concat(parts).toString('base64');
  }

  decodeQrTlv(qrBase64: string): Record<number, Buffer> {
    const buf = Buffer.from(qrBase64, 'base64');
    const result: Record<number, Buffer> = {};
    let offset = 0;
    while (offset < buf.length) {
      const tag = buf[offset++] ?? 0;
      let len = buf[offset++] ?? 0;
      if (len === 0x82) {
        len = ((buf[offset] ?? 0) << 8) | (buf[offset + 1] ?? 0);
        offset += 2;
      }
      result[tag] = buf.subarray(offset, offset + len);
      offset += len;
    }
    return result;
  }

  verifyQrTlv(
    qrBase64: string,
    expected: {
      vatNumber: string;
      invoiceTotal: string;
      vatTotal: string;
      invoiceHashBase64: string;
      ecdsaSignatureBase64?: string;
      publicKeyBase64?: string;
      requireTag9?: boolean;
    },
  ): { valid: boolean; tagsPresent: number[]; errors: string[] } {
    const errors: string[] = [];
    const tags = this.decodeQrTlv(qrBase64);
    const tagsPresent = Object.keys(tags).map(Number).sort((a, b) => a - b);

    for (const requiredTag of [1, 2, 3, 4, 5, 6, 7, 8]) {
      if (!tags[requiredTag] || tags[requiredTag].length === 0) {
        errors.push(`Missing TLV tag ${requiredTag}`);
      }
    }
    if (expected.requireTag9 && (!tags[9] || tags[9].length === 0)) {
      errors.push('Missing TLV tag 9 (Certificate Signature for Simplified B2C)');
    }
    if (tags[2] && tags[2].toString('utf8') !== expected.vatNumber) {
      errors.push('TLV tag 2 (VAT Number) mismatch');
    }
    if (tags[4] && tags[4].toString('utf8') !== expected.invoiceTotal) {
      errors.push('TLV tag 4 (Invoice Total) mismatch');
    }
    if (tags[5] && tags[5].toString('utf8') !== expected.vatTotal) {
      errors.push('TLV tag 5 (VAT Total) mismatch');
    }
    if (tags[6] && tags[6].toString('utf8') !== expected.invoiceHashBase64) {
      errors.push('TLV tag 6 (Invoice Hash) mismatch');
    }
    if (expected.ecdsaSignatureBase64 && tags[7]?.toString('utf8') !== expected.ecdsaSignatureBase64) {
      errors.push('TLV tag 7 (ECDSA Signature) mismatch');
    }
    if (expected.publicKeyBase64 && tags[8]?.toString('base64') !== expected.publicKeyBase64) {
      errors.push('TLV tag 8 (Public Key) mismatch');
    }

    return { valid: errors.length === 0, tagsPresent, errors };
  }
}
