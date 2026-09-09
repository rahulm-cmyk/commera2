import { randomUUID } from "node:crypto";

const clean = (value) => String(value ?? "").trim();
const deviceType = (userAgent) => {
  const value = clean(userAgent).toLowerCase();
  if (!value) return "Unknown";
  if (/ipad|tablet|kindle|silk/.test(value)) return "Tablet";
  if (/mobile|iphone|ipod|android/.test(value)) return "Mobile";
  return "Desktop";
};
const camelRow = (value) =>
  value
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
          item,
        ]),
      )
    : null;

const events = new Set([
  "product_page_view",
  "add_to_cart",
  "checkout_started",
  "checkout_progress",
  "otp_started",
  "otp_verified",
  "order_created",
]);
const progressStages = new Set([
  "",
  "checkout_opened",
  "phone_entered",
  "address_started",
  "pincode_entered",
  "details_completed",
  "order_submitted",
  "otp_started",
  "otp_verified",
  "order_created",
]);

export class LiveVisitorService {
  constructor(db) {
    this.db = db;
    this.subscribers = new Map();
  }

  subscribe(storeId, listener) {
    this.#store(storeId);
    const listeners = this.subscribers.get(storeId) || new Set();
    listeners.add(listener);
    this.subscribers.set(storeId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.subscribers.delete(storeId);
    };
  }

