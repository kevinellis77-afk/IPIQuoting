#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function readBalanced(source, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }

  throw new Error(`Unable to read balanced ${openChar}${closeChar} from index ${startIndex}`);
}

function extractConstDeclaration(name) {
  const marker = `const ${name} =`;
  const markerIndex = indexHtml.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected ${name} to be declared in index.html`);
  const equalsIndex = indexHtml.indexOf('=', markerIndex);
  let valueStart = equalsIndex + 1;
  while (/\s/.test(indexHtml[valueStart])) valueStart += 1;
  const openChar = indexHtml[valueStart];
  if (openChar !== '[' && openChar !== '{') {
    const statementEnd = indexHtml.indexOf(';', valueStart);
    assert.notEqual(statementEnd, -1, `Expected ${name} declaration to end with a semicolon`);
    return indexHtml.slice(markerIndex, statementEnd + 1);
  }
  const closeChar = openChar === '[' ? ']' : '}';
  const value = readBalanced(indexHtml, valueStart, openChar, closeChar);
  return `const ${name} = ${value};`;
}

function extractFunctionDeclaration(name) {
  const marker = `function ${name}`;
  const markerIndex = indexHtml.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected ${name} to be declared in index.html`);
  const bodyStart = indexHtml.indexOf('{', markerIndex);
  return indexHtml.slice(markerIndex, bodyStart) + readBalanced(indexHtml, bodyStart, '{', '}');
}

const subjectSource = [
  extractConstDeclaration('PRODUCTS'),
  extractConstDeclaration('SERVICES_CATS'),
  extractFunctionDeclaration('normalizeCategory'),
  'function getSelectedQuoteProfile() { return null; }',
  extractFunctionDeclaration('isServicesLikeCategory'),
  extractConstDeclaration('PCI_CATEGORY_CANONICAL'),
  extractConstDeclaration('PCI_CATEGORY_VALUES'),
  extractFunctionDeclaration('normalizePciCategoryValue'),
  extractFunctionDeclaration('isPciCategoryValue'),
  extractFunctionDeclaration('isPciProduct'),
  extractFunctionDeclaration('isHiddenForProfile'),
  extractFunctionDeclaration('getProfileDiscountForProduct'),
  extractFunctionDeclaration('roundCurrency'),
  extractFunctionDeclaration('getPriceForProductByProfile'),
  extractFunctionDeclaration('getPciDiscountForProfile'),
  'globalThis.__subject = { PRODUCTS, getProfileDiscountForProduct, getPriceForProductByProfile, getPciDiscountForProfile, isPciProduct };'
].join('\n\n');

const sandbox = { console };
vm.runInNewContext(subjectSource, sandbox, { filename: 'index.html extracted discount subject' });
const { PRODUCTS, getProfileDiscountForProduct, getPriceForProductByProfile, getPciDiscountForProfile, isPciProduct } = sandbox.__subject;

function productBySku(sku) {
  const product = PRODUCTS.find((candidate) => candidate.id === sku);
  assert.ok(product, `Expected representative SKU ${sku} to exist in index.html PRODUCTS`);
  return product;
}

function profile(type, tier, discount) {
  return { type, tier, discount, typeLabel: type, tierLabel: tier };
}

function assertDiscount(profileInput, product, expectedDiscount) {
  assert.equal(
    getProfileDiscountForProduct(profileInput, product),
    expectedDiscount,
    `${profileInput.type}:${profileInput.tier} ${product.id} should discount at ${expectedDiscount * 100}%`
  );
}

function assertPartnerPrice(profileInput, product, expectedPrice) {
  assert.equal(
    getPriceForProductByProfile(product, profileInput).toFixed(2),
    expectedPrice,
    `${profileInput.type}:${profileInput.tier} ${product.id} partner price should be £${expectedPrice}`
  );
}

const pciStandardMonthly = productBySku('S100863');
assert.equal(pciStandardMonthly.cat, 'PCI Cloud');
assert.equal(pciStandardMonthly.list, 18.95);
assert.equal(isPciProduct(pciStandardMonthly), true);
assert.equal(isPciProduct({ cat: 'PCI' }), true);
assert.equal(isPciProduct({ cat: 'PCI Cloud' }), true);

const pciPremiumTransaction = productBySku('S101049');
assert.equal(pciPremiumTransaction.cat, 'PCI Cloud');
assert.equal(pciPremiumTransaction.list, 4.50);

const expectedPciDiscounts = [
  [profile('reseller', 'accredited', 0.20), 0.20],
  [profile('reseller', 'silver', 0.30), 0.25],
  [profile('reseller', 'gold', 0.35), 0.30],
  [profile('reseller', 'platinum', 0.40), 0.30],
  [profile('msp', 'silver', 0.35), 0.25],
  [profile('msp', 'gold', 0.45), 0.30],
  [profile('msp', 'platinum', 0.50), 0.30]
];

for (const [profileInput, expectedDiscount] of expectedPciDiscounts) {
  assertDiscount(profileInput, pciStandardMonthly, expectedDiscount);
  assertDiscount(profileInput, { cat: 'PCI', id: 'SYNTHETIC-PCI' }, expectedDiscount);
  assert.equal(getPciDiscountForProfile(profileInput), expectedDiscount);
  assertDiscount(profileInput, pciPremiumTransaction, expectedDiscount);
}

for (const [profileInput, expectedPrice] of [
  [profile('reseller', 'accredited', 0.20), '15.16'],
  [profile('reseller', 'silver', 0.30), '14.21'],
  [profile('reseller', 'gold', 0.35), '13.27']
]) {
  assertPartnerPrice(profileInput, pciStandardMonthly, expectedPrice);
}

for (const [profileInput, expectedPrice] of [
  [profile('reseller', 'accredited', 0.20), '3.60'],
  [profile('reseller', 'silver', 0.30), '3.38'],
  [profile('reseller', 'gold', 0.35), '3.15']
]) {
  assertPartnerPrice(profileInput, pciPremiumTransaction, expectedPrice);
}

const coreMarginProduct = productBySku('S100937');
assert.notEqual(coreMarginProduct.cat, 'PCI Cloud');
assertDiscount(profile('reseller', 'gold', 0.35), coreMarginProduct, 0.35);
assertPartnerPrice(profile('reseller', 'gold', 0.35), coreMarginProduct, (coreMarginProduct.list * 0.65).toFixed(2));

const consultancyProduct = productBySku('S100935');
assert.equal(consultancyProduct.cat, 'Consultancy');
assertDiscount(profile('msp', 'gold', 0.45), consultancyProduct, 0.20);
assertPartnerPrice(profile('msp', 'gold', 0.45), consultancyProduct, (consultancyProduct.list * 0.80).toFixed(2));

console.log('PCI category cap matrix and service/core margin discount checks passed.');
