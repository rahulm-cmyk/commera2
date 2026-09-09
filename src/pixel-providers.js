import { lookup as defaultDnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const clean = (value) => String(value ?? "").trim();

function privateNetworkAddress(value) {
  const address = clean(value).toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(address) === 6)
    return (
      address === "::" ||
      address === "::1" ||
      address.startsWith("fc") ||
      address.startsWith("fd") ||
      /^fe[89ab]/.test(address) ||
      address.startsWith("::ffff:")
    );
  return false;
}

export function validPublicHttpsEndpoint(value) {
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return Boolean(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        host &&
        host !== "localhost" &&
        !host.endsWith(".localhost") &&
        !host.endsWith(".local") &&
        host !== "metadata.google.internal" &&
        !privateNetworkAddress(host),
    );
  } catch {
    return false;
  }
}

async function assertPublicHttpsEndpoint(value, dnsLookupImpl) {
  if (!validPublicHttpsEndpoint(value))
    throw new Error("Custom event endpoint must use a public HTTPS host");
  const url = new URL(value),
    addresses = await dnsLookupImpl(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => privateNetworkAddress(item.address || item))
  )
    throw new Error("Custom event endpoint must resolve to a public network address");
}

export const pixelPlatforms = [
  {
    id: "meta",
    name: "Meta",
    idLabel: "Pixel ID",
    browserSupported: true,
    serverSupported: true,
    credentials: [
      { key: "accessToken", label: "Conversions API access token", secret: true, requiredForServer: true },
      { key: "testEventCode", label: "Test event code", secret: false, requiredForServer: false },
    ],
  },
  {
    id: "google",
    name: "Google",
    idLabel: "Measurement ID",
    browserSupported: true,
    serverSupported: true,
    credentials: [
      { key: "apiSecret", label: "Measurement Protocol API secret", secret: true, requiredForServer: true },
      { key: "conversionLabel", label: "Conversion label", secret: false, requiredForServer: false },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    idLabel: "Pixel ID",
    browserSupported: true,
    serverSupported: true,
    credentials: [
      { key: "accessToken", label: "Events API access token", secret: true, requiredForServer: true },
      { key: "testEventCode", label: "Test event code", secret: false, requiredForServer: false },
    ],
  },
  {
    id: "snapchat",
    name: "Snapchat",
    idLabel: "Pixel ID",
    browserSupported: true,
    serverSupported: true,
    credentials: [
      { key: "accessToken", label: "Conversions API access token", secret: true, requiredForServer: true },
    ],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    idLabel: "Pinterest Tag ID",
    browserSupported: true,
    serverSupported: true,
    credentials: [
      { key: "accessToken", label: "Conversions API access token", secret: true, requiredForServer: true },
      { key: "adAccountId", label: "Ad account ID", secret: false, requiredForServer: true },
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    idLabel: "UET Tag ID",
    browserSupported: true,
    serverSupported: false,
    credentials: [],
  },
  {
    id: "custom",
    name: "Custom",
    idLabel: "HTTPS event endpoint",
    browserSupported: true,
    serverSupported: true,
    credentials: [
      { key: "authorizationHeader", label: "Authorization header", secret: true, requiredForServer: false },
    ],
  },
];

export const defaultEventMappings = {
  meta: {
    page_view: "PageView",
    product_view: "ViewContent",
    add_to_cart: "AddToCart",
    checkout_started: "InitiateCheckout",
    checkout_progress: "CheckoutProgress",
    coupon_applied: "CouponApplied",
    otp_started: "OtpStarted",
    otp_verified: "OtpVerified",
    order_created: "Purchase",
    upsell_viewed: "UpsellViewed",
    upsell_accepted: "UpsellAccepted",
    upsell_rejected: "UpsellRejected",
  },
  google: {
    page_view: "page_view",
    product_view: "view_item",
    add_to_cart: "add_to_cart",
    checkout_started: "begin_checkout",
    checkout_progress: "checkout_progress",
    coupon_applied: "coupon_applied",
    otp_started: "otp_started",
    otp_verified: "otp_verified",
    order_created: "purchase",
    upsell_viewed: "upsell_viewed",
    upsell_accepted: "upsell_accepted",
    upsell_rejected: "upsell_rejected",
  },
  tiktok: {
    page_view: "PageView",
    product_view: "ViewContent",
    add_to_cart: "AddToCart",
    checkout_started: "InitiateCheckout",
    checkout_progress: "CheckoutProgress",
    coupon_applied: "CouponApplied",
    otp_started: "OtpStarted",
    otp_verified: "OtpVerified",
    order_created: "CompletePayment",
    upsell_viewed: "UpsellViewed",
    upsell_accepted: "UpsellAccepted",
    upsell_rejected: "UpsellRejected",
  },
  snapchat: {
    page_view: "PAGE_VIEW",
    product_view: "VIEW_CONTENT",
    add_to_cart: "ADD_CART",
    checkout_started: "START_CHECKOUT",
    checkout_progress: "CUSTOM_EVENT_1",
    coupon_applied: "CUSTOM_EVENT_2",
    otp_started: "CUSTOM_EVENT_3",
    otp_verified: "CUSTOM_EVENT_4",
    order_created: "PURCHASE",
    upsell_viewed: "CUSTOM_EVENT_5",
    upsell_accepted: "CUSTOM_EVENT_6",
    upsell_rejected: "CUSTOM_EVENT_7",
  },
  pinterest: {
    page_view: "page_visit",
    product_view: "view_content",
    add_to_cart: "add_to_cart",
    checkout_started: "initiate_checkout",
    checkout_progress: "custom",
    coupon_applied: "custom",
    otp_started: "custom",
    otp_verified: "custom",
    order_created: "checkout",
    upsell_viewed: "custom",
    upsell_accepted: "custom",
    upsell_rejected: "custom",
  },
  microsoft: {
    page_view: "page_view",
    product_view: "view_item",
    add_to_cart: "add_to_cart",
    checkout_started: "begin_checkout",
    checkout_progress: "checkout_progress",
    coupon_applied: "coupon_applied",
    otp_started: "otp_started",
    otp_verified: "otp_verified",
    order_created: "purchase",
    upsell_viewed: "upsell_viewed",
    upsell_accepted: "upsell_accepted",
    upsell_rejected: "upsell_rejected",
  },
  custom: {
    page_view: "page_view",
    product_view: "product_view",
    add_to_cart: "add_to_cart",
    checkout_started: "checkout_started",
    checkout_progress: "checkout_progress",
    coupon_applied: "coupon_applied",
    otp_started: "otp_started",
    otp_verified: "otp_verified",
    order_created: "order_created",
    upsell_viewed: "upsell_viewed",
    upsell_accepted: "upsell_accepted",
    upsell_rejected: "upsell_rejected",
  },
};

export const externallyEnabledByDefault = new Set([
  "page_view",
  "product_view",
  "add_to_cart",
  "checkout_started",
  "order_created",
]);

const requestJson = async (fetchImpl, url, options) => {
  const response = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { response: text.slice(0, 500) };
  }
  if (!response.ok) {
    const detail =
      result?.error?.message ||
      result?.message ||
      result?.response ||
      `Provider returned HTTP ${response.status}`;
    throw new Error(String(detail).slice(0, 500));
  }
  return result;
};

const eventValue = (event) => {
  const value = Number(
    event.payload.orderValue ??
      event.payload.cartValue ??
      event.payload.checkoutValue ??
      event.payload.productPrice ??
      event.payload.value ??
      0,
  );
  return Number.isFinite(value) ? value : 0;
};

const eventContext = (event) => ({
  eventId: event.eventId,
  eventName: event.providerEventName,
  eventTime: Math.floor(new Date(event.createdAt || Date.now()).getTime() / 1000),
  sourceUrl: clean(event.payload.pageUrl),
  currency: clean(event.payload.currency) || "INR",
  value: eventValue(event),
  productId: event.productId || event.payload.productId || null,
  orderId: event.orderId || event.payload.orderId || null,
  sessionId: clean(event.sessionId) || event.eventId,
  ipAddress: clean(event.payload.ipAddress),
  userAgent: clean(event.payload.userAgent),
});

export function createPixelAdapters({
  fetchImpl = globalThis.fetch,
  dnsLookupImpl = defaultDnsLookup,
} = {}) {
  const meta = {
      async verify({ connection, credentials }) {
        return requestJson(
          fetchImpl,
          `https://graph.facebook.com/v23.0/${encodeURIComponent(connection.trackingId)}?fields=id,name&access_token=${encodeURIComponent(credentials.accessToken)}`,
          { method: "GET" },
        );
      },
      async send({ connection, credentials, event, test = false }) {
        const value = eventContext(event),
          payload = {
            data: [
              {
                event_name: value.eventName,
                event_time: value.eventTime,
                event_id: value.eventId,
                action_source: "website",
                ...(value.sourceUrl ? { event_source_url: value.sourceUrl } : {}),
                user_data: {
                  ...(value.ipAddress ? { client_ip_address: value.ipAddress } : {}),
                  ...(value.userAgent ? { client_user_agent: value.userAgent } : {}),
                },
                custom_data: {
                  currency: value.currency,
                  value: value.value,
                  ...(value.productId ? { content_ids: [String(value.productId)], content_type: "product" } : {}),
                  ...(value.orderId ? { order_id: String(value.orderId) } : {}),
                },
              },
            ],
            ...(credentials.testEventCode || test
              ? { test_event_code: credentials.testEventCode || "COMMERCE2_TEST" }
              : {}),
          };
        return requestJson(
          fetchImpl,
          `https://graph.facebook.com/v23.0/${encodeURIComponent(connection.trackingId)}/events?access_token=${encodeURIComponent(credentials.accessToken)}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
        );
      },
    },
    google = {
      async verify(context) {
        const result = await this.send({ ...context, test: true });
        const errors = (result.validationMessages || []).filter(
          (item) => item.validationCode && item.severity === "ERROR",
        );
        if (errors.length) throw new Error(errors[0].description || errors[0].validationCode);
        return result;
      },
      async send({ connection, credentials, event, test = false }) {
        const value = eventContext(event),
          endpoint = test ? "debug/mp/collect" : "mp/collect";
        return requestJson(
          fetchImpl,
          `https://www.google-analytics.com/${endpoint}?measurement_id=${encodeURIComponent(connection.trackingId)}&api_secret=${encodeURIComponent(credentials.apiSecret)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              client_id: value.sessionId,
              events: [
                {
                  name: value.eventName,
                  params: {
                    event_id: value.eventId,
                    currency: value.currency,
                    value: value.value,
                    ...(value.productId ? { items: [{ item_id: String(value.productId), quantity: Number(event.payload.quantity || 1) }] } : {}),
                    ...(value.orderId ? { transaction_id: String(value.orderId) } : {}),
                  },
                },
              ],
            }),
          },
        );
      },
    },
    tiktok = {
      async verify(context) {
        return this.send({ ...context, test: true });
      },
      async send({ connection, credentials, event }) {
        const value = eventContext(event);
        return requestJson(fetchImpl, "https://business-api.tiktok.com/open_api/v1.3/pixel/track/", {
          method: "POST",
          headers: { "content-type": "application/json", "Access-Token": credentials.accessToken },
          body: JSON.stringify({
            pixel_code: connection.trackingId,
            event: value.eventName,
            event_id: value.eventId,
            timestamp: new Date().toISOString(),
            context: {
              page: value.sourceUrl ? { url: value.sourceUrl } : {},
              ...(value.ipAddress ? { ip: value.ipAddress } : {}),
              ...(value.userAgent ? { user_agent: value.userAgent } : {}),
            },
            properties: {
              currency: value.currency,
              value: value.value,
              ...(value.productId
                ? { contents: [{ content_id: String(value.productId), content_type: "product", quantity: Number(event.payload.quantity || 1) }] }
                : {}),
            },
            ...(credentials.testEventCode ? { test_event_code: credentials.testEventCode } : {}),
          }),
        });
      },
    },
    snapchat = {
      async verify(context) {
        return this.send({ ...context, test: true });
      },
      async send({ connection, credentials, event }) {
        const value = eventContext(event);
        return requestJson(
          fetchImpl,
          `https://tr.snapchat.com/v3/${encodeURIComponent(connection.trackingId)}/events?access_token=${encodeURIComponent(credentials.accessToken)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              data: [
                {
                  event_name: value.eventName,
                  event_time: value.eventTime,
                  event_id: value.eventId,
                  action_source: "WEB",
                  ...(value.sourceUrl ? { event_source_url: value.sourceUrl } : {}),
                  user_data: {
                    ...(value.ipAddress ? { client_ip_address: value.ipAddress } : {}),
                    ...(value.userAgent ? { client_user_agent: value.userAgent } : {}),
                  },
                  custom_data: { currency: value.currency, value: value.value },
                },
              ],
            }),
          },
        );
      },
    },
    pinterest = {
      async verify(context) {
        return this.send({ ...context, test: true });
      },
      async send({ credentials, event, test = false }) {
        const value = eventContext(event);
        return requestJson(
          fetchImpl,
          `https://api.pinterest.com/v5/ad_accounts/${encodeURIComponent(credentials.adAccountId)}/events${test ? "?test=true" : ""}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${credentials.accessToken}` },
            body: JSON.stringify({
              data: [
                {
                  event_name: value.eventName,
                  action_source: "web",
                  event_time: value.eventTime,
                  event_id: value.eventId,
                  ...(value.sourceUrl ? { event_source_url: value.sourceUrl } : {}),
                  opt_out: false,
                  user_data: {
                    ...(value.ipAddress ? { client_ip_address: value.ipAddress } : {}),
                    ...(value.userAgent ? { client_user_agent: value.userAgent } : {}),
                  },
                  custom_data: {
                    currency: value.currency,
                    value: String(value.value),
                    ...(value.orderId ? { order_id: String(value.orderId) } : {}),
                  },
                },
              ],
            }),
          },
        );
      },
    },
    custom = {
      async verify(context) {
        return this.send({ ...context, test: true });
      },
      async send({ connection, credentials, event, test = false }) {
        await assertPublicHttpsEndpoint(connection.trackingId, dnsLookupImpl);
        return requestJson(fetchImpl, connection.trackingId, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(credentials.authorizationHeader ? { authorization: credentials.authorizationHeader } : {}),
          },
          body: JSON.stringify({
            test,
            event_id: event.eventId,
            event_name: event.providerEventName,
            source: event.source,
            timestamp: event.createdAt,
            data: event.payload,
          }),
        });
      },
    };
  return { meta, google, tiktok, snapchat, pinterest, custom };
}

export function platformById(id) {
  return pixelPlatforms.find((item) => item.id === clean(id).toLowerCase()) || null;
}
