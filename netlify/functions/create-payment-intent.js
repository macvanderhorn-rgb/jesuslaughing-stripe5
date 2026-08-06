// netlify/functions/create-payment-intent.js
//
// This is the ONLY place your Stripe SECRET key is used.
// It runs on Netlify's servers, never in the browser.
//
// IMPORTANT: Keep this price list in sync with js/products.js on your site.
// Amounts are in cents. This is what actually gets charged — never trust
// a price, discount, or tax amount sent from the browser.
//
// TAX: Flat 6% Michigan sales tax, calculated here on the server.
// $0 tax on orders shipping outside Michigan, since you currently only
// have sales tax nexus in Michigan.
//
// PROMO CODES: edit the PROMO_CODES list below to add/remove/change codes.
// type: 'percent' -> value is a whole-number percent off (e.g. 10 = 10% off)
// type: 'fixed'    -> value is a flat discount IN CENTS (e.g. 500 = $5.00 off)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const MI_TAX_RATE = 0.06;

const PRODUCTS = {
  'jesus-laughing-5x7': { price: 1800 },
  'jesus-laughing-postcards-3x6': {
    variants: { '5': 1500, '10': 2200, '20': 3800, '50': 9500 },
  },
  'jesus-laughing-original-8x11': { price: 2800 },
  'jesus-laughing-12x16': { price: 4500 },
  'jesus-laughing-pocket-cards-3x4': {
    variants: { '5': 1500, '10': 2200, '20': 3800, '50': 9500 },
  },
};

// Example codes — replace with your own real ones.
const PROMO_CODES = {
  'WELCOME10': { type: 'percent', value: 10 },
  'SAVE5': { type: 'fixed', value: 500 },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Looks up unit price for a cart item, returns null if unknown.
function unitPriceFor(item) {
  const product = PRODUCTS[item.id];
  if (!product) return null;
  if (product.variants) {
    return product.variants[item.variant] ?? null;
  }
  return product.price;
}

// Sums cart items into a subtotal in cents. Returns { error } or { subtotalCents }.
function calcSubtotal(items) {
  let subtotalCents = 0;
  for (const item of items) {
    const unitPrice = unitPriceFor(item);
    if (unitPrice == null) {
      const label = item.variant ? `${item.id} (${item.variant})` : item.id;
      return { error: `Unknown item: ${label}` };
    }
    subtotalCents += unitPrice * (item.qty || 1);
  }
  return { subtotalCents };
}

// Validates a promo code against the subtotal.
// Returns { code, valid, discountCents }. valid is null if no code was given.
function getPromoDiscount(subtotalCents, rawCode) {
  if (!rawCode) return { code: null, valid: null, discountCents: 0 };
  const code = String(rawCode).trim().toUpperCase();
  const promo = PROMO_CODES[code];
  if (!promo) return { code, valid: false, discountCents: 0 };

  let discountCents = promo.type === 'percent'
    ? Math.round(subtotalCents * (promo.value / 100))
    : promo.value;

  // Never let a discount exceed the subtotal.
  discountCents = Math.min(discountCents, subtotalCents);
  return { code, valid: true, discountCents };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { items, address, promoCode, validateOnly } = JSON.parse(event.body);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No items provided' }),
      };
    }

    const subtotalResult = calcSubtotal(items);
    if (subtotalResult.error) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: subtotalResult.error }),
      };
    }
    const { subtotalCents } = subtotalResult;

    const promoResult = getPromoDiscount(subtotalCents, promoCode);

    // Promo-only check: used when the customer clicks "Apply" before
    // they've entered a shipping address. No PaymentIntent is created yet.
    if (validateOnly) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          subtotal: subtotalCents,
          promoCode: promoResult.code,
          promoValid: promoResult.valid,
          discount: promoResult.discountCents,
        }),
      };
    }

    if (!address || !address.line1 || !address.city || !address.state || !address.postal_code) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'A complete shipping address is required.' }),
      };
    }

    const discountedSubtotal = subtotalCents - promoResult.discountCents;

    // Flat 6% Michigan sales tax only — $0 for every other state until
    // you register elsewhere. Tax is calculated on the post-discount amount.
    const state = String(address.state || '').trim().toUpperCase();
    const tax = state === 'MI' ? Math.round(discountedSubtotal * MI_TAX_RATE) : 0;
    const total = discountedSubtotal + tax;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        shipping_state: state,
        subtotal_cents: String(subtotalCents),
        promo_code: promoResult.code || '',
        discount_cents: String(promoResult.discountCents),
        tax_cents: String(tax),
      },
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        subtotal: subtotalCents,
        promoCode: promoResult.code,
        promoValid: promoResult.valid,
        discount: promoResult.discountCents,
        tax,
        total,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Something went wrong creating the payment.' }),
    };
  }
};
