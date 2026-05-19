import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAgency,
  normalizeVehicle,
  normalizeSetAside,
  asStringArray,
} from './highergov-slugs.js';

test('normalizeAgency returns null for empty/missing inputs', () => {
  assert.equal(normalizeAgency(undefined), null);
  assert.equal(normalizeAgency(null), null);
  assert.equal(normalizeAgency(''), null);
  assert.equal(normalizeAgency('   '), null);
});

test('normalizeAgency maps known agency names', () => {
  assert.equal(normalizeAgency('Department of Veterans Affairs'), 'va');
  assert.equal(normalizeAgency('Department of Defense'), 'dod');
});

test('normalizeAgency falls back to a slug for unknown strings', () => {
  assert.equal(normalizeAgency('Some Unknown Office'), 'some-unknown-office');
});

test('normalizeAgency handles HigherGov nested object payloads', () => {
  // Reproduces the production crash: HigherGov returns objects for agency
  // fields in forecast responses, e.g. {name: 'Department of Defense'}.
  assert.equal(normalizeAgency({ name: 'Department of Defense', code: '9700' } as any), 'dod');
  assert.equal(normalizeAgency({ label: 'GSA' } as any), 'gsa');
  assert.equal(normalizeAgency({ display_name: 'NASA' } as any), 'nasa');
  assert.equal(normalizeAgency({} as any), null);
});

test('normalizeAgency handles numeric and boolean inputs without crashing', () => {
  assert.equal(normalizeAgency(9700 as any), '9700');
  assert.equal(normalizeAgency(false as any), null);
});

test('normalizeAgency picks the first usable string from an array', () => {
  assert.equal(normalizeAgency(['Department of Defense'] as any), 'dod');
  assert.equal(normalizeAgency([null, '', 'GSA'] as any), 'gsa');
  assert.equal(normalizeAgency([] as any), null);
});

test('normalizeVehicle handles object payloads', () => {
  assert.equal(normalizeVehicle({ name: 'Seaport NxG' } as any), 'seaport-nxg');
  assert.equal(normalizeVehicle({ value: 'OASIS+' } as any), 'oasis-plus');
  assert.equal(normalizeVehicle(null), null);
});

test('asStringArray extracts the inner code from HigherGov nested objects', () => {
  // Real HigherGov shapes seen in /opportunity/ responses.
  assert.deepEqual(asStringArray({ naics_code: '238220' }), ['238220']);
  assert.deepEqual(asStringArray({ psc_code: 'X' }), ['X']);
  assert.deepEqual(asStringArray({ code: '12345' }), ['12345']);
  assert.deepEqual(asStringArray([{ naics_code: '111' }, { naics_code: '222' }]), ['111', '222']);
});

test('asStringArray still handles legacy string and array shapes', () => {
  assert.deepEqual(asStringArray('111,222'), ['111', '222']);
  assert.deepEqual(asStringArray(['a', 'b', '']), ['a', 'b']);
  assert.deepEqual(asStringArray(null), []);
  assert.deepEqual(asStringArray(undefined), []);
  assert.deepEqual(asStringArray(''), []);
});

test('normalizeSetAside handles object payloads', () => {
  assert.equal(normalizeSetAside({ name: 'SDVOSB' } as any), 'sdvosb');
  assert.equal(normalizeSetAside({ label: '8(a)' } as any), '8a');
  assert.equal(normalizeSetAside(undefined), null);
});
