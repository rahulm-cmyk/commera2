import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  createPixelAdapters,
  defaultEventMappings,
  externallyEnabledByDefault,
  pixelPlatforms,
  platformById,
  validPublicHttpsEndpoint,
} from "./pixel-providers.js";
import { analyticsAllowed } from './tracking-consent.js';

const clean = (value) => String(value ?? "").trim();
const internalEvents = new Set([
  "page_view",
  "product_view",
  "add_to_cart",
  "checkout_started",
  "checkout_progress",
  "coupon_applied",
  "otp_started",
  "otp_verified",
  "order_created",
  "upsell_viewed",
  "upsell_accepted",
  "upsell_rejected",
  "payment_started",
  "payment_success",
  "payment_failed",
]);
const aliases = {
  product_page_view: "product_view",
  checkout_start: "checkout_started",
  purchase: "order_created",
  direct_checkout_start: "checkout_started",
};
const legacyNames = {
  product_view: "product_page_view",
  checkout_started: "checkout_start",
  order_created: "purchase",
};
const scopeTypes = new Set([
  "entire_store",
  "all_product_pages",
  "specific_products",
  "specific_product_pages",
]);
const deliveryStatuses = new Set(["queued", "success", "failed", "skipped"]);

const camel = (value) =>
  value
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
          item,
        ]),
      )
    : null;
const jsonValue = (value, fallback) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};
const asBoolean = (value) =>
  value === true || value === 1 || value === "1" || value === "true" || value === "on";
const canonicalEvent = (value) => {
  const name = clean(value).toLowerCase();
  return aliases[name] || name;
};
const timestamp = (value = Date.now()) =>
  new Date(value).toISOString().replace("T", " ").replace("Z", "");
const positiveIds = (value) => [
  ...new Set(
    (Array.isArray(value) ? value : clean(value).split(","))
      .map(Number)
      .filter((item) => Number.isInteger(item) && item > 0),
  ),
];

function validTrackingId(platform, trackingId) {
  if (platform === "meta") return /^\d{5,30}$/.test(trackingId);
  if (platform === "google")
    return /^(G-[A-Z0-9]{6,20}|AW-\d{5,20})$/.test(trackingId);
  if (platform === "tiktok") return /^[A-Z0-9]{10,40}$/.test(trackingId);
  if (platform === "snapchat") return /^[A-Za-z0-9_-]{5,80}$/.test(trackingId);
  if (platform === "pinterest" || platform === "microsoft")
    return /^\d{5,30}$/.test(trackingId);
  if (platform === "custom") {
    return validPublicHttpsEndpoint(trackingId);
  }
  return false;
}

export class PixelService {
  constructor(
    db,
    {
      adapters = {},
      fetchImpl = globalThis.fetch,
      dnsLookupImpl,
      credentialSecret = process.env.PIXEL_CREDENTIALS_SECRET || "",
      liveVisitors = null,
    } = {},
  ) {
    this.db = db;
    this.liveVisitors = liveVisitors;
    this.adapters = {
      ...createPixelAdapters({ fetchImpl, dnsLookupImpl }),
      ...adapters,
    };
    const secret =
      credentialSecret ||
      (process.env.NODE_ENV === "production"
        ? ""
        : "commera2-local-development-pixel-credential-key");
    this.credentialKey = secret
      ? createHash("sha256").update(secret).digest()
      : null;
    this.#migrateLegacyData();
    this.#backfillAuthoritativeOrders();
  }

