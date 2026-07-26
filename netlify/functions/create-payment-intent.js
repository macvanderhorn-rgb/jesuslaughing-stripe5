// netlify/functions/create-payment-intent.js
//
// This is the ONLY place your Stripe SECRET key is used.
// It runs on Netlify's servers, never in the browser.
//
// IMPORTANT: Keep this price list in sync with js/products.js on your site.
// Amounts are in cents. This is what actually gets charged — never trust
// a price or amount sent from the browser.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRODUCTS = {
  'jesus-laughing-5x7': { price: 999 },
  'jesus-laughing-postcards-3x6': {
    variants: { '5': 1299, '10': 1999, '20': 3499, '50': 9999 },
  },
  'jesus-laughing-original-8x11': { price: 999 },
  'jesus-laughing-12x16': { price: 999 },
  'jesus-laughing-pocket-cards-3x4': {
    variants: { '5': 1299, '10': 1999, '20': 3499, '50': 9999 },
  },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Browsers send a preflight OPTIONS request before the real POST.
  // We must answer it or the browser blocks the actual request.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { items } = JSON.parse(event.body);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No items provided' }),
      };
    }

    let amount = 0;

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

      amount += unitPrice * (item.qty || 1);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
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
