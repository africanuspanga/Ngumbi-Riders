import { describe, it, expect } from 'vitest';
import {
  applyRiderDirectory,
  directoryFacets,
  matchesFilters,
  matchesSearch,
  paginate,
  sortRiders,
  EMPTY_FILTERS,
  type RiderDirectoryRow,
} from '@/lib/riders/directory';

const base: RiderDirectoryRow = {
  id: 'r1',
  riderNumber: 'NGR-R-0001',
  firstName: 'Daud',
  lastName: 'Mwakatika',
  middleName: null,
  fullName: 'Daud Mwakatika',
  phone: '+255712345678',
  email: 'daud@example.com',
  photoUrl: null,
  status: 'active',
  riskLevel: 'low',
  region: 'Dar es Salaam',
  district: 'Kinondoni',
  registeredAt: '2026-01-15T08:00:00.000Z',
  nidaLast4: null,
  motorcycleId: 'm1',
  motorcycleCode: 'NGR-DSM-KIN-M-0001',
  motorcycleRegistration: 'MC 123 ABC',
  contractId: 'c1',
  contractNumber: 'NGR-C-0001',
  contractStatus: 'active',
  contractStartDate: '2026-01-20',
  contractEndDate: '2026-12-31',
  amountPaid: 500_000,
  amountOutstanding: 0,
  amountDueNow: 0,
  dueNowCount: 0,
  projectedEndDate: null,
  outstandingCount: 0,
  overdueCount: 0,
  nextPaymentDate: '2026-08-01',
};

const row = (over: Partial<RiderDirectoryRow>): RiderDirectoryRow => ({ ...base, ...over });

describe('rider directory search (spec #2)', () => {
  it('searches by name, in any case', () => {
    expect(matchesSearch(base, 'daud')).toBe(true);
    expect(matchesSearch(base, 'MWAKATIKA')).toBe(true);
    expect(matchesSearch(base, 'kati')).toBe(true);
    expect(matchesSearch(base, 'juma')).toBe(false);
  });

  it('searches by phone regardless of formatting', () => {
    expect(matchesSearch(base, '0712345678')).toBe(true);
    expect(matchesSearch(base, '+255 712 345 678')).toBe(true);
    expect(matchesSearch(base, '712345678')).toBe(true);
    expect(matchesSearch(base, '345')).toBe(true);
    expect(matchesSearch(base, '999888777')).toBe(false);
  });

  it('searches by rider code, motorcycle registration and contract number', () => {
    expect(matchesSearch(base, 'NGR-R-0001')).toBe(true);
    expect(matchesSearch(base, 'mc 123')).toBe(true);
    expect(matchesSearch(base, 'NGR-DSM-KIN')).toBe(true);
    expect(matchesSearch(base, 'NGR-C-0001')).toBe(true);
  });

  it('matches a national ID by its last four digits only', () => {
    const withNida = row({ nidaLast4: '4321' });
    expect(matchesSearch(withNida, '19900101000000004321')).toBe(true);
    expect(matchesSearch(withNida, '4321')).toBe(true);
    expect(matchesSearch(base, '4321')).toBe(false); // none on file
  });

  it('treats an empty search as match-all', () => {
    expect(matchesSearch(base, '')).toBe(true);
    expect(matchesSearch(base, '   ')).toBe(true);
  });
});

describe('rider directory filters (spec #2)', () => {
  const f = (over: Partial<typeof EMPTY_FILTERS>) => ({ ...EMPTY_FILTERS, ...over });

  it('filters active riders', () => {
    expect(matchesFilters(base, f({ quick: 'active' }))).toBe(true);
    expect(matchesFilters(row({ status: 'terminated' }), f({ quick: 'active' }))).toBe(false);
  });

  it('filters riders with completed contracts', () => {
    expect(matchesFilters(row({ contractStatus: 'completed' }), f({ quick: 'contract_completed' }))).toBe(true);
    expect(
      matchesFilters(row({ contractStatus: 'ended_outstanding' }), f({ quick: 'contract_completed' })),
    ).toBe(true);
    expect(matchesFilters(base, f({ quick: 'contract_completed' }))).toBe(false);
  });

  it('filters riders with active contracts', () => {
    expect(matchesFilters(base, f({ quick: 'contract_active' }))).toBe(true);
    expect(matchesFilters(row({ contractStatus: 'upcoming' }), f({ quick: 'contract_active' }))).toBe(true);
    expect(matchesFilters(row({ contractStatus: 'terminated' }), f({ quick: 'contract_active' }))).toBe(false);
  });

  it('filters overdue and fully-paid riders', () => {
    const late = row({ overdueCount: 3, amountOutstanding: 30_000 });
    expect(matchesFilters(late, f({ quick: 'overdue' }))).toBe(true);
    expect(matchesFilters(base, f({ quick: 'overdue' }))).toBe(false);

    expect(matchesFilters(base, f({ quick: 'fully_paid' }))).toBe(true);
    expect(matchesFilters(late, f({ quick: 'fully_paid' }))).toBe(false);
    // No contract at all is not "fully paid".
    expect(matchesFilters(row({ contractId: null }), f({ quick: 'fully_paid' }))).toBe(false);
  });

  it('filters riders without a motorcycle', () => {
    expect(matchesFilters(row({ motorcycleId: null }), f({ quick: 'no_motorcycle' }))).toBe(true);
    expect(matchesFilters(base, f({ quick: 'no_motorcycle' }))).toBe(false);
  });

  it('filters by motorcycle, region and district', () => {
    expect(matchesFilters(base, f({ motorcycleId: 'm1' }))).toBe(true);
    expect(matchesFilters(base, f({ motorcycleId: 'm2' }))).toBe(false);
    expect(matchesFilters(base, f({ region: 'Dar es Salaam' }))).toBe(true);
    expect(matchesFilters(base, f({ region: 'Mwanza' }))).toBe(false);
    expect(matchesFilters(base, f({ district: 'kinondoni' }))).toBe(true);
  });

  it('filters by registration date range inclusively', () => {
    expect(matchesFilters(base, f({ registeredFrom: '2026-01-15' }))).toBe(true);
    expect(matchesFilters(base, f({ registeredTo: '2026-01-15' }))).toBe(true);
    expect(matchesFilters(base, f({ registeredFrom: '2026-01-16' }))).toBe(false);
    expect(matchesFilters(base, f({ registeredTo: '2026-01-14' }))).toBe(false);
  });
});

