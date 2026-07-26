// netlify/functions/create-payment-intent.js
//
// This is the ONLY place your Stripe SECRET key is used.
// It runs on Netlify's servers, never in the browser.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    // IMPORTANT: Always calculate the amount on the server using your
    // own price data — never trust an amount sent from the browser.
    // Replace PRODUCT_PRICES with your real product catalog (in cents).
    const PRODUCT_PRICES = {
      'print-5x7': 1500,
      'print-3x6-postcard': 800,
      'print-8x11-vibrant': 2500,
      'print-8x11-original': 2500,
      'print-12x16': 4500,
      'card-3x4-pocket': 500,
      'tshirt': 2800,
    };

    let amount = 0;
    for (const item of items) {
      const price = PRODUCT_PRICES[item.id];
      if (!price) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: `Unknown item: ${item.id}` }),
        };
      }
      amount += price * (item.quantity || 1);
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
