import { Injectable } from '@nestjs/common';
import { EInvoiceType, ZatcaInvoiceSubtype } from '@restaurant-cloud/domain-kernel';

export interface ZatcaUblLineInput {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  taxRate?: number; // default 15
  taxCategoryCode?: 'S' | 'Z' | 'E' | 'O';
}

export interface ZatcaUblBuildInput {
  uuid: string;
  documentNumber: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  invoiceTypeCode: string; // '388' | '381' | '383'
  invoiceSubtype: string;  // '0100000' | '0200000'
  currency: string;
  icv: number;
  pih: string;
  seller: {
    vatNumber: string;
    name: string;
    crNumber?: string | null;
    streetName?: string | null;
    buildingNumber?: string | null;
    cityName?: string | null;
    postalZone?: string | null;
    districtName?: string | null;
    countryCode?: string;
  };
  buyer?: {
    name?: string | null;
    vatNumber?: string | null;
    streetName?: string | null;
    buildingNumber?: string | null;
    cityName?: string | null;
    postalZone?: string | null;
    countryCode?: string;
  };
  originalDocumentNumber?: string | null;
  originalDocumentUuid?: string | null;
  zatcaReasonCode?: string | null;
  subtotal: number;
  discountTotal: number;
  taxAmount: number;
  grandTotal: number;
  lines: ZatcaUblLineInput[];
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

@Injectable()
export class ZatcaUblService {
  /**
   * Maps domain EInvoiceType to UBL 2.1 TypeCode:
   * - 388 = Tax Invoice (Standard or Simplified)
   * - 381 = Credit Note (note: domain enum EInvoiceType.CREDIT_NOTE is '383' legacy, normalize to UBL '381' when credit note)
   * - 383 = Debit Note
   */
  resolveUblTypeCode(invoiceType: string): string {
    if (invoiceType === EInvoiceType.CREDIT_NOTE || invoiceType === 'CREDIT_NOTE' || invoiceType === '381') {
      return '381';
    }
    if (invoiceType === EInvoiceType.DEBIT_NOTE || invoiceType === 'DEBIT_NOTE' || invoiceType === '383') {
      return '383';
    }
    return '388';
  }