describe('rider directory sorting (spec #2)', () => {
  const a = row({ id: 'a', fullName: 'Amina Juma', registeredAt: '2026-03-01T00:00:00Z', contractStartDate: '2026-03-05', contractEndDate: '2026-06-30', amountOutstanding: 0, overdueCount: 0 });
  const b = row({ id: 'b', fullName: 'Bakari Said', registeredAt: '2026-01-01T00:00:00Z', contractStartDate: '2026-01-10', contractEndDate: '2026-12-31', amountOutstanding: 90_000, overdueCount: 2 });
  const c = row({ id: 'c', fullName: 'Chausiku Ali', registeredAt: '2026-02-01T00:00:00Z', contractStartDate: null, contractEndDate: null, amountOutstanding: 40_000, overdueCount: 0 });
  const rows = [b, c, a];

  const ids = (sorted: RiderDirectoryRow[]) => sorted.map((r) => r.id);

  it('sorts by name both ways', () => {
    expect(ids(sortRiders(rows, 'name_asc'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortRiders(rows, 'name_desc'))).toEqual(['c', 'b', 'a']);
  });

  it('sorts by registration date both ways', () => {
    expect(ids(sortRiders(rows, 'registered_desc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortRiders(rows, 'registered_asc'))).toEqual(['b', 'c', 'a']);
  });

  it('sorts by contract dates, putting riders with no contract last', () => {
    expect(ids(sortRiders(rows, 'contract_start'))).toEqual(['b', 'a', 'c']);
    expect(ids(sortRiders(rows, 'contract_end'))).toEqual(['a', 'b', 'c']);
  });

  it('sorts by payment status worst-first, then by balance', () => {
    expect(ids(sortRiders(rows, 'payment_status'))).toEqual(['b', 'c', 'a']);
  });

  it('sorts by outstanding balance', () => {
    expect(ids(sortRiders(rows, 'balance_desc'))).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [b, c, a];
    sortRiders(input, 'name_asc');
    expect(input.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('rider directory composition', () => {
  it('searches, filters and sorts together', () => {
    const rows = [
      row({ id: '1', fullName: 'Amina Juma', region: 'Mwanza', overdueCount: 1, amountOutstanding: 10_000 }),
      row({ id: '2', fullName: 'Amina Kessy', region: 'Mwanza', overdueCount: 4, amountOutstanding: 40_000 }),
      row({ id: '3', fullName: 'Bakari Said', region: 'Mwanza', overdueCount: 2, amountOutstanding: 20_000 }),
      row({ id: '4', fullName: 'Amina Zawadi', region: 'Arusha', overdueCount: 9, amountOutstanding: 90_000 }),
    ];
    const out = applyRiderDirectory(
      rows,
      { ...EMPTY_FILTERS, search: 'amina', quick: 'overdue', region: 'Mwanza' },
      'balance_desc',
    );
    expect(out.map((r) => r.id)).toEqual(['2', '1']);
  });

  it('derives facet options from the rows', () => {
    const facets = directoryFacets([
      base,
      row({ id: '2', region: 'Mwanza', district: 'Ilemela', motorcycleId: 'm2', motorcycleCode: 'X', motorcycleRegistration: null }),
      row({ id: '3', region: null, district: null, motorcycleId: null }),
    ]);
    expect(facets.regions).toEqual(['Dar es Salaam', 'Mwanza']);
    expect(facets.districts).toEqual(['Ilemela', 'Kinondoni']);
    expect(facets.motorcycles).toHaveLength(2);
  });

  it('paginates', () => {
    const rows = Array.from({ length: 55 }, (_, i) => row({ id: String(i) }));
    expect(paginate(rows, 1, 25)).toHaveLength(25);
    expect(paginate(rows, 3, 25)).toHaveLength(5);
    expect(paginate(rows, 4, 25)).toHaveLength(0);
    // Defensive: a junk page number must not return an empty screen.
    expect(paginate(rows, 0, 25)).toHaveLength(25);
    expect(paginate(rows, Number.NaN, 25)).toHaveLength(25);
  });
});
