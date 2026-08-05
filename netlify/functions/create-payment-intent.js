// netlify/functions/create-payment-intent.js
//
// This is the ONLY place your Stripe SECRET key is used.
// It runs on Netlify's servers, never in the browser.
//
// IMPORTANT: Keep this price list in sync with js/products.js on your site.
// Amounts are in cents. This is what actually gets charged — never trust
// a price or amount sent from the browser.
//
// TAX: Flat 6% Michigan sales tax, calculated here on the server (never
// trust a tax amount sent from the browser either). $0 tax on orders
// shipping outside Michigan, since you currently only have sales tax
// nexus in Michigan. Revisit this if/when you register in other states.

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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { items, address } = JSON.parse(event.body);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No items provided' }),
      };
    }

    if (!address || !address.line1 || !address.city || !address.state || !address.postal_code) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'A complete shipping address is required.' }),
      };
    }

    let subtotal = 0;

    for (const item of items) {
      const product = PRODUCTS[item.id];
      if (!product) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: `Unknown item: ${item.id}` }),
        };
      }

      let unitPrice;
      if (product.variants) {
        unitPrice = product.variants[item.variant];
        if (!unitPrice) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: `Unknown pack size for ${item.id}: ${item.variant}` }),
          };
        }
      } else {
        unitPrice = product.price;
      }

      subtotal += unitPrice * (item.qty || 1);
    }

    // Flat 6% Michigan sales tax only — $0 for every other state until
    // you register elsewhere. State is normalized to handle "mi", "MI", " MI " etc.
    const state = String(address.state || '').trim().toUpperCase();
    const tax = state === 'MI' ? Math.round(subtotal * MI_TAX_RATE) : 0;
    const total = subtotal + tax;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        shipping_state: state,
        subtotal_cents: String(subtotal),
        tax_cents: String(tax),
      },
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        subtotal,
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