  buildUblXml(input: ZatcaUblBuildInput): string {
    const ublTypeCode = this.resolveUblTypeCode(input.invoiceTypeCode);
    const billingRefXml =
      ublTypeCode === '381' || ublTypeCode === '383'
        ? `
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${escapeXml(input.originalDocumentNumber || '')}</cbc:ID>
      <cbc:UUID>${escapeXml(input.originalDocumentUuid || '')}</cbc:UUID>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`
        : '';

    const paymentMeansReasonXml =
      (ublTypeCode === '381' || ublTypeCode === '383') && input.zatcaReasonCode
        ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>
    <cbc:InstructionNote>${escapeXml(input.zatcaReasonCode)}</cbc:InstructionNote>
  </cac:PaymentMeans>`
        : '';

    const buyerVatXml = input.buyer?.vatNumber
      ? `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(input.buyer.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
      : '';

    const linesXml = input.lines
      .map((l, idx) => {
        const rate = l.taxRate ?? 15;
        const cat = l.taxCategoryCode ?? 'S';
        const lineNet = Number((l.quantity * l.unitPrice - (l.discountAmount ?? 0)).toFixed(2));
        const lineTax = Number((lineNet * (rate / 100)).toFixed(2));
        const lineIncl = Number((lineNet + lineTax).toFixed(2));
        return `
  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${l.quantity.toFixed(4)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(input.currency)}">${lineNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${escapeXml(input.currency)}">${lineTax.toFixed(2)}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="${escapeXml(input.currency)}">${lineIncl.toFixed(2)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${escapeXml(l.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(input.currency)}">${l.unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
      })
      .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(input.documentNumber)}</cbc:ID>
  <cbc:UUID>${escapeXml(input.uuid)}</cbc:UUID>
  <cbc:IssueDate>${escapeXml(input.issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>${escapeXml(input.issueTime)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${escapeXml(input.invoiceSubtype)}">${ublTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(input.currency)}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${escapeXml(input.currency)}</cbc:TaxCurrencyCode>${billingRefXml}
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${input.icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(input.pih)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${escapeXml(input.seller.crNumber || '1010000000')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(input.seller.streetName || 'King Fahd Rd')}</cbc:StreetName>
        <cbc:BuildingNumber>${escapeXml(input.seller.buildingNumber || '1234')}</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${escapeXml(input.seller.districtName || 'Al Olaya')}</cbc:CitySubdivisionName>
        <cbc:CityName>${escapeXml(input.seller.cityName || 'Riyadh')}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(input.seller.postalZone || '12211')}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${escapeXml(input.seller.countryCode || 'SA')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(input.seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(input.seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(input.buyer?.streetName || 'N/A')}</cbc:StreetName>
        <cbc:CityName>${escapeXml(input.buyer?.cityName || 'Riyadh')}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(input.buyer?.postalZone || '12211')}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${escapeXml(input.buyer?.countryCode || 'SA')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${buyerVatXml}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(input.buyer?.name || 'Walk-in Customer')}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>${paymentMeansReasonXml}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(input.currency)}">${input.taxAmount.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(input.currency)}">${(input.subtotal - input.discountTotal).toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(input.currency)}">${input.taxAmount.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>15.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(input.currency)}">${input.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(input.currency)}">${(input.subtotal - input.discountTotal).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(input.currency)}">${input.grandTotal.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${escapeXml(input.currency)}">${input.discountTotal.toFixed(2)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${escapeXml(input.currency)}">${input.grandTotal.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${linesXml}
</Invoice>`;
  }

  injectSignatureAndQr(
    ublXml: string,
    qrBase64: string,
    signatureBase64: string,
    xades?: { ublExtensionsXml: string; cacSignatureXml: string },
  ): string {
    const qrRefXml = `  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(qrBase64)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>`;

    const ublExtensionsXml =
      xades?.ublExtensionsXml ||
      `  <ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
          <ds:SignatureValue>${escapeXml(signatureBase64)}</ds:SignatureValue>
        </ds:Signature>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;

    const cacSignatureXml =
      xades?.cacSignatureXml ||
      `  <cac:Signature>
    <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
    <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
  </cac:Signature>`;

    let out = ublXml;
    if (out.includes('<cbc:ProfileID>')) {
      out = out.replace('<cbc:ProfileID>', `${ublExtensionsXml.trim()}<cbc:ProfileID>`);
    } else {
      out = out.replace('</Invoice>', `${ublExtensionsXml}\n</Invoice>`);
    }

    if (out.includes('<cac:AccountingSupplierParty>')) {
      out = out.replace(
        '<cac:AccountingSupplierParty>',
        `${qrRefXml.trim()}${cacSignatureXml.trim()}<cac:AccountingSupplierParty>`,
      );
    } else {
      out = out.replace('</Invoice>', `${qrRefXml}\n${cacSignatureXml}\n</Invoice>`);
    }
    return out;
  }

  validateUblAndBrKsa(input: ZatcaUblBuildInput): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const ublTypeCode = this.resolveUblTypeCode(input.invoiceTypeCode);

    // BR-KSA-39 / 40: Seller VAT 15 digits starting and ending with 3
    if (!/^3\d{13}3$/.test(input.seller.vatNumber || '')) {
      errors.push('BR-KSA-39: Seller VAT number must be 15 digits starting and ending with 3');
    }
    if (!input.uuid || input.uuid.length < 10) {
      errors.push('BR-KSA-03: Document UUID is required');
    }
    if (!Number.isInteger(input.icv) || input.icv < 1) {
      errors.push('BR-KSA-33: ICV must be a positive integer >= 1');
    }
    if (!input.pih) {
      errors.push('BR-KSA-34: Previous Invoice Hash (PIH) is required');
    }

    // Standard B2B requires buyer VAT & name
    if (input.invoiceSubtype === ZatcaInvoiceSubtype.STANDARD_B2B) {
      if (!input.buyer?.vatNumber || !/^3\d{13}3$/.test(input.buyer.vatNumber)) {
        errors.push('BR-KSA-46: Standard B2B invoice requires valid 15-digit Buyer VAT number');
      }
      if (!input.buyer?.name) {
        errors.push('BR-KSA-44: Standard B2B invoice requires Buyer legal name');
      }
    }

    // Credit/Debit note requires BillingReference + Reason Code (BR-KSA-56 / BR-KSA-17)
    if (ublTypeCode === '381' || ublTypeCode === '383') {
      if (!input.originalDocumentNumber && !input.originalDocumentUuid) {
        errors.push('BR-KSA-56: Credit/Debit Note must reference original invoice number or UUID');
      }
      if (!input.zatcaReasonCode) {
        errors.push('BR-KSA-17: Credit/Debit Note requires ZATCA instruction reason code');
      }
    }

    if (!input.lines || input.lines.length === 0) {
      errors.push('BR-KSA-EN16931: Document must contain at least one invoice line');
    }

    // Monetary consistency check
    const expectedPayable = Number((input.subtotal - input.discountTotal + input.taxAmount).toFixed(2));
    if (Math.abs(expectedPayable - Number(input.grandTotal.toFixed(2))) > 0.05) {
      errors.push(
        `BR-KSA-EN16931: Grand total (${input.grandTotal.toFixed(2)}) does not match subtotal - discount + tax (${expectedPayable.toFixed(2)})`,
      );
    }

    return { valid: errors.length === 0, errors };
  }
}
