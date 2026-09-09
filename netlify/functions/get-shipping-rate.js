// netlify/functions/get-shipping-rate.js
//
// Netlify Function that takes a cart + destination address and returns
// live shipping rate options from EasyPost: standard (USPS Ground
// Advantage, real-time cost) and express (USPS Priority Mail, flat $15).
//
// Deploy path: this file goes in your repo's `netlify/functions/` folder.
// Netlify auto-detects and deploys anything in that folder as an endpoint,
// callable from your frontend at: /.netlify/functions/get-shipping-rate
//
// EASYPOST_API_KEY should be set as an environment variable in the Netlify
// dashboard (Site settings > Environment variables) — test key while
// developing, production key when you go live. Never hardcode the key here
// or expose it to the frontend, and never commit it to GitHub.

const EASYPOST_API_KEY = process.env.EASYPOST_API_KEY;

// Your EasyPost Sender and Return Address IDs (from Shipping Settings >
// Sender Addresses in the EasyPost dashboard).
const FROM_ADDRESS_ID = "adr_02ab5df8ac0211f194390022480b361d";
const RETURN_ADDRESS_ID = "adr_02ab5df8ac0211f194390022480b361d";

// Flat price you charge the customer for express shipping, regardless of
// EasyPost's actual Priority Mail cost. This is a fixed customer-facing
// price, not a pass-through of the real carrier rate.
const EXPRESS_FLAT_PRICE = 15.0;

// ---- Product -> package mapping ----
// Keyed by the real product IDs from products.js. Products with pack-size
// variants (postcards, pocket cards) are keyed as "id::variantLabel".
// weight is in ounces, dimensions in inches (length, width, height).
// These recorded weights are the PACKED item weight WITHOUT the shipping
// label. A small buffer is added below (LABEL_WEIGHT_BUFFER_OZ) to cover the
// label/tape so we never under-quote a customer.
// Add new products/quantities here as your catalog grows.
const LABEL_WEIGHT_BUFFER_OZ = 0.2;

const PACKAGE_MAP = {
  "jesus-laughing-5x7":            { length: 6,  width: 9,  height: 0.2, weight: 1.2 },
  "jesus-laughing-original-8x11":  { length: 9,  width: 12, height: 0.2, weight: 2.5 },
  "jesus-laughing-12x16":          { length: 13, width: 18, height: 0.2, weight: 8   },

  "jesus-laughing-pocket-cards-3x4::5":  { length: 6, width: 9, height: 0.3, weight: 1.0 },
  "jesus-laughing-pocket-cards-3x4::10": { length: 6, width: 9, height: 0.3, weight: 1.2 },
  "jesus-laughing-pocket-cards-3x4::20": { length: 6, width: 9, height: 0.3, weight: 1.8 },
  "jesus-laughing-pocket-cards-3x4::50": { length: 6, width: 9, height: 0.5, weight: 3.4 },

  "jesus-laughing-postcards-3x6::5":  { length: 6, width: 9, height: 0.2, weight: 1.4 },
  "jesus-laughing-postcards-3x6::10": { length: 6, width: 9, height: 0.3, weight: 2.0 },
  "jesus-laughing-postcards-3x6::20": { length: 6, width: 9, height: 0.4, weight: 3.3 },
  "jesus-laughing-postcards-3x6::50": { length: 6, width: 9, height: 0.8, weight: 7.1 },

  // "tshirt-...": { length: __, width: __, height: __, weight: __ }, // add once measured
};

function packageKeyFor(item) {
  return item.variant ? `${item.id}::${item.variant}` : item.id;
}

// Combine multiple cart line items into ONE parcel by summing weight and
// using the largest single-item dimensions as a stand-in "box" size.
// This is a simple approximation — good enough for small/flat items like
// yours that mostly nest together. If you start shipping bulkier mixed
// orders, this may need to get smarter (actual box-packing logic).
function buildParcelFromCart(cartItems) {
  let totalWeight = 0;
  let maxLength = 0;
  let maxWidth = 0;
  let totalHeight = 0; // stack heights as a rough approximation

  for (const item of cartItems) {
    const key = packageKeyFor(item);
    const pkg = PACKAGE_MAP[key];
    if (!pkg) {
      throw new Error(`No package info found for product: ${key}`);
    }
    const qty = item.qty || item.quantity || 1;
    totalWeight += pkg.weight * qty;
    maxLength = Math.max(maxLength, pkg.length);
    maxWidth = Math.max(maxWidth, pkg.width);
    totalHeight += pkg.height * qty;
  }

  return {
    length: Math.ceil(maxLength),
    width: Math.ceil(maxWidth),
    height: Math.ceil(totalHeight) || 1, // never send 0
    // add the one-time label/tape buffer, then round up to nearest 0.1 oz
    weight: Math.ceil((totalWeight + LABEL_WEIGHT_BUFFER_OZ) * 10) / 10,
  };
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // Matches the same request shape checkout.js already sends to
    // create-payment-intent.js: { items, address, name }
    // items: [{ id, variant, qty }], address: { line1, line2, city, state, postal_code }
    const { items, address, name } = JSON.parse(event.body);

    if (!items || !items.length || !address) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing items or address" }),
      };
    }

    const toAddress = {
      name: name || "Customer",
      street1: address.line1,
      street2: address.line2 || "",
      city: address.city,
      state: address.state,
      zip: address.postal_code,
      country: "US",
    };

    const parcel = buildParcelFromCart(items);

    const response = await fetch("https://api.easypost.com/v2/shipments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " + Buffer.from(EASYPOST_API_KEY + ":").toString("base64"),
      },
      body: JSON.stringify({
        shipment: {
          from_address: { id: FROM_ADDRESS_ID },
          return_address: { id: RETURN_ADDRESS_ID },
          to_address: toAddress,
          parcel: parcel,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("EasyPost error:", data);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to fetch rates" }),
      };
    }

    // Standard option: real-time USPS Ground Advantage cost, passed through
    // to the customer as-is (or with your own markup if you choose to add one).
    const groundRate = data.rates.find(
      (r) => r.carrier === "USPS" && r.service === "GroundAdvantage"
    );

    if (!groundRate) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "No matching rate found", rates: data.rates }),
      };
    }

    // Express option: USPS Priority Mail (1-3 business days, NOT overnight),
    // but charged to the customer at your flat $15 price rather than
    // EasyPost's actual Priority rate. The real Priority rate is looked up
    // only so you can see your margin in the response/logs if useful.
    const priorityRate = data.rates.find(
      (r) => r.carrier === "USPS" && r.service === "Priority"
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        shipmentId: data.id, // needed later if you want to buy a label
        options: {
          standard: {
            label: "Standard Shipping",
            service: groundRate.service,
            price: parseFloat(groundRate.rate), // real-time actual cost
            currency: groundRate.currency,
          },
          express: {
            label: "Express Shipping",
            service: priorityRate ? priorityRate.service : "Priority",
            price: EXPRESS_FLAT_PRICE, // flat customer-facing price
            currency: "USD",
            // actualCost is for your own reference/margin tracking only —
            // don't display this to the customer.
            actualCost: priorityRate ? parseFloat(priorityRate.rate) : null,
          },
        },
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
