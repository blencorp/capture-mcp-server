import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupReferenceCode,
  listReferenceCodes,
  describeSetAside,
  validateSetAsideCodes,
  REFERENCE_DOMAINS,
} from './fpds-codes.js';

test('8A and 8AN carry the correct, distinct descriptions', () => {
  // The error class that produced a 12x-wrong number: 8A is COMPETED, 8AN is SOLE SOURCE.
  assert.match(lookupReferenceCode('set_aside', '8A')!.description, /Competed/);
  assert.match(lookupReferenceCode('set_aside', '8AN')!.description, /Sole Source/);
});

test('lookup is case-insensitive and trims', () => {
  assert.equal(lookupReferenceCode('set_aside', ' sdvosbs ')!.code, 'SDVOSBS');
});

test('unknown domain and unknown code return null', () => {
  assert.equal(lookupReferenceCode('nope', '8A'), null);
  assert.equal(lookupReferenceCode('set_aside', 'ZZZ'), null);
});

test('every domain lists codes', () => {
  for (const domain of REFERENCE_DOMAINS) {
    const codes = listReferenceCodes(domain)!;
    assert.ok(codes.length > 0, `${domain} is empty`);
    for (const entry of codes) {
      assert.ok(entry.code && entry.description, `${domain} has an incomplete entry`);
    }
  }
});

test('describeSetAside passes unknown codes through with null description', () => {
  assert.deepEqual(describeSetAside('8AN'), {
    code: '8AN',
    description: '8(a) Sole Source (FAR 19.8)',
  });
  assert.deepEqual(describeSetAside('zz9'), { code: 'ZZ9', description: null });
});

test('validateSetAsideCodes normalizes valid codes and rejects unknown ones with the valid list', () => {
  assert.deepEqual(validateSetAsideCodes(['8an', ' HZS ']), ['8AN', 'HZS']);
  assert.throws(() => validateSetAsideCodes(['8AN', 'BOGUS']), /BOGUS.*Valid FPDS codes.*8AN/s);
});

test('VA sole-source codes for 38 USC 8127 targeting are present', () => {
  assert.ok(lookupReferenceCode('set_aside', 'VSS'));
  assert.ok(lookupReferenceCode('set_aside', 'SDVOSBS'));
  assert.ok(lookupReferenceCode('set_aside', 'HZS'));
});