  #publish(storeId) {
    for (const listener of this.subscribers.get(storeId) || []) {
      try {
        listener();
      } catch {
        // A disconnected merchant stream must not break storefront tracking.
      }
    }
  }

  #store(storeId) {
    if (!this.db.prepare("SELECT id FROM stores WHERE id=?").get(storeId))
      throw new Error("Store not found");
  }

  #identity(storeId, input) {
    const sessionId = clean(input.sessionId),
      requestedProductId = Number(input.productId),
      requestedPageId = Number(input.pageId);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId))
      throw new Error("A valid visitor session is required");
    const page = requestedPageId
      ? this.db
          .prepare(
            "SELECT id,product_id,slug FROM product_pages WHERE store_id=? AND id=? AND deleted_at IS NULL",
          )
          .get(storeId, requestedPageId)
      : this.db
          .prepare(
            "SELECT id,product_id,slug FROM product_pages WHERE store_id=? AND slug=? AND deleted_at IS NULL",
          )
          .get(storeId, clean(input.pageSlug));
    const pageId = Number(page?.id),
      productId = requestedProductId || Number(page?.product_id);
    if (!page || Number(page.product_id) !== productId)
      throw new Error("Visitor page and product do not match");
    const product = this.db
      .prepare("SELECT id,price_paise FROM products WHERE store_id=? AND id=?")
      .get(storeId, productId);
    if (!product) throw new Error("Product not found");
    return { sessionId, productId, pageId, page, product };
  }

  #cart(storeId, product, input) {
    let quantity = Number(input.quantity || 1),
      bundleId = input.bundleId ? Number(input.bundleId) : null,
      cartValuePaise;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      quantity = 1;
    if (bundleId) {
      const bundle = this.db
        .prepare(
          "SELECT id,quantity,price_paise FROM product_bundles WHERE store_id=? AND id=? AND product_id=? AND active=1",
        )
        .get(storeId, bundleId, product.id);
      if (bundle) {
        quantity = Number(bundle.quantity);
        cartValuePaise = Number(bundle.price_paise);
      } else bundleId = null;
    }
    if (cartValuePaise === undefined)
      cartValuePaise = Number(product.price_paise) * quantity;
    return { quantity, bundleId, cartValuePaise };
  }

  record(
    storeId,
    input,
    { allowTracking = true, ipAddress = "", userAgent = "" } = {},
  ) {
    this.#store(storeId);
    if (!allowTracking) return { recorded: false, blockedByPrivacy: true };
    const eventName = clean(input.eventName).toLowerCase();
    if (!events.has(eventName)) throw new Error("Unsupported visitor event");
    const eventId = clean(input.eventId) || randomUUID();
    if (this.db.prepare("SELECT 1 FROM live_visitor_events WHERE event_id=?").get(eventId))
      return { recorded: false, duplicate: true, eventId };
    const identity = this.#identity(storeId, input),
      cart = this.#cart(storeId, identity.product, input),
      progress = clean(input.checkoutProgress).toLowerCase(),
      checkoutProgress = progressStages.has(progress) ? progress : "",
      checkoutSessionId = clean(input.checkoutSessionId) || null,
      status =
        ["checkout_started", "checkout_progress", "otp_started", "otp_verified", "order_created"].includes(eventName)
          ? "checkout"
          : eventName === "add_to_cart"
            ? "add_to_cart"
            : "viewing_product";
    const current = this.db
      .prepare(
        "SELECT status FROM live_visitor_sessions WHERE store_id=? AND session_id=?",
      )
      .get(storeId, identity.sessionId);
    const resolvedStatus =
      current && eventName === "product_page_view" && current.status !== "viewing_product"
        ? current.status
        : status;
    this.db
      .prepare(
        `INSERT INTO live_visitor_sessions (store_id,session_id,product_id,page_id,page_slug,status,quantity,bundle_id,cart_value_paise,checkout_session_id,checkout_progress,ip_address,device_type,checkout_started_at,last_activity_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='checkout' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP)
         ON CONFLICT(store_id,session_id) DO UPDATE SET product_id=excluded.product_id,page_id=excluded.page_id,page_slug=excluded.page_slug,status=excluded.status,quantity=excluded.quantity,bundle_id=excluded.bundle_id,cart_value_paise=excluded.cart_value_paise,checkout_session_id=COALESCE(excluded.checkout_session_id,live_visitor_sessions.checkout_session_id),checkout_progress=CASE WHEN excluded.checkout_progress='' THEN live_visitor_sessions.checkout_progress ELSE excluded.checkout_progress END,ip_address=CASE WHEN excluded.ip_address='' THEN live_visitor_sessions.ip_address ELSE excluded.ip_address END,device_type=CASE WHEN excluded.device_type='Unknown' THEN live_visitor_sessions.device_type ELSE excluded.device_type END,checkout_started_at=CASE WHEN excluded.status='checkout' THEN COALESCE(live_visitor_sessions.checkout_started_at,CURRENT_TIMESTAMP) ELSE live_visitor_sessions.checkout_started_at END,last_activity_at=CURRENT_TIMESTAMP`,
      )
      .run(
        storeId,
        identity.sessionId,
        identity.productId,
        identity.pageId,
        clean(input.pageSlug) || clean(identity.page.slug),
        resolvedStatus,
        cart.quantity,
        cart.bundleId,
        cart.cartValuePaise,
        checkoutSessionId,
        checkoutProgress,
        clean(ipAddress),
        deviceType(input.userAgent || userAgent),
        resolvedStatus,
      );
    if (!input.heartbeat) {
      const eventIndex =
        Number(
          this.db
            .prepare(
              "SELECT COUNT(*) count FROM live_visitor_events WHERE store_id=? AND session_id=?",
            )
            .get(storeId, identity.sessionId).count,
        ) + 1;
      this.db
        .prepare(
          "INSERT INTO live_visitor_events (event_id,store_id,session_id,event_name,product_id,page_id,quantity,bundle_id,cart_value_paise,checkout_session_id,checkout_progress,event_index) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          eventId,
          storeId,
          identity.sessionId,
          eventName,
          identity.productId,
          identity.pageId,
          cart.quantity,
          cart.bundleId,
          cart.cartValuePaise,
          checkoutSessionId,
          checkoutProgress,
          eventIndex,
        );
    }
    this.#publish(storeId);
    return { recorded: true, eventId, sessionId: identity.sessionId, status: resolvedStatus };
  }

  heartbeat(storeId, input, { allowTracking = true } = {}) {
    this.#store(storeId);
    if (!allowTracking) return { recorded: false, blockedByPrivacy: true };
    const sessionId = clean(input.sessionId);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId))
      throw new Error("A valid visitor session is required");
    const pageSlug = clean(input.pageSlug);
    const result = this.db
      .prepare(
        "UPDATE live_visitor_sessions SET last_activity_at=CURRENT_TIMESTAMP WHERE store_id=? AND session_id=? AND (?='' OR page_slug=?) AND is_bot=0",
      )
      .run(storeId, sessionId, pageSlug, pageSlug);
    if (!result.changes) return { recorded: false, sessionMissing: true };
    this.#publish(storeId);
    return { recorded: true, heartbeat: true, sessionId };
  }

  recordCheckoutStage(storeId, checkoutSessionId, checkoutProgress) {
    const current = this.db
      .prepare(
        "SELECT session_id,product_id,page_id,page_slug,quantity,bundle_id FROM live_visitor_sessions WHERE store_id=? AND checkout_session_id=? ORDER BY last_activity_at DESC LIMIT 1",
      )
      .get(storeId, checkoutSessionId);
    if (!current) return { recorded: false };
    return this.record(storeId, {
      eventName: "checkout_started",
      sessionId: current.session_id,
      productId: current.product_id,
      pageId: current.page_id,
      pageSlug: current.page_slug,
      quantity: current.quantity,
      bundleId: current.bundle_id,
      checkoutSessionId,
      checkoutProgress,
    });
  }

  list(storeId, { timeoutMinutes = 5 } = {}) {
    this.#store(storeId);
    const timeout = Math.max(1, Math.min(60, Number(timeoutMinutes) || 5)),
      cutoff = new Date(Date.now() - timeout * 60_000)
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");
    const visitors = this.db
      .prepare(
        `SELECT lvs.*,p.name product_name,pp.title page_name,b.name bundle_name,
          CASE WHEN cs.id IS NOT NULL AND cs.status='draft' THEN 1 ELSE 0 END abandoned
         FROM live_visitor_sessions lvs
         JOIN products p ON p.id=lvs.product_id
         JOIN product_pages pp ON pp.id=lvs.page_id
         LEFT JOIN product_bundles b ON b.id=lvs.bundle_id
         LEFT JOIN checkout_sessions cs ON cs.id=lvs.checkout_session_id
         WHERE lvs.store_id=? AND lvs.is_bot=0 AND lvs.last_activity_at>=?
         ORDER BY lvs.last_activity_at DESC`,
      )
      .all(storeId, cutoff)
      .map((value) => ({ ...camelRow(value), abandoned: Boolean(value.abandoned) }));
    return {
      timeoutMinutes: timeout,
      count: visitors.length,
      counts: {
        all: visitors.length,
        viewingProduct: visitors.filter((item) => item.status === "viewing_product").length,
        addToCart: visitors.filter((item) => item.status === "add_to_cart").length,
        checkout: visitors.filter((item) => item.status === "checkout").length,
      },
      visitors,
    };
  }

  detail(storeId, sessionId, options = {}) {
    const active = this.list(storeId, options).visitors.find(
      (item) => item.sessionId === sessionId,
    );
    if (!active) throw new Error("Live visitor not found or inactive");
    const events = this.db
      .prepare(
        "SELECT * FROM live_visitor_events WHERE store_id=? AND session_id=? ORDER BY event_index ASC,created_at ASC",
      )
      .all(storeId, sessionId)
      .map(camelRow);
    return { ...active, events };
  }
}