  #backfillAuthoritativeOrders() {
    const missing = this.db
      .prepare(
        `SELECT o.id order_id,o.store_id,o.checkout_session_id,o.total_paise,o.created_at,
          cs.product_id,cs.page_id,pp.slug page_slug,
          COALESCE(lvs.session_id,'') session_id
         FROM orders o
         JOIN checkout_sessions cs ON cs.id=o.checkout_session_id AND cs.store_id=o.store_id
         JOIN product_pages pp ON pp.id=cs.page_id AND pp.store_id=o.store_id
         LEFT JOIN live_visitor_sessions lvs ON lvs.store_id=o.store_id AND lvs.checkout_session_id=o.checkout_session_id
         WHERE NOT EXISTS (
           SELECT 1 FROM tracking_events te
           WHERE te.store_id=o.store_id AND te.order_id=o.id AND te.event_name='order_created'
         )`,
      )
      .all();
    const insert = this.db.prepare(
      `INSERT INTO tracking_events
       (id,store_id,event_id,event_name,source,session_id,page_id,product_id,checkout_session_id,order_id,page_slug,payload_json,consent_granted,is_bot,created_at)
       VALUES (?,?,?,'order_created','server',?,?,?,?,?,?,?,1,0,?)
       ON CONFLICT(store_id,event_id,event_name) DO NOTHING`,
    );
    for (const order of missing)
      insert.run(
        `backfill-order-${order.store_id}-${order.order_id}`,
        order.store_id,
        `ORDER-${order.order_id}`,
        order.session_id,
        order.page_id,
        order.product_id,
        order.checkout_session_id,
        order.order_id,
        order.page_slug,
        JSON.stringify({
          backfilled: true,
          orderValue: Number(order.total_paise) / 100,
        }),
        order.created_at,
      );
  }

  #store(storeId) {
    if (!this.db.prepare("SELECT id FROM stores WHERE id=?").get(storeId))
      throw new Error("Store not found");
  }

  #privacy(storeId) {
    const fallback = {
        marketingTracking: true,
        advertisingPixels: true,
        requireMarketingConsent: false,
        allowVisitorTracking: true,
        allowPixelTracking: true,
      },
      value = this.db
        .prepare("SELECT privacy_json FROM store_settings WHERE store_id=?")
        .get(storeId);
    try {
      return { ...fallback, ...JSON.parse(value?.privacy_json || "{}") };
    } catch {
      return fallback;
    }
  }

  #encrypt(credentials) {
    if (!Object.keys(credentials).length) return "";
    if (!this.credentialKey)
      throw new Error(
        "Set PIXEL_CREDENTIALS_SECRET before saving server-side credentials",
      );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.credentialKey, iv),
      ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(credentials), "utf8"),
        cipher.final(),
      ]),
      tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  #decrypt(value) {
    if (!value) return {};
    if (!String(value).startsWith("v1:")) return jsonValue(value, {});
    if (!this.credentialKey) return {};
    try {
      const [, iv, tag, ciphertext] = String(value).split(":"),
        decipher = createDecipheriv(
          "aes-256-gcm",
          this.credentialKey,
          Buffer.from(iv, "base64url"),
        );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      );
    } catch {
      return {};
    }
  }

  #safeError(error, credentials = {}) {
    let message = clean(error?.message) || "Provider request failed";
    for (const value of Object.values(credentials)) {
      const secret = clean(value);
      if (secret.length >= 4) message = message.replaceAll(secret, "[redacted]");
    }
    return message.slice(0, 500);
  }

  #migrateLegacyData() {
    let legacyPixels = [];
    try {
      legacyPixels = this.db.prepare("SELECT * FROM tracking_pixels ORDER BY id").all();
    } catch {
      return;
    }
    for (const item of legacyPixels) {
      const existing = this.db
        .prepare("SELECT id FROM pixel_connections WHERE legacy_pixel_id=?")
        .get(item.id);
      if (existing) continue;
      this.db
        .prepare(
          "INSERT INTO pixel_connections (legacy_pixel_id,store_id,platform,name,tracking_id,browser_enabled,server_enabled,enabled,status,verified_at,last_error,created_at,updated_at) VALUES (?,?,?,?,?,1,0,?,?,?,?,?,?)",
        )
        .run(
          item.id,
          item.store_id,
          item.platform,
          item.name || `${item.platform} Pixel`,
          item.tracking_id,
          item.enabled,
          item.status,
          item.verified_at,
          item.last_error || "",
          item.created_at,
          item.updated_at,
        );
    }
    let legacyEvents = [];
    try {
      legacyEvents = this.db.prepare("SELECT * FROM pixel_events ORDER BY id").all();
    } catch {}
    for (const item of legacyEvents) {
      const connection = this.db
        .prepare("SELECT id FROM pixel_connections WHERE legacy_pixel_id=?")
        .get(item.pixel_id);
      if (!connection) continue;
      const id = `legacy-pixel-event-${item.id}`,
        eventName = canonicalEvent(item.event_name),
        eventId = item.event_id || id;
      if (!this.db.prepare("SELECT id FROM tracking_events WHERE id=?").get(id))
        this.db
          .prepare(
            "INSERT INTO tracking_events (id,store_id,event_id,event_name,source,page_slug,order_id,payload_json,consent_granted,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)",
          )
          .run(
            id,
            item.store_id,
            eventId,
            eventName,
            "browser",
            item.page_slug || "",
            item.order_id || null,
            "{}",
            item.created_at,
          );
      if (
        !this.db
          .prepare(
            "SELECT id FROM pixel_event_deliveries WHERE tracking_event_id=? AND pixel_connection_id=? AND channel='browser'",
          )
          .get(id, connection.id)
      )
        this.db
          .prepare(
            "INSERT INTO pixel_event_deliveries (store_id,tracking_event_id,pixel_connection_id,channel,provider_event_name,status,attempts,sent_at,created_at,updated_at) VALUES (?,?,?,'browser',?,'success',1,?,?,?)",
          )
          .run(
            item.store_id,
            id,
            connection.id,
            defaultEventMappings[item.platform]?.[eventName] || eventName,
            item.created_at,
            item.created_at,
            item.created_at,
          );
    }
  }

  #rawConnection(storeId, id) {
    const item = this.db
      .prepare("SELECT * FROM pixel_connections WHERE store_id=? AND id=?")
      .get(storeId, id);
    if (!item) throw new Error("Pixel connection not found");
    return camel(item);
  }

  #connection(storeId, id) {
    const item = this.db
      .prepare(
        `SELECT pc.*,
          (SELECT te.event_name FROM pixel_event_deliveries ped JOIN tracking_events te ON te.id=ped.tracking_event_id WHERE ped.pixel_connection_id=pc.id AND ped.status='success' ORDER BY ped.id DESC LIMIT 1) last_internal_event,
          (SELECT te.created_at FROM pixel_event_deliveries ped JOIN tracking_events te ON te.id=ped.tracking_event_id WHERE ped.pixel_connection_id=pc.id AND ped.status='success' ORDER BY ped.id DESC LIMIT 1) last_event_at
         FROM pixel_connections pc WHERE pc.store_id=? AND pc.id=?`,
      )
      .get(storeId, id);
    if (!item) throw new Error("Pixel connection not found");
    return this.#outputConnection(item);
  }

  #outputConnection(value) {
    const item = camel(value),
      credentials = this.#decrypt(item.credentialsJson),
      lastInternalEvent = item.lastInternalEvent || "";
    delete item.credentialsJson;
    return {
      ...item,
      browserEnabled: Boolean(item.browserEnabled),
      serverEnabled: Boolean(item.serverEnabled),
      enabled: Boolean(item.enabled),
      verified: Boolean(item.verifiedAt),
      scopeIds: positiveIds(jsonValue(item.scopeIdsJson, [])),
      configuredCredentials: Object.keys(credentials).filter((key) => clean(credentials[key])),
      lastInternalEvent,
      lastEvent: legacyNames[lastInternalEvent] || lastInternalEvent,
      displayStatus:
        !item.enabled
          ? "disabled"
          : item.lastError
            ? "error"
            : !item.verifiedAt
              ? "configured"
              : !lastInternalEvent
                ? "no_events_yet"
                : "active",
    };
  }

  #normalizeInput(input, current = null) {
    const platform = clean(input.platform || current?.platform).toLowerCase(),
      definition = platformById(platform);
    if (!definition)
      throw new Error(
        "Platform must be Meta, Google, TikTok, Snapchat, Pinterest, Microsoft, or Custom",
      );
    const rawTrackingId = clean(input.trackingId ?? current?.trackingId),
      trackingId =
        platform === "custom" || platform === "snapchat"
          ? rawTrackingId
          : rawTrackingId.toUpperCase();
    if (!validTrackingId(platform, trackingId))
      throw new Error(`Enter a valid ${definition.name} ${definition.idLabel}`);
    const browserEnabled =
        input.browserEnabled === undefined
          ? current
            ? Boolean(current.browserEnabled)
            : true
          : asBoolean(input.browserEnabled),
      serverEnabled =
        input.serverEnabled === undefined
          ? current
            ? Boolean(current.serverEnabled)
            : false
          : asBoolean(input.serverEnabled);
    if (!browserEnabled && !serverEnabled)
      throw new Error("Enable Browser Tracking, Server-Side Tracking, or both");
    if (browserEnabled && !definition.browserSupported)
      throw new Error(`${definition.name} browser tracking is not supported`);
    if (serverEnabled && !definition.serverSupported)
      throw new Error(`${definition.name} server-side tracking is not available in this build`);
    const previousCredentials = current ? this.#decrypt(current.credentialsJson) : {},
      submitted = input.credentials && typeof input.credentials === "object" ? input.credentials : {},
      credentials = { ...previousCredentials };
    for (const field of definition.credentials) {
      const value = clean(submitted[field.key] ?? input[field.key]);
      if (value) credentials[field.key] = value;
    }
    if (serverEnabled)
      for (const field of definition.credentials)
        if (field.requiredForServer && !clean(credentials[field.key]))
          throw new Error(`${field.label} is required for server-side tracking`);
    if (serverEnabled && platform === "google" && !trackingId.startsWith("G-"))
      throw new Error("Google server-side tracking requires a GA4 Measurement ID beginning with G-");
    const name = clean(input.name ?? current?.name) || `${definition.name} Pixel`,
      scopeType = clean(input.scopeType ?? current?.scopeType) || "entire_store",
      scopeIds = positiveIds(
        input.scopeIds === undefined ? jsonValue(current?.scopeIdsJson, []) : input.scopeIds,
      );
    if (!scopeTypes.has(scopeType)) throw new Error("Choose a valid pixel scope");
    if (["specific_products", "specific_product_pages"].includes(scopeType) && !scopeIds.length)
      throw new Error("Choose at least one product or product page for this scope");
    return {
      platform,
      name,
      trackingId,
      browserEnabled,
      serverEnabled,
      credentials,
      scopeType,
      scopeIds,
      enabled:
        input.enabled === undefined
          ? current
            ? Boolean(current.enabled)
            : false
          : asBoolean(input.enabled),
    };
  }

  platformCatalog() {
    return pixelPlatforms.map((item) => ({
      ...item,
      credentials: item.credentials.map((field) => ({ ...field })),
    }));
  }

  listPixels(storeId) {
    this.#store(storeId);
    return this.db
      .prepare(
        `SELECT pc.*,
          (SELECT te.event_name FROM pixel_event_deliveries ped JOIN tracking_events te ON te.id=ped.tracking_event_id WHERE ped.pixel_connection_id=pc.id AND ped.status='success' ORDER BY ped.id DESC LIMIT 1) last_internal_event,
          (SELECT te.created_at FROM pixel_event_deliveries ped JOIN tracking_events te ON te.id=ped.tracking_event_id WHERE ped.pixel_connection_id=pc.id AND ped.status='success' ORDER BY ped.id DESC LIMIT 1) last_event_at
         FROM pixel_connections pc WHERE pc.store_id=? ORDER BY pc.id DESC`,
      )
      .all(storeId)
      .map((item) => this.#outputConnection(item));
  }

  #scopeMatches(connection, context = {}) {
    const ids = positiveIds(jsonValue(connection.scope_ids_json, [])),
      productId = Number(context.productId || 0),
      pageId = Number(context.pageId || 0);
    if (connection.scope_type === "entire_store") return true;
    if (connection.scope_type === "all_product_pages") return Boolean(pageId);
    if (connection.scope_type === "specific_products") return ids.includes(productId);
    if (connection.scope_type === "specific_product_pages") return ids.includes(pageId);
    return false;
  }

  activePixels(storeId, context = {}) {
    const privacy = this.#privacy(storeId);
    if (!privacy.allowPixelTracking || !privacy.advertisingPixels || !privacy.marketingTracking)
      return [];
    return this.db
      .prepare(
        "SELECT * FROM pixel_connections WHERE store_id=? AND enabled=1 AND verified_at IS NOT NULL AND status<>'error' ORDER BY id",
      )
      .all(storeId)
      .filter((item) => this.#scopeMatches(item, context))
      .map((item) => {
        const output = this.#outputConnection(item),
          mappings = this.db
            .prepare(
              "SELECT internal_event,provider_event_name,enabled FROM pixel_event_mappings WHERE store_id=? AND pixel_connection_id=?",
            )
            .all(storeId, item.id);
        return {
          ...output,
          eventMappings: Object.fromEntries(
            mappings
              .filter((mapping) => Boolean(mapping.enabled))
              .map((mapping) => [mapping.internal_event, mapping.provider_event_name]),
          ),
        };
      });
  }

  #createMappings(storeId, connectionId, platform) {
    const mappings = defaultEventMappings[platform] || defaultEventMappings.custom;
    for (const eventName of internalEvents) {
      const external = mappings[eventName] || eventName;
      if (
        this.db
          .prepare(
            "SELECT id FROM pixel_event_mappings WHERE pixel_connection_id=? AND internal_event=?",
          )
          .get(connectionId, eventName)
      )
        continue;
      this.db
        .prepare(
          "INSERT INTO pixel_event_mappings (store_id,pixel_connection_id,internal_event,provider_event_name,enabled) VALUES (?,?,?,?,?)",
        )
        .run(
          storeId,
          connectionId,
          eventName,
          external,
          externallyEnabledByDefault.has(eventName) ? 1 : 0,
        );
    }
  }

  addPixel(storeId, input) {
    this.#store(storeId);
    const value = this.#normalizeInput(input),
      legacyAutoVerify =
        input.enabled === true &&
        input.browserEnabled === undefined &&
        input.serverEnabled === undefined,
      enabled = legacyAutoVerify ? true : value.enabled,
      status = legacyAutoVerify ? "active" : "configured",
      verifiedAt = legacyAutoVerify ? timestamp() : null,
      result = this.db
        .prepare(
          "INSERT INTO pixel_connections (store_id,platform,name,tracking_id,browser_enabled,server_enabled,enabled,status,credentials_json,scope_type,scope_ids_json,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          storeId,
          value.platform,
          value.name,
          value.trackingId,
          value.browserEnabled ? 1 : 0,
          value.serverEnabled ? 1 : 0,
          enabled ? 1 : 0,
          status,
          this.#encrypt(value.credentials),
          value.scopeType,
          JSON.stringify(value.scopeIds),
          verifiedAt,
        );
    const id = Number(result.lastInsertRowid);
    this.#createMappings(storeId, id, value.platform);
    return this.#connection(storeId, id);
  }

  savePixel(storeId, id, input) {
    const current = this.#rawConnection(storeId, id),
      value = this.#normalizeInput(input, current),
      previousCredentials = this.#decrypt(current.credentialsJson),
      changed =
        value.platform !== current.platform ||
        value.trackingId !== current.trackingId ||
        value.browserEnabled !== Boolean(current.browserEnabled) ||
        value.serverEnabled !== Boolean(current.serverEnabled) ||
        value.scopeType !== current.scopeType ||
        JSON.stringify(value.scopeIds) !== JSON.stringify(positiveIds(jsonValue(current.scopeIdsJson, []))) ||
        JSON.stringify(value.credentials) !== JSON.stringify(previousCredentials),
      verifiedAt = changed ? null : current.verifiedAt,
      status = value.enabled ? (verifiedAt ? "active" : "configured") : "disabled";
    this.db
      .prepare(
        "UPDATE pixel_connections SET platform=?,name=?,tracking_id=?,browser_enabled=?,server_enabled=?,enabled=?,status=?,credentials_json=?,scope_type=?,scope_ids_json=?,verified_at=?,last_error='',updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
      )
      .run(
        value.platform,
        value.name,
        value.trackingId,
        value.browserEnabled ? 1 : 0,
        value.serverEnabled ? 1 : 0,
        value.enabled ? 1 : 0,
        status,
        this.#encrypt(value.credentials),
        value.scopeType,
        JSON.stringify(value.scopeIds),
        verifiedAt,
        storeId,
        id,
      );
    this.#createMappings(storeId, id, value.platform);
    return this.#connection(storeId, id);
  }

  async verifyPixel(storeId, id) {
    const current = this.#rawConnection(storeId, id),
      value = this.#normalizeInput({}, current),
      definition = platformById(value.platform),
      testEvent = {
        eventId: `TEST-${randomUUID()}`,
        eventName: "page_view",
        providerEventName: defaultEventMappings[value.platform]?.page_view || "page_view",
        source: "server",
        sessionId: `test-${id}`,
        createdAt: new Date().toISOString(),
        payload: { currency: "INR", test: true },
      };
    try {
      if (value.serverEnabled) {
        const adapter = this.adapters[value.platform];
        if (!adapter?.verify)
          throw new Error(`${definition.name} server-side connection testing is not configured`);
        await adapter.verify({ connection: value, credentials: value.credentials, event: testEvent });
      }
      this.db
        .prepare(
          "UPDATE pixel_connections SET verified_at=CURRENT_TIMESTAMP,status=?,last_error='',updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(current.enabled ? "active" : "connected", storeId, id);
    } catch (error) {
      const message = this.#safeError(error, value.credentials);
      this.db
        .prepare(
          "UPDATE pixel_connections SET verified_at=NULL,status='error',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(message, storeId, id);
      throw new Error(message);
    }
    const result = this.#connection(storeId, id),
      counts = this.db
        .prepare(
          `SELECT te.event_name,COUNT(*) count FROM pixel_event_deliveries ped
           JOIN tracking_events te ON te.id=ped.tracking_event_id
           WHERE ped.store_id=? AND ped.pixel_connection_id=? AND ped.status='success'
           GROUP BY te.event_name`,
        )
        .all(storeId, id),
      received = Object.fromEntries(counts.map((item) => [item.event_name, Number(item.count)])),
      eventStatus = Object.fromEntries(
        [...internalEvents].map((name) => [name, received[name] ? "received" : "no_event_yet"]),
      );
    eventStatus.product_page_view = eventStatus.product_view;
    eventStatus.checkout_start = eventStatus.checkout_started;
    eventStatus.purchase = eventStatus.order_created;
    return {
      ...result,
      testResult: {
        configurationValid: true,
        browserValidated: value.browserEnabled,
        serverValidated: value.serverEnabled,
        events: eventStatus,
      },
    };
  }

  enablePixel(storeId, id, enabled) {
    const current = this.#rawConnection(storeId, id);
    if (enabled && !current.verifiedAt)
      throw new Error("Test the connection before enabling tracking");
    this.db
      .prepare(
        "UPDATE pixel_connections SET enabled=?,status=?,last_error=CASE WHEN ?=1 THEN '' ELSE last_error END,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
      )
      .run(enabled ? 1 : 0, enabled ? "active" : "disabled", enabled ? 1 : 0, storeId, id);
    return this.#connection(storeId, id);
  }

  deletePixel(storeId, id) {
    const current = this.#rawConnection(storeId, id);
    this.db
      .prepare("DELETE FROM pixel_connections WHERE store_id=? AND id=?")
      .run(storeId, id);
    return { deleted: true, platform: current.platform };
  }

  listMappings(storeId, connectionId = null) {
    this.#store(storeId);
    const rows = connectionId
      ? this.db
          .prepare(
            `SELECT pem.*,pc.name connection_name,pc.platform FROM pixel_event_mappings pem
             JOIN pixel_connections pc ON pc.id=pem.pixel_connection_id
             WHERE pem.store_id=? AND pem.pixel_connection_id=? ORDER BY pem.id`,
          )
          .all(storeId, connectionId)
      : this.db
          .prepare(
            `SELECT pem.*,pc.name connection_name,pc.platform FROM pixel_event_mappings pem
             JOIN pixel_connections pc ON pc.id=pem.pixel_connection_id
             WHERE pem.store_id=? ORDER BY pc.id,pem.id`,
          )
          .all(storeId);
    return rows.map((item) => ({ ...camel(item), enabled: Boolean(item.enabled) }));
  }

  saveMappings(storeId, connectionId, input) {
    this.#rawConnection(storeId, connectionId);
    const mappings = Array.isArray(input.mappings) ? input.mappings : [];
    if (!mappings.length) throw new Error("Provide at least one event mapping");
    for (const mapping of mappings) {
      const internalEvent = canonicalEvent(mapping.internalEvent),
        providerEventName = clean(mapping.providerEventName);
      if (!internalEvents.has(internalEvent)) throw new Error("Unsupported internal tracking event");
      if (!/^[A-Za-z0-9_. -]{1,80}$/.test(providerEventName))
        throw new Error("Enter a valid provider event name");
      this.db
        .prepare(
          "UPDATE pixel_event_mappings SET provider_event_name=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND pixel_connection_id=? AND internal_event=?",
        )
        .run(
          providerEventName,
          asBoolean(mapping.enabled) ? 1 : 0,
          storeId,
          connectionId,
          internalEvent,
        );
    }
    return this.listMappings(storeId, connectionId);
  }

  #isBot(storeId, sessionId, explicit) {
    if (asBoolean(explicit)) return true;
    if (!sessionId) return false;
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM live_visitor_sessions WHERE store_id=? AND session_id=? AND is_bot=1",
        )
        .get(storeId, sessionId) ||
        this.db
          .prepare(
            "SELECT 1 FROM cod_bot_attempts WHERE store_id=? AND visitor_session_id=? AND blocked=1 ORDER BY created_at DESC LIMIT 1",
          )
          .get(storeId, sessionId),
    );
  }

  #validateEvent(eventName, input, strict) {
    if (!internalEvents.has(eventName)) throw new Error("Unsupported tracking event");
    if (!strict) return;
    if (["product_view", "add_to_cart", "checkout_started"].includes(eventName) && !Number(input.productId))
      throw new Error(`${eventName} requires a valid product`);
    if (eventName === "checkout_started" && !clean(input.checkoutSessionId))
      throw new Error("checkout_started requires a checkout session");
    if (eventName === "order_created" && !Number(input.orderId))
      throw new Error("order_created requires a real order");
  }

  #event(storeId, id) {
    const row = this.db
      .prepare("SELECT * FROM tracking_events WHERE store_id=? AND id=?")
      .get(storeId, id);
    if (!row) throw new Error("Tracking event not found");
    const item = camel(row);
    return { ...item, payload: jsonValue(item.payloadJson, {}) };
  }

  #eligibleConnections(storeId, event) {
    return this.db
      .prepare(
        "SELECT * FROM pixel_connections WHERE store_id=? AND enabled=1 AND verified_at IS NOT NULL AND status<>'error' ORDER BY id",
      )
      .all(storeId)
      .filter((connection) => this.#scopeMatches(connection, event));
  }

  #delivery(storeId, trackingEventId, connectionId, channel) {
    return this.db
      .prepare(
        "SELECT * FROM pixel_event_deliveries WHERE store_id=? AND tracking_event_id=? AND pixel_connection_id=? AND channel=?",
      )
      .get(storeId, trackingEventId, connectionId, channel);
  }

  #insertDelivery(storeId, event, connection, channel, providerEventName, status, error = "") {
    const existing = this.#delivery(storeId, event.id, connection.id, channel);
    if (existing) return camel(existing);
    const result = this.db
      .prepare(
        "INSERT INTO pixel_event_deliveries (store_id,tracking_event_id,pixel_connection_id,channel,provider_event_name,status,error,attempts,sent_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        storeId,
        event.id,
        connection.id,
        channel,
        providerEventName,
        status,
        error,
        status === "success" ? 1 : 0,
        status === "success" ? timestamp() : null,
      );
    return camel(this.db.prepare("SELECT * FROM pixel_event_deliveries WHERE id=?").get(Number(result.lastInsertRowid)));
  }

  async #sendDelivery(storeId, delivery, connection, event, { test = false } = {}) {
    const adapter = this.adapters[connection.platform];
    if (!adapter?.send) {
      const message = `${platformById(connection.platform)?.name || connection.platform} server adapter is not configured`;
      this.db
        .prepare(
          "UPDATE pixel_event_deliveries SET status='failed',error=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(message, storeId, delivery.id);
      return { ...delivery, status: "failed", error: message };
    }
    try {
      await adapter.send({
        connection: camel(connection),
        credentials: this.#decrypt(connection.credentials_json),
        event: { ...event, providerEventName: delivery.providerEventName },
        test,
      });
      this.db
        .prepare(
          "UPDATE pixel_event_deliveries SET status='success',error='',attempts=attempts+1,sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(storeId, delivery.id);
      this.db
        .prepare(
          "UPDATE pixel_connections SET status=CASE WHEN enabled=1 THEN 'active' ELSE 'connected' END,last_error='',updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(storeId, connection.id);
      return { ...delivery, status: "success", error: "" };
    } catch (error) {
      const message = this.#safeError(
        error,
        this.#decrypt(connection.credentials_json),
      );
      this.db
        .prepare(
          "UPDATE pixel_event_deliveries SET status='failed',error=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(message, storeId, delivery.id);
      this.db
        .prepare(
          "UPDATE pixel_connections SET status='error',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(message, storeId, connection.id);
      return { ...delivery, status: "failed", error: message };
    }
  }

  async #route(storeId, event, input, privacy) {
    const connections = this.#eligibleConnections(storeId, event),
      blockedByPrivacy =
        !privacy.allowPixelTracking ||
        !privacy.advertisingPixels ||
        !privacy.marketingTracking ||
        (privacy.requireMarketingConsent && !asBoolean(input.consentGranted)),
      blockedReason = event.isBot
        ? "Blocked bot or suspicious traffic"
        : blockedByPrivacy
          ? "Blocked by Customer Privacy settings or missing marketing consent"
          : "";
    let delivered = 0,
      failed = 0,
      skipped = 0;
    for (const connection of connections) {
      const mapping = this.db
        .prepare(
          "SELECT provider_event_name,enabled FROM pixel_event_mappings WHERE store_id=? AND pixel_connection_id=? AND internal_event=?",
        )
        .get(storeId, connection.id, event.eventName);
      if (!mapping || !Boolean(mapping.enabled)) continue;
      const channels = [];
      if (input.source === "browser" && connection.browser_enabled) channels.push("browser");
      if (connection.server_enabled) channels.push("server");
      for (const channel of channels) {
        if (blockedReason) {
          if (!this.#delivery(storeId, event.id, connection.id, channel)) {
            this.#insertDelivery(
              storeId,
              event,
              connection,
              channel,
              mapping.provider_event_name,
              "skipped",
              blockedReason,
            );
            skipped += 1;
          }
          continue;
        }
        if (channel === "browser") {
          if (!this.#delivery(storeId, event.id, connection.id, channel)) {
            this.#insertDelivery(
              storeId,
              event,
              connection,
              channel,
              mapping.provider_event_name,
              "success",
            );
            delivered += 1;
          }
          continue;
        }
        let delivery = this.#delivery(storeId, event.id, connection.id, channel);
        if (delivery && ["success", "queued"].includes(delivery.status)) continue;
        if (!delivery)
          delivery = this.#insertDelivery(
            storeId,
            event,
            connection,
            channel,
            mapping.provider_event_name,
            "queued",
          );
        const result = await this.#sendDelivery(storeId, delivery, connection, event);
        if (result.status === "success") delivered += 1;
        else failed += 1;
      }
    }
    return { delivered, failed, skipped, blockedByPrivacy };
  }

  #consumeLiveVisitor(storeId, event, privacy, ipAddress) {
    if (!this.liveVisitors || event.isBot || !event.sessionId) return;
    const liveEvent =
      event.eventName === "product_view"
        ? "product_page_view"
        : event.eventName;
    if (
      ![
        "product_page_view",
        "add_to_cart",
        "checkout_started",
        "checkout_progress",
        "otp_started",
        "otp_verified",
        "order_created",
      ].includes(liveEvent)
    )
      return;
    try {
      this.liveVisitors.record(
        storeId,
        {
          eventName: liveEvent,
          eventId: event.eventId,
          sessionId: event.sessionId,
          productId: event.productId,
          pageId: event.pageId,
          pageSlug: event.pageSlug,
          quantity: event.payload.quantity,
          bundleId: event.payload.bundleId,
          cartValue: event.payload.cartValue,
          checkoutSessionId: event.checkoutSessionId,
          checkoutProgress: event.payload.checkoutProgress,
          userAgent: event.payload.userAgent,
          heartbeat: event.payload.heartbeat,
        },
        { allowTracking: privacy.allowVisitorTracking, ipAddress },
      );
    } catch {
      // A partial analytics event must not make pixel delivery fail.
    }
  }

  async track(storeId, input, { strict = true, ipAddress = "", userAgent = "" } = {}) {
    this.#store(storeId);
    const eventName = canonicalEvent(input.eventName);
    this.#validateEvent(eventName, input, strict);
    const source = clean(input.source).toLowerCase() === "server" ? "server" : "browser",
      sessionId = clean(input.sessionId),
      productId = Number(input.productId) || null,
      pageId = Number(input.pageId) || null,
      checkoutSessionId = clean(input.checkoutSessionId) || null,
      orderId = Number(input.orderId) || null,
      pageSlug = clean(input.pageSlug),
      requestedEventId = clean(input.eventId),
      eventId =
        requestedEventId ||
        (eventName === "order_created" && orderId
          ? `ORDER-${orderId}`
          : eventName === "checkout_started" && checkoutSessionId
            ? `CHECKOUT-${checkoutSessionId}`
            : randomUUID());
    if (!/^[A-Za-z0-9_.:#-]{1,160}$/.test(eventId)) throw new Error("Enter a valid event ID");
    const isBot = this.#isBot(storeId, sessionId, input.isBot),
      payload = {
        ...(input.data && typeof input.data === "object" ? input.data : {}),
        ...Object.fromEntries(
          Object.entries(input).filter(
            ([key]) =>
              ![
                "eventName",
                "eventId",
                "source",
                "sessionId",
                "pageId",
                "productId",
                "checkoutSessionId",
                "orderId",
                "pageSlug",
                "consentGranted",
                "visitorToken",
                "isBot",
                "data",
              ].includes(key),
          ),
        ),
        ...(ipAddress ? { ipAddress } : {}),
        ...(userAgent ? { userAgent } : {}),
      },
      privacy = this.#privacy(storeId);
    if (!analyticsAllowed(privacy,input)) return {recorded:false,eventId,eventName,source,delivered:0,failed:0,skipped:0,blockedByPrivacy:true};
    if (asBoolean(input.heartbeat)) {
      this.#consumeLiveVisitor(
        storeId,
        {
          eventName,
          eventId,
          source,
          sessionId,
          productId,
          pageId,
          checkoutSessionId,
          pageSlug,
          payload,
          isBot,
        },
        privacy,
        ipAddress,
      );
      return {
        recorded: false,
        heartbeat: true,
        eventId,
        eventName,
        source,
        delivered: 0,
        failed: 0,
        skipped: 0,
      };
    }
    let stored = this.db
        .prepare("SELECT * FROM tracking_events WHERE store_id=? AND event_id=? AND event_name=?")
        .get(storeId, eventId, eventName),
      deduplicated = Boolean(stored);
    if (!stored) {
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO tracking_events (id,store_id,event_id,event_name,source,session_id,page_id,product_id,checkout_session_id,order_id,page_slug,payload_json,consent_granted,is_bot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          storeId,
          eventId,
          eventName,
          source,
          sessionId,
          pageId,
          productId,
          checkoutSessionId,
          orderId,
          pageSlug,
          JSON.stringify(payload),
          asBoolean(input.consentGranted) ? 1 : 0,
          isBot ? 1 : 0,
        );
      stored = this.db.prepare("SELECT * FROM tracking_events WHERE id=?").get(id);
    } else if (stored.source !== source && stored.source !== "browser+server") {
      this.db
        .prepare(
          "UPDATE tracking_events SET source='browser+server',consent_granted=CASE WHEN consent_granted=1 OR ?=1 THEN 1 ELSE 0 END WHERE id=?",
        )
        .run(asBoolean(input.consentGranted) ? 1 : 0, stored.id);
      stored = this.db.prepare("SELECT * FROM tracking_events WHERE id=?").get(stored.id);
    }
    const event = {
      ...camel(stored),
      payload: jsonValue(stored.payload_json, payload),
      isBot: Boolean(stored.is_bot),
    };
    this.#consumeLiveVisitor(storeId, event, privacy, ipAddress);
    const routed = await this.#route(storeId, event, { ...input, source }, privacy);
    return {
      recorded: true,
      eventId,
      eventName,
      source: event.source,
      deduplicated,
      ...routed,
    };
  }

  async recordEvent(storeId, input) {
    const privacy = this.#privacy(storeId);
    if (!privacy.allowPixelTracking || !privacy.advertisingPixels || !privacy.marketingTracking)
      return {
        recorded: 0,
        eventName: clean(input.eventName).toLowerCase(),
        blockedByPrivacy: true,
      };
    if (privacy.requireMarketingConsent && input.consentGranted !== true)
      throw new Error("Marketing tracking consent is required");
    const result = await this.track(
      storeId,
      { ...input, source: input.source || "browser" },
      { strict: false },
    );
    return { ...result, eventName: clean(input.eventName).toLowerCase(), recorded: result.delivered };
  }

  #eventOutput(row) {
    const event = camel(row),
      deliveries = this.db
        .prepare(
          `SELECT ped.*,pc.name connection_name,pc.platform FROM pixel_event_deliveries ped
           JOIN pixel_connections pc ON pc.id=ped.pixel_connection_id
           WHERE ped.store_id=? AND ped.tracking_event_id=? ORDER BY ped.id`,
        )
        .all(event.storeId, event.id)
        .map((item) => ({ ...camel(item) })),
      statuses = deliveries.map((item) => item.status),
      status = statuses.includes("failed")
        ? "failed"
        : statuses.includes("success")
          ? "success"
          : statuses.includes("queued")
            ? "queued"
            : statuses.includes("skipped")
              ? "skipped"
              : "recorded";
    return {
      ...event,
      payload: jsonValue(event.payloadJson, {}),
      isBot: Boolean(event.isBot),
      consentGranted: Boolean(event.consentGranted),
      platform: deliveries[0]?.platform || "internal",
      status,
      deliveries,
    };
  }

  listEvents(storeId, filters = {}) {
    this.#store(storeId);
    let sql = "SELECT * FROM tracking_events WHERE store_id=?",
      params = [storeId];
    const eventName = filters.eventName ? canonicalEvent(filters.eventName) : "",
      source = clean(filters.source).toLowerCase();
    if (eventName) {
      sql += " AND event_name=?";
      params.push(eventName);
    }
    if (["browser", "server", "browser+server"].includes(source)) {
      sql += " AND source=?";
      params.push(source);
    }
    sql += " ORDER BY created_at DESC,id DESC LIMIT 200";
    let events = this.db
      .prepare(sql)
      .all(...params)
      .map((item) => this.#eventOutput(item));
    if (filters.status) events = events.filter((item) => item.status === filters.status);
    return events;
  }

  funnelMetrics(storeId) {
    this.#store(storeId);
    const counts = Object.fromEntries(
        this.db
          .prepare(
            `SELECT event_name,COUNT(*) count FROM tracking_events
             WHERE store_id=? AND is_bot=0 GROUP BY event_name`,
          )
          .all(storeId)
          .map((item) => [item.event_name, Number(item.count)]),
      ),
      productPageViews = Number(counts.product_view || 0),
      orders = Number(counts.order_created || 0);
    return {
      productPageViews,
      addToCart: Number(counts.add_to_cart || 0),
      checkoutStarted: Number(counts.checkout_started || 0),
      otpVerified: Number(counts.otp_verified || 0),
      orders,
      conversionRate: productPageViews
        ? Math.round((orders * 10000) / productPageViews) / 100
        : 0,
    };
  }

  listLegacyEvents(storeId) {
    return this.listEvents(storeId).map((event) => ({
      ...event,
      internalEventName: event.eventName,
      eventName: legacyNames[event.eventName] || event.eventName,
    }));
  }

  listDeliveries(storeId, filters = {}) {
    this.#store(storeId);
    let rows = this.db
      .prepare(
        `SELECT ped.*,pc.name connection_name,pc.platform,te.event_id,te.event_name,te.source,te.page_slug,te.created_at event_created_at
         FROM pixel_event_deliveries ped
         JOIN pixel_connections pc ON pc.id=ped.pixel_connection_id
         JOIN tracking_events te ON te.id=ped.tracking_event_id
         WHERE ped.store_id=? ORDER BY ped.created_at DESC,ped.id DESC LIMIT 300`,
      )
      .all(storeId)
      .map((item) => camel(item));
    if (filters.connectionId)
      rows = rows.filter((item) => item.pixelConnectionId === Number(filters.connectionId));
    if (filters.status && deliveryStatuses.has(filters.status))
      rows = rows.filter((item) => item.status === filters.status);
    return rows;
  }

  async retryDelivery(storeId, deliveryId) {
    const row = this.db
      .prepare(
        `SELECT ped.*,pc.platform,pc.tracking_id,pc.credentials_json,pc.name,pc.browser_enabled,pc.server_enabled
         FROM pixel_event_deliveries ped JOIN pixel_connections pc ON pc.id=ped.pixel_connection_id
         WHERE ped.store_id=? AND ped.id=?`,
      )
      .get(storeId, deliveryId);
    if (!row) throw new Error("Pixel delivery not found");
    if (row.channel !== "server") throw new Error("Only failed server deliveries can be retried safely");
    if (row.status !== "failed") throw new Error("Only failed deliveries can be retried");
    const event = this.#event(storeId, row.tracking_event_id);
    this.db
      .prepare(
        "UPDATE pixel_event_deliveries SET status='queued',error='',updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
      )
      .run(storeId, deliveryId);
    return this.#sendDelivery(storeId, camel(row), row, event);
  }
}

export { internalEvents };
