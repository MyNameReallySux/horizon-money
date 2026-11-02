import { describe, expect, it } from 'vitest';
import stubsResponse from '../fixtures/paystubs/stubs.response.json';
import yearsResponse from '../fixtures/paystubs/years.response.json';
import { isPaystubIndex, mergeIndex, stubFileName, type PaystubEntry } from './index.ts';
import { decodePdf, normalizePayDate, parseAmount, parseStubs, parseYears } from './payload.ts';

const entry = (over: Partial<PaystubEntry>): PaystubEntry => ({
  payDate: '2026-09-04',
  netPay: 3200,
  checkNumber: '1',
  voucherNumber: 'V-1',
  file: null,
  source: 'oasis',
  ...over,
});

describe('parseYears', () => {
  it('unwraps JSONOUT, drops malformed rows and sorts newest first', () => {
    expect(parseYears(yearsResponse)).toEqual(['2026', '2025']);
  });

  it('is empty for a payload of the wrong shape', () => {
    expect(parseYears(null)).toEqual([]);
    expect(parseYears({ JSONOUT: {} })).toEqual([]);
  });
});

describe('normalizePayDate', () => {
  it.each([
    ['09/04/2026', '2026-09-04'],
    ['9/4/2026', '2026-09-04'],
    ['2026-09-04', '2026-09-04'],
    ['2026-09-04T00:00:00', '2026-09-04'],
  ])('%s -> %s', (input, expected) => expect(normalizePayDate(input)).toBe(expected));

  it.each(['13/01/2026', '02/31/2026', 'soon', '', 5, null])('rejects %s', (input) =>
    expect(normalizePayDate(input)).toBeNull(),
  );
});

describe('parseAmount', () => {
  it('strips dollar signs and thousands separators', () => {
    expect(parseAmount('$1,234.50')).toBe(1234.5);
    expect(parseAmount('-12')).toBe(-12);
    expect(parseAmount(7)).toBe(7);
  });

  it.each(['', 'abc', '1.2.3', null])('rejects %s', (input) => expect(parseAmount(input)).toBeNull());
});

describe('parseStubs', () => {
  it('maps valid rows and counts the unusable ones', () => {
    const { stubs, skipped } = parseStubs(stubsResponse);
    expect(skipped).toBe(2);
    expect(stubs).toEqual([
      { payDate: '2026-09-04', netPay: 3200.5, checkNumber: '1001', voucherNumber: 'V-001', file: null, source: 'oasis' },
      { payDate: '2026-09-18', netPay: 3200, checkNumber: '1002', voucherNumber: 'V-002', file: null, source: 'oasis' },
    ]);
  });
});

describe('decodePdf', () => {
  it('returns the bytes of a base64 PDF', () => {
    expect(Array.from(decodePdf({ response: 'JVBERi0xLjQK' })!)).toEqual(
      Array.from(new TextEncoder().encode('%PDF-1.4\n')),
    );
  });

  it('rejects non-PDF bytes, bad base64 and a missing response', () => {
    expect(decodePdf({ response: btoa('<html>') })).toBeNull();
    expect(decodePdf({ response: '***' })).toBeNull();
    expect(decodePdf({})).toBeNull();
  });
});

describe('stubFileName', () => {
  it('builds <yyyy>/<date>_<voucher>.pdf', () => {
    expect(stubFileName('2026-09-04', 'V-001')).toBe('2026/2026-09-04_V-001.pdf');
  });

  it('strips path characters from the voucher', () => {
    expect(stubFileName('2026-09-04', '../x/y')).toBe('2026/2026-09-04_xy.pdf');
    expect(stubFileName('2026-09-04', '///')).toBe('2026/2026-09-04_stub.pdf');
  });
});

describe('mergeIndex', () => {
  it('dedupes by voucher, sorts by date and keeps a known file', () => {
    const merged = mergeIndex(
      [entry({ voucherNumber: 'V-2', payDate: '2026-09-18', file: '2026/a.pdf' }), entry({ voucherNumber: 'V-1' })],
      [
        entry({ voucherNumber: 'V-2', payDate: '2026-09-18', netPay: 3300 }),
        entry({ voucherNumber: 'V-3', payDate: '2026-10-02' }),
      ],
    );
    expect(merged.map((e) => e.voucherNumber)).toEqual(['V-1', 'V-2', 'V-3']);
    expect(merged[1]).toMatchObject({ netPay: 3300, file: '2026/a.pdf' });
  });

  it('lets an incoming file replace the old one', () => {
    const merged = mergeIndex([entry({ file: '2026/old.pdf' })], [entry({ file: '2026/new.pdf' })]);
    expect(merged[0]?.file).toBe('2026/new.pdf');
  });
});

describe('isPaystubIndex', () => {
  const good = { version: 1, updatedAt: '2026-11-01T00:00:00.000Z', stubs: [entry({ file: '2026/a.pdf' })] };

  it('accepts a valid index', () => expect(isPaystubIndex(good)).toBe(true));

  it.each([
    ['wrong version', { ...good, version: 2 }],
    ['missing stubs', { ...good, stubs: undefined }],
    ['bad date', { ...good, stubs: [entry({ payDate: '2026-13-01' })] }],
    ['empty voucher', { ...good, stubs: [entry({ voucherNumber: '' })] }],
    ['wrong source', { ...good, stubs: [{ ...entry({}), source: 'other' }] }],
    ['not an object', null],
  ])('rejects %s', (_name, value) => expect(isPaystubIndex(value)).toBe(false));
});
