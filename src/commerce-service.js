import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { publishPageSnapshot } from './page-publication.js';
import { parseDatabaseTimestamp } from './database-time.js';
import { SettingsService } from './settings-service.js';
import { quoteShipping, shippingItems } from './shipping-rules.js';
import { customCheckoutValues, validateCustomCheckout, saveCustomCheckout, checkoutAddons, saveCheckoutAddons, placeCheckoutAddons } from './cod-builder.js';

const row = (value) =>
  value
    ? Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
          v,
        ]),
      )
    : null;
const clean = (value) => String(value ?? "").trim();
const checkoutExpired = (value) => {
  const time = parseDatabaseTimestamp(value);
  return !Number.isFinite(time) || Date.now() - time > 2 * 60 * 60 * 1000;
};
const normalizeSpaces = (value) => clean(value).replace(/\s+/g, " ");
const identityFingerprint = (value) =>
  normalizeSpaces(value)
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const fakeMobile = (value) => /^(\d)\1{9}$/.test(value);
const meaningfulAddress = (value) => {
  const address = normalizeSpaces(value),
    tokens = address.toLocaleLowerCase("en-IN").match(/[\p{L}\p{N}]+/gu) || [],
    generic = new Set([
      "test",
      "testing",
      "abc",
      "address",
      "none",
      "na",
      "n",
      "a",
      "unknown",
    ]);
  return (
    address.length >= 10 &&
    tokens.some((token) => /[\p{L}]/u.test(token) && !generic.has(token)) &&
    new Set(tokens).size >= 2
  );
};
const normalizeTags = (values) => {
  if (!Array.isArray(values)) throw new Error("Order tags must be an array");
  const tags = [];
  for (const value of values) {
    const tag = clean(value);
    if (!tag) continue;
    if (tag.length > 40)
      throw new Error("Order tags must be 40 characters or fewer");
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > 20) throw new Error("An order can have at most 20 tags");
  return tags;
};
const withTags = (value) => {
  const result = row(value);
  if (!result) return null;
  try {
    result.tags = normalizeTags(JSON.parse(result.tagsJson || "[]"));
  } catch {
    result.tags = [];
  }
  delete result.tagsJson;
  return result;
};
const paymentMethod = (value) => {
  const method = clean(value || "cod").toLowerCase();
  if (method !== "cod")
    throw new Error("Only Cash on Delivery (COD) is currently available");
  return method;
};
const giftCardCode = (value) => {
  const code = clean(value).toUpperCase();
  if (code && !/^[A-Z0-9-]{6,32}$/.test(code))
    throw new Error("Enter a valid gift card code");
  return code;
};
const indianStates = new Set([
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
]);
const accepted = (value) =>
  value === true ||
  value === 1 ||
  String(value).toLowerCase() === "true" ||
  String(value).toLowerCase() === "on";
const upsellTokenHash = (value) =>
  createHash("sha256").update(String(value || "")).digest("hex");
const safeTokenMatch = (provided, expected) => {
  const actual = Buffer.from(upsellTokenHash(provided), "hex"),
    stored = Buffer.from(String(expected || ""), "hex");
  return actual.length === stored.length && timingSafeEqual(actual, stored);
};

export class CommerceService {
  constructor(db) {
    this.db = db;
  }

  createStore(input) {
    const name = clean(input.name),
      currency = clean(input.currency || "INR").toUpperCase();
    if (!name) throw new Error("Store name is required");
    const slug = clean(input.slug)
      ? this.#slug(input.slug)
      : this.#nextStoreSlug(name);
    if (!/^[A-Z]{3}$/.test(currency))
      throw new Error("Currency must be a valid three-letter code");
    try {
      new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
        0,
      );
    } catch {
      throw new Error("Currency code is not supported");
    }
    try {
      const result = this.db
        .prepare("INSERT INTO stores (name, slug, currency) VALUES (?, ?, ?)")
        .run(name, slug, currency);
      return this.getStore(Number(result.lastInsertRowid));
    } catch (error) {
      this.#friendlyConstraint(error, "Store slug already exists");
    }
  }

  listStores() {
    return this.db
      .prepare("SELECT * FROM stores ORDER BY created_at, id")
      .all()
      .map(row);
  }
  getStore(id) {
    const value = row(
      this.db.prepare("SELECT * FROM stores WHERE id = ?").get(id),
    );
    if (!value) throw new Error("Store not found");
    return value;
  }

  createProduct(storeId, input) {
    this.getStore(storeId);
    const name = clean(input.name),
      slug = this.#slug(input.slug);
    const price = Number(input.pricePaise),
      comparePrice =
        input.comparePricePaise === null ||
        input.comparePricePaise === undefined ||
        input.comparePricePaise === ""
          ? null
          : Number(input.comparePricePaise),
      description = clean(input.description),
      stock = Number(input.stock ?? 0),
      active = clean(input.status).toLowerCase() !== "draft";
    if (!name) throw new Error("Product name is required");
    if (!Number.isInteger(price) || price < 0)
      throw new Error("Price must be a non-negative integer in paise");
    if (
      comparePrice !== null &&
      (!Number.isInteger(comparePrice) || comparePrice < price)
    )
      throw new Error("Compare-at price must be at least the product price");
    if (!Number.isInteger(stock) || stock < 0)
      throw new Error("Stock must be a non-negative integer");
    try {
      const result = this.db
        .prepare(
          "INSERT INTO products (store_id,name,slug,price_paise,compare_price_paise,description,stock,active) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          storeId,
          name,
          slug,
          price,
          comparePrice,
          description,
          stock,
          active ? 1 : 0,
        );
      return this.getProduct(storeId, Number(result.lastInsertRowid));
    } catch (error) {
      this.#friendlyConstraint(
        error,
        "Product slug already exists in this store",
      );
    }
  }

  updateProduct(storeId, id, input) {
    const current = this.getProduct(storeId, id),
      name = clean(input.name ?? current.name),
      slug = this.#slug(input.slug ?? current.slug),
      price = Number(input.pricePaise ?? current.pricePaise),
      comparePriceValue = input.comparePricePaise ?? current.comparePricePaise,
      comparePrice =
        comparePriceValue === null || comparePriceValue === ""
          ? null
          : Number(comparePriceValue),
      description = clean(input.description ?? current.description),
      stock = Number(input.stock ?? current.stock),
      active =
        input.status === undefined
          ? Boolean(current.active)
          : clean(input.status).toLowerCase() !== "draft";
    if (!name) throw Error("Product name is required");
    if (!Number.isInteger(price) || price < 0)
      throw Error("Price must be a non-negative integer in paise");
    if (
      comparePrice !== null &&
      (!Number.isInteger(comparePrice) || comparePrice < price)
    )
      throw Error("Compare-at price must be at least the product price");
    if (!Number.isInteger(stock) || stock < 0)
      throw Error("Stock must be a non-negative integer");
    try {
      this.db
        .prepare(
          "UPDATE products SET name=?,slug=?,price_paise=?,compare_price_paise=?,description=?,stock=?,active=? WHERE store_id=? AND id=?",
        )
        .run(
          name,
          slug,
          price,
          comparePrice,
          description,
          stock,
          active ? 1 : 0,
          storeId,
          id,
        );
      return this.getProduct(storeId, id);
    } catch (error) {
      this.#friendlyConstraint(
        error,
        "Product slug already exists in this store",
      );
    }
  }

  listProducts(storeId) {
    this.getStore(storeId);
    return this.db
      .prepare("SELECT * FROM products WHERE store_id=? ORDER BY id DESC")
      .all(storeId)
      .map(row);
  }
  getProduct(storeId, id) {
    const value = row(
      this.db
        .prepare("SELECT * FROM products WHERE store_id=? AND id=?")
        .get(storeId, id),
    );
    if (!value) throw new Error("Product not found");
    return value;
  }

  createBundle(storeId, input) {
    const product = this.getProduct(storeId, Number(input.productId));
    const name = clean(input.name),
      quantity = Number(input.quantity),
      pricePaise = Number(input.pricePaise);
    if (!name) throw new Error("Bundle name is required");
    if (!Number.isInteger(quantity) || quantity < 2)
      throw new Error("Bundle quantity must be at least 2");
    if (!Number.isInteger(pricePaise) || pricePaise < 0)
      throw new Error("Bundle price must be a non-negative integer in paise");
    const result = this.db
      .prepare(
        "INSERT INTO product_bundles (store_id,product_id,name,quantity,price_paise) VALUES (?,?,?,?,?)",
      )
      .run(storeId, product.id, name, quantity, pricePaise);
    return this.getBundle(storeId, Number(result.lastInsertRowid));
  }

  getBundle(storeId, id) {
    const value = row(
      this.db
        .prepare("SELECT * FROM product_bundles WHERE store_id=? AND id=?")
        .get(storeId, id),
    );
    if (!value) throw new Error("Bundle not found");
    return value;
  }
  listBundles(storeId, productId = null) {
    this.getStore(storeId);
    const values =
      productId === null
        ? this.db
            .prepare(
              "SELECT * FROM product_bundles WHERE store_id=? ORDER BY id DESC",
            )
            .all(storeId)
        : this.db
            .prepare(
              "SELECT * FROM product_bundles WHERE store_id=? AND product_id=? ORDER BY id DESC",
            )
            .all(storeId, Number(productId));
    return values.map(row);
  }

  #normalizedUpsell(storeId, input, current = {}) {
    const triggerType = clean(
        input.triggerType ?? current.triggerType ?? "specific_product",
      ),
      status = clean(
        input.status ??
          current.status ??
          (input.active === false ? "disabled" : "active"),
      ).toLowerCase();
    if (!new Set(["any_product", "specific_product", "specific_collection"]).has(triggerType))
      throw new Error("Choose a valid upsell trigger");
    if (!new Set(["active", "draft", "disabled"]).has(status))
      throw new Error("Upsell status must be Active, Draft, or Disabled");
    const product = this.getProduct(
        storeId,
        Number(input.productId ?? current.productId),
      ),
      upsellProduct = this.getProduct(
        storeId,
        Number(input.upsellProductId ?? current.upsellProductId),
      ),
      quantity = Number(input.quantity ?? current.quantity ?? 1),
      pricePaise = Number(input.pricePaise ?? current.pricePaise),
      optionalPaise = (key) => {
        const value = input[key] === undefined ? current[key] : input[key];
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0)
          throw new Error("Order value rules must use non-negative paise values");
        return number;
      },
      minimumOrderPaise = optionalPaise("minimumOrderPaise"),
      maximumOrderPaise = optionalPaise("maximumOrderPaise"),
      name = clean(input.name ?? current.name ?? input.title ?? current.title),
      headline = clean(
        input.headline ?? input.title ?? current.headline ?? current.title,
      ),
      subheadline = clean(
        input.subheadline ??
          current.subheadline ??
          "Add this to your existing order",
      ),
      description = clean(input.description ?? current.description),
      acceptButtonText = clean(
        input.acceptButtonText ??
          current.acceptButtonText ??
          "Add To My Order",
      ),
      rejectButtonText = clean(
        input.rejectButtonText ??
          current.rejectButtonText ??
          "No thanks, continue",
      );
    if (!name) throw new Error("Upsell name is required");
    if (!headline) throw new Error("Upsell headline is required");
    if (!acceptButtonText || !rejectButtonText)
      throw new Error("Accept and reject button text are required");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      throw new Error("Upsell quantity must be between 1 and 100");
    if (!Number.isInteger(pricePaise) || pricePaise < 0)
      throw new Error("Upsell price must be a non-negative integer in paise");
    if (
      minimumOrderPaise !== null &&
      maximumOrderPaise !== null &&
      maximumOrderPaise < minimumOrderPaise
    )
      throw new Error("Maximum order value must be at least the minimum value");
    if (triggerType === "specific_product" && product.id === upsellProduct.id)
      throw new Error("Upsell product must differ from the trigger product");
    let triggerCollectionId =
      input.triggerCollectionId === undefined
        ? current.triggerCollectionId ?? null
        : input.triggerCollectionId
          ? Number(input.triggerCollectionId)
          : null;
    if (triggerType === "specific_collection") {
      const collection = this.db
        .prepare("SELECT id FROM collections WHERE store_id=? AND id=?")
        .get(storeId, triggerCollectionId);
      if (!collection) throw new Error("Trigger collection not found");
    } else triggerCollectionId = null;
    let triggerBundleId =
      input.triggerBundleId === undefined
        ? current.triggerBundleId ?? null
        : input.triggerBundleId
          ? Number(input.triggerBundleId)
          : null;
    if (triggerBundleId) {
      const bundle = this.getBundle(storeId, triggerBundleId);
      if (triggerType === "specific_product" && bundle.productId !== product.id)
        throw new Error("Trigger bundle must belong to the trigger product");
    }
    if (status === "active") {
      if (!upsellProduct.active) throw new Error("Upsell product is not active");
      if (upsellProduct.stock < quantity)
        throw new Error("Upsell product does not have enough inventory");
    }
    return {
      productId: product.id,
      upsellProductId: upsellProduct.id,
      title: headline,
      name,
      status,
      active: status === "active" ? 1 : 0,
      triggerType,
      triggerCollectionId,
      triggerBundleId,
      minimumOrderPaise,
      maximumOrderPaise,
      quantity,
      pricePaise,
      headline,
      subheadline,
      description,
      useProductMedia: accepted(
        input.useProductMedia ?? current.useProductMedia ?? true,
      )
        ? 1
        : 0,
      acceptButtonText,
      rejectButtonText,
      acceptAction: "thank_you",
      rejectAction: "thank_you",
      allowExistingProduct: accepted(
        input.allowExistingProduct ?? current.allowExistingProduct ?? false,
      )
        ? 1
        : 0,
    };
  }

  createUpsell(storeId, input) {
    const value = this.#normalizedUpsell(storeId, input),
      result = this.db
        .prepare(
          `INSERT INTO product_upsells
          (store_id,product_id,upsell_product_id,title,price_paise,active,name,status,trigger_type,trigger_collection_id,trigger_bundle_id,minimum_order_paise,maximum_order_paise,quantity,headline,subheadline,description,use_product_media,accept_button_text,reject_button_text,accept_action,reject_action,allow_existing_product)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          storeId,
          value.productId,
          value.upsellProductId,
          value.title,
          value.pricePaise,
          value.active,
          value.name,
          value.status,
          value.triggerType,
          value.triggerCollectionId,
          value.triggerBundleId,
          value.minimumOrderPaise,
          value.maximumOrderPaise,
          value.quantity,
          value.headline,
          value.subheadline,
          value.description,
          value.useProductMedia,
          value.acceptButtonText,
          value.rejectButtonText,
          value.acceptAction,
          value.rejectAction,
          value.allowExistingProduct,
        );
    return this.getUpsell(storeId, Number(result.lastInsertRowid));
  }
  getUpsell(storeId, id) {
    const value = row(
      this.db
        .prepare(
          `SELECT pu.*,source.name product_name,target.name upsell_product_name,
            target.stock upsell_product_stock,target.price_paise upsell_product_price_paise,
            collection.name trigger_collection_name,bundle.name trigger_bundle_name
          FROM product_upsells pu
          JOIN products source ON source.id=pu.product_id
          JOIN products target ON target.id=pu.upsell_product_id
          LEFT JOIN collections collection ON collection.id=pu.trigger_collection_id
          LEFT JOIN product_bundles bundle ON bundle.id=pu.trigger_bundle_id
          WHERE pu.store_id=? AND pu.id=?`,
        )
        .get(storeId, id),
    );
    if (!value) throw new Error("Upsell not found");
    const metrics = this.upsellAnalytics(storeId, value.id);
    return { ...value, ...metrics };
  }
  listUpsells(storeId, productId = null) {
    this.getStore(storeId);
    const sql = `SELECT pu.*,source.name product_name,target.name upsell_product_name,
      target.stock upsell_product_stock,target.price_paise upsell_product_price_paise,
      collection.name trigger_collection_name,bundle.name trigger_bundle_name
      FROM product_upsells pu
      JOIN products source ON source.id=pu.product_id
      JOIN products target ON target.id=pu.upsell_product_id
      LEFT JOIN collections collection ON collection.id=pu.trigger_collection_id
      LEFT JOIN product_bundles bundle ON bundle.id=pu.trigger_bundle_id
      WHERE pu.store_id=?${productId === null ? "" : " AND pu.product_id=?"}
      ORDER BY pu.id DESC`;
    return this.db
      .prepare(sql)
      .all(...(productId === null ? [storeId] : [storeId, Number(productId)]))
      .map(row)
      .map((value) => ({ ...value, ...this.upsellAnalytics(storeId, value.id) }));
  }
  upsellAnalytics(storeId, id = null) {
    this.getStore(storeId);
    const result = row(
        this.db
          .prepare(
            `SELECT COUNT(*) sessions,
              SUM(CASE WHEN status IN ('SHOWN','ACCEPTED','REJECTED','FAILED') THEN 1 ELSE 0 END) shown,
              SUM(CASE WHEN status='ACCEPTED' THEN 1 ELSE 0 END) accepted,
              SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) rejected,
              COALESCE(SUM(CASE WHEN status='ACCEPTED' THEN upsell_value ELSE 0 END),0) upsell_revenue,
              COALESCE(AVG(CASE WHEN status='ACCEPTED' THEN base_order_total END),0) aov_before,
              COALESCE(AVG(CASE WHEN status='ACCEPTED' THEN final_order_total END),0) aov_after
            FROM order_upsell_events WHERE store_id=?${id === null ? "" : " AND upsell_id=?"}`,
          )
          .get(...(id === null ? [storeId] : [storeId, Number(id)])),
      ) || {},
      shown = Number(result.shown || 0),
      acceptedCount = Number(result.accepted || 0);
    return {
      sessions: Number(result.sessions || 0),
      shown,
      acceptedCount,
      rejectedCount: Number(result.rejected || 0),
      takeRate: shown ? Math.round((acceptedCount / shown) * 1000) / 10 : 0,
      upsellRevenuePaise: Number(result.upsellRevenue || 0),
      aovBeforePaise: Math.round(Number(result.aovBefore || 0)),
      aovAfterPaise: Math.round(Number(result.aovAfter || 0)),
    };
  }
  updateUpsell(storeId, id, input) {
    const current = this.getUpsell(storeId, id),
      value = this.#normalizedUpsell(storeId, input, current);
    this.db
      .prepare(
        `UPDATE product_upsells SET product_id=?,upsell_product_id=?,title=?,price_paise=?,active=?,name=?,status=?,trigger_type=?,trigger_collection_id=?,trigger_bundle_id=?,minimum_order_paise=?,maximum_order_paise=?,quantity=?,headline=?,subheadline=?,description=?,use_product_media=?,accept_button_text=?,reject_button_text=?,accept_action=?,reject_action=?,allow_existing_product=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
      )
      .run(
        value.productId,
        value.upsellProductId,
        value.title,
        value.pricePaise,
        value.active,
        value.name,
        value.status,
        value.triggerType,
        value.triggerCollectionId,
        value.triggerBundleId,
        value.minimumOrderPaise,
        value.maximumOrderPaise,
        value.quantity,
        value.headline,
        value.subheadline,
        value.description,
        value.useProductMedia,
        value.acceptButtonText,
        value.rejectButtonText,
        value.acceptAction,
        value.rejectAction,
        value.allowExistingProduct,
        storeId,
        id,
      );
    return this.getUpsell(storeId, id);
  }
  duplicateUpsell(storeId, id) {
    const current = this.getUpsell(storeId, id);
    return this.createUpsell(storeId, {
      ...current,
      name: `${current.name} Copy`,
      status: "draft",
    });
  }
  deleteUpsell(storeId, id) {
    this.getUpsell(storeId, id);
    const history = this.db
      .prepare("SELECT 1 FROM order_upsell_events WHERE store_id=? AND upsell_id=? LIMIT 1")
      .get(storeId, id);
    if (history)
      throw new Error("Upsells with order history cannot be deleted; disable this offer instead");
    this.db
      .prepare("DELETE FROM product_upsells WHERE store_id=? AND id=?")
      .run(storeId, id);
    return { deleted: true, id: Number(id) };
  }

  #orderUpsellContext(storeId, orderId) {
    return row(
      this.db
        .prepare(
          `SELECT o.*,cs.product_id checkout_product_id,cs.bundle_id checkout_bundle_id,
            cs.page_id,s.slug store_slug,s.currency store_currency
          FROM orders o
          JOIN checkout_sessions cs ON cs.id=o.checkout_session_id
          JOIN stores s ON s.id=o.store_id
          WHERE o.store_id=? AND o.id=?`,
        )
        .get(storeId, orderId),
    );
  }

  #upsellMatchesOrder(storeId, upsell, order) {
    if (!upsell || upsell.status !== "active" || !upsell.active) return false;
    if (
      upsell.minimumOrderPaise !== null &&
      Number(order.totalPaise) < Number(upsell.minimumOrderPaise)
    )
      return false;
    if (
      upsell.maximumOrderPaise !== null &&
      Number(order.totalPaise) > Number(upsell.maximumOrderPaise)
    )
      return false;
    if (
      upsell.triggerBundleId &&
      Number(upsell.triggerBundleId) !== Number(order.checkoutBundleId)
    )
      return false;
    if (
      upsell.triggerType === "specific_product" &&
      Number(upsell.productId) !== Number(order.checkoutProductId)
    )
      return false;
    if (upsell.triggerType === "specific_collection") {
      const included = this.db
        .prepare(
          "SELECT 1 FROM collection_products WHERE collection_id=? AND product_id=?",
        )
        .get(upsell.triggerCollectionId, order.checkoutProductId);
      if (!included) return false;
    }
    const product = this.getProduct(storeId, upsell.upsellProductId);
    if (!product.active || product.stock < Number(upsell.quantity)) return false;
    if (!upsell.allowExistingProduct) {
      const existing = this.db
        .prepare("SELECT 1 FROM order_items WHERE order_id=? AND product_id=?")
        .get(order.id, upsell.upsellProductId);
      if (existing) return false;
    }
    return true;
  }

  #createOrderUpsell(storeId, orderId, previousToken = '') {
    const order = this.#orderUpsellContext(storeId, orderId);
    if (!order || order.fulfillmentStatus !== "unfulfilled") return null;
    const previous = this.db.prepare('SELECT upsell_id FROM order_upsell_events WHERE store_id=? AND order_id=?').all(storeId,orderId);
    const limit = new SettingsService(this.db).get(storeId).codForm.postPurchaseLimit || 1;
    if (previous.length >= limit) return null;
    const upsell = this.listUpsells(storeId).find((candidate) =>
      !previous.some(event=>event.upsell_id===candidate.id) && this.#upsellMatchesOrder(storeId, candidate, order),
    );
    if (!upsell) return null;
    // Derivation lets a retried decision recover the same next-step token without storing it in plaintext.
    const token = previousToken ? createHash('sha256').update('commera2:next-upsell:'+previousToken).digest('base64url') : randomBytes(24).toString("base64url"),
      result = this.db
        .prepare(
          `INSERT INTO order_upsell_events
          (store_id,order_id,checkout_session_id,upsell_id,status,token_hash,base_order_total,final_order_total)
          VALUES (?,?,?,?,'NOT_SHOWN',?,?,?)`,
        )
        .run(
          storeId,
          order.id,
          order.checkoutSessionId,
          upsell.id,
          upsellTokenHash(token),
          order.totalPaise,
          order.totalPaise,
        );
    return {
      id: Number(result.lastInsertRowid),
      upsellId: upsell.id,
      token,
    };
  }

  #authorizedOrderUpsell(storeSlug, sessionId, eventId, token) {
    const value = row(
      this.db
        .prepare(
          `SELECT oue.*,s.name store_name,s.slug store_slug,s.currency store_currency,
            o.order_number,o.total_paise order_total_paise,o.subtotal_paise order_subtotal_paise,
            o.fulfillment_status,o.delivery_status,o.checkout_session_id,
            cs.page_id,cs.product_id checkout_product_id,cs.bundle_id checkout_bundle_id,
            pp.slug page_slug,pp.content_json
          FROM order_upsell_events oue
          JOIN stores s ON s.id=oue.store_id
          JOIN orders o ON o.id=oue.order_id AND o.store_id=oue.store_id
          JOIN checkout_sessions cs ON cs.id=oue.checkout_session_id
          JOIN product_pages pp ON pp.id=cs.page_id
          WHERE s.slug=? AND cs.id=? AND oue.id=?`,
        )
        .get(clean(storeSlug), clean(sessionId), Number(eventId)),
    );
    if (!value || !safeTokenMatch(token, value.tokenHash))
      throw new Error("Upsell offer not found");
    return value;
  }

  #upsellOrderCanChange(event) {
    if (event.fulfillmentStatus !== "unfulfilled") return false;
    if (
      new Set(["in_transit", "out_for_delivery", "delivered", "rto", "cancelled"]).has(
        event.deliveryStatus,
      )
    )
      return false;
    return !this.db
      .prepare("SELECT 1 FROM shipments WHERE store_id=? AND order_id=?")
      .get(event.storeId, event.orderId);
  }

  getPublicOrderUpsell(storeSlug, sessionId, eventId, token, { markShown = true } = {}) {
    let event = this.#authorizedOrderUpsell(
      storeSlug,
      sessionId,
      eventId,
      token,
    );
    if (markShown && event.status === "NOT_SHOWN") {
      const changed = this.db
        .prepare(
          "UPDATE order_upsell_events SET status='SHOWN',shown_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='NOT_SHOWN'",
        )
        .run(event.id);
      if (changed.changes === 1) {
        this.db
          .prepare(
            "INSERT INTO order_events (store_id,order_id,event_type,new_status,note) VALUES (?,?,'upsell_shown','SHOWN','Post-purchase upsell shown to customer')",
          )
          .run(event.storeId, event.orderId);
        this.db
          .prepare(
            "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?,'upsell_viewed')",
          )
          .run(event.storeId, event.checkoutSessionId);
      }
      event = this.#authorizedOrderUpsell(
        storeSlug,
        sessionId,
        eventId,
        token,
      );
    }
    const upsell = this.getUpsell(event.storeId, event.upsellId),
      product = this.getProduct(event.storeId, upsell.upsellProductId),
      media = upsell.useProductMedia
        ? this.db
            .prepare(
              `SELECT file_name,mime_type,data_base64 FROM product_storefront_media
              WHERE store_id=? AND product_id=? AND media_kind='main' ORDER BY sort_order,id LIMIT 1`,
            )
            .get(event.storeId, product.id)
        : null,
      interaction = { ...event };
    delete interaction.tokenHash;
    const next = ['ACCEPTED','REJECTED'].includes(event.status)
      ? this.db.prepare('SELECT id,upsell_id FROM order_upsell_events WHERE store_id=? AND order_id=? AND id>? ORDER BY id LIMIT 1').get(event.storeId,event.orderId,event.id) : null;
    return {
      interaction,
      nextOffer: next ? {id:next.id,upsellId:next.upsell_id,token:createHash('sha256').update('commera2:next-upsell:'+token).digest('base64url')} : null,
      upsell,
      product,
      media: media?.data_base64
        ? {
            name: media.file_name,
            type: media.mime_type,
            dataUrl: `data:${media.mime_type};base64,${media.data_base64}`,
          }
        : null,
      modifiable: this.#upsellOrderCanChange(event),
    };
  }

  acceptOrderUpsell(storeSlug, sessionId, eventId, token) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const event = this.#authorizedOrderUpsell(
        storeSlug,
        sessionId,
        eventId,
        token,
      );
      if (event.status === "ACCEPTED") {
        this.db.exec("COMMIT");
        return this.getPublicOrderUpsell(storeSlug, sessionId, eventId, token, {
          markShown: false,
        });
      }
      if (!new Set(["NOT_SHOWN", "SHOWN"]).has(event.status))
        throw new Error("This upsell offer is no longer available");
      if (!this.#upsellOrderCanChange(event))
        throw new Error("This order can no longer be modified.");
      const upsell = this.getUpsell(event.storeId, event.upsellId),
        order = this.#orderUpsellContext(event.storeId, event.orderId);
      if (!this.#upsellMatchesOrder(event.storeId, upsell, order))
        throw new Error("This upsell is no longer eligible for the order");
      const product = this.getProduct(event.storeId, upsell.upsellProductId),
        quantity = Number(upsell.quantity),
        lineTotal = Number(upsell.pricePaise) * quantity,
        stock = this.db
          .prepare(
            "UPDATE products SET stock=stock-? WHERE store_id=? AND id=? AND active=1 AND stock>=?",
          )
          .run(quantity, event.storeId, product.id, quantity);
      if (stock.changes !== 1)
        throw new Error("The upsell product is out of stock");
      const location = this.db
        .prepare(
          `SELECT il.location_id FROM inventory_levels il JOIN locations l ON l.id=il.location_id
          WHERE il.store_id=? AND il.product_id=? AND l.is_default=1`,
        )
        .get(event.storeId, product.id);
      if (location) {
        const changed = this.db
          .prepare(
            "UPDATE inventory_levels SET quantity=quantity-? WHERE store_id=? AND product_id=? AND location_id=? AND quantity>=?",
          )
          .run(
            quantity,
            event.storeId,
            product.id,
            location.location_id,
            quantity,
          );
        if (changed.changes !== 1)
          throw new Error("The upsell product is out of stock at the primary location");
        this.db
          .prepare(
            "INSERT INTO inventory_movements (store_id,product_id,location_id,delta,reason,reference_type,reference_id) VALUES (?,?,?,?,'order_upsell','order',?)",
          )
          .run(
            event.storeId,
            product.id,
            location.location_id,
            -quantity,
            event.orderId,
          );
      }
      this.db
        .prepare(
          "INSERT INTO order_items (order_id,product_id,name,quantity,unit_price_paise,line_total_paise) VALUES (?,?,?,?,?,?)",
        )
        .run(
          event.orderId,
          product.id,
          product.name,
          quantity,
          upsell.pricePaise,
          lineTotal,
        );
      this.db
        .prepare(
          "UPDATE orders SET subtotal_paise=subtotal_paise+?,total_paise=total_paise+? WHERE store_id=? AND id=?",
        )
        .run(lineTotal, lineTotal, event.storeId, event.orderId);
      const finalTotal = Number(event.orderTotalPaise) + lineTotal;
      this.db
        .prepare(
          `UPDATE order_upsell_events SET status='ACCEPTED',upsell_value=?,final_order_total=?,
          shown_at=COALESCE(shown_at,CURRENT_TIMESTAMP),accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status IN ('NOT_SHOWN','SHOWN')`,
        )
        .run(lineTotal, finalTotal, event.id);
      this.db
        .prepare(
          "INSERT INTO order_events (store_id,order_id,event_type,new_status,note) VALUES (?,?,'upsell_accepted','ACCEPTED',?)",
        )
        .run(
          event.storeId,
          event.orderId,
          `${quantity} × ${product.name} added to the existing COD order`,
        );
      this.db
        .prepare(
          "INSERT INTO order_events (store_id,order_id,event_type,new_status,note) VALUES (?,?,'order_total_updated','updated',?)",
        )
        .run(
          event.storeId,
          event.orderId,
          `Order total updated after upsell acceptance`,
        );
      this.db
        .prepare(
          "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?,'upsell_accepted')",
        )
        .run(event.storeId, event.checkoutSessionId);
      this.#createOrderUpsell(event.storeId,event.orderId,token);
      this.db.exec("COMMIT");
      return this.getPublicOrderUpsell(storeSlug, sessionId, eventId, token, {
        markShown: false,
      });
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  rejectOrderUpsell(storeSlug, sessionId, eventId, token) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const event = this.#authorizedOrderUpsell(
        storeSlug,
        sessionId,
        eventId,
        token,
      );
      if (event.status === "REJECTED" || event.status === "ACCEPTED") {
        this.db.exec("COMMIT");
        return this.getPublicOrderUpsell(storeSlug, sessionId, eventId, token, {
          markShown: false,
        });
      }
      if (!new Set(["NOT_SHOWN", "SHOWN"]).has(event.status))
        throw new Error("This upsell offer is no longer available");
      this.db
        .prepare(
          `UPDATE order_upsell_events SET status='REJECTED',shown_at=COALESCE(shown_at,CURRENT_TIMESTAMP),
          rejected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        )
        .run(event.id);
      this.db
        .prepare(
          "INSERT INTO order_events (store_id,order_id,event_type,new_status,note) VALUES (?,?,'upsell_rejected','REJECTED','Customer declined the post-purchase upsell')",
        )
        .run(event.storeId, event.orderId);
      this.db
        .prepare(
          "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?,'upsell_rejected')",
        )
        .run(event.storeId, event.checkoutSessionId);
      this.#createOrderUpsell(event.storeId,event.orderId,token);
      this.db.exec("COMMIT");
      return this.getPublicOrderUpsell(storeSlug, sessionId, eventId, token, {
        markShown: false,
      });
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createDownsell(storeId, input) {
    const product = this.getProduct(storeId, Number(input.productId)),
      downsellProduct = this.getProduct(
        storeId,
        Number(input.downsellProductId),
      );
    const title = clean(input.title),
      pricePaise = Number(input.pricePaise);
    if (product.id === downsellProduct.id)
      throw new Error("Downsell product must differ from the main product");
    if (!title) throw new Error("Downsell title is required");
    if (!Number.isInteger(pricePaise) || pricePaise < 0)
      throw new Error("Downsell price must be a non-negative integer in paise");
    if (pricePaise >= product.pricePaise)
      throw new Error(
        "Downsell price must be lower than the main product price",
      );
    const result = this.db
      .prepare(
        "INSERT INTO product_downsells (store_id,product_id,downsell_product_id,title,price_paise) VALUES (?,?,?,?,?)",
      )
      .run(storeId, product.id, downsellProduct.id, title, pricePaise);
    return this.getDownsell(storeId, Number(result.lastInsertRowid));
  }
  getDownsell(storeId, id) {
    const value = row(
      this.db
        .prepare(
          "SELECT pd.*,p.name downsell_product_name,p.stock downsell_product_stock FROM product_downsells pd JOIN products p ON p.id=pd.downsell_product_id WHERE pd.store_id=? AND pd.id=?",
        )
        .get(storeId, id),
    );
    if (!value) throw new Error("Downsell not found");
    return value;
  }
  listDownsells(storeId, productId = null) {
    this.getStore(storeId);
    const sql = `SELECT pd.*,source.name product_name,target.name downsell_product_name,target.stock downsell_product_stock FROM product_downsells pd JOIN products source ON source.id=pd.product_id JOIN products target ON target.id=pd.downsell_product_id WHERE pd.store_id=?${productId === null ? "" : " AND pd.product_id=?"} ORDER BY pd.id DESC`;
    return this.db
      .prepare(sql)
      .all(...(productId === null ? [storeId] : [storeId, Number(productId)]))
      .map(row);
  }

  createCoupon(storeId, input) {
    this.getStore(storeId);
    const code = clean(input.code).toUpperCase(),
      discountType = clean(input.discountType).toLowerCase();
    const value = Number(input.value),
      minimumOrderPaise = Number(input.minimumOrderPaise ?? 0);
    const usageLimit =
      input.usageLimit === undefined ||
      input.usageLimit === null ||
      input.usageLimit === ""
        ? null
        : Number(input.usageLimit);
    const expiresAt = clean(input.expiresAt) || null;
    if (!/^[A-Z0-9_-]{3,32}$/.test(code))
      throw new Error(
        "Coupon code must use 3-32 letters, numbers, underscores or hyphens",
      );
    if (!["percent", "fixed"].includes(discountType))
      throw new Error("Discount type must be percent or fixed");
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      (discountType === "percent" && value > 100)
    )
      throw new Error("Coupon value is invalid");
    if (!Number.isInteger(minimumOrderPaise) || minimumOrderPaise < 0)
      throw new Error("Minimum order must be a non-negative integer in paise");
    if (
      usageLimit !== null &&
      (!Number.isInteger(usageLimit) || usageLimit < 1)
    )
      throw new Error("Usage limit must be at least 1");
    if (expiresAt && Number.isNaN(Date.parse(expiresAt)))
      throw new Error("Coupon expiry is invalid");
    try {
      const result = this.db
        .prepare(
          "INSERT INTO discount_coupons (store_id,code,discount_type,value,minimum_order_paise,usage_limit,expires_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          storeId,
          code,
          discountType,
          value,
          minimumOrderPaise,
          usageLimit,
          expiresAt,
        );
      return this.getCoupon(storeId, Number(result.lastInsertRowid));
    } catch (error) {
      this.#friendlyConstraint(
        error,
        "Coupon code already exists in this store",
      );
    }
  }

  getCoupon(storeId, id) {
    const value = row(
      this.db
        .prepare("SELECT * FROM discount_coupons WHERE store_id=? AND id=?")
        .get(storeId, id),
    );
    if (!value) throw new Error("Coupon not found");
    return value;
  }
  listCoupons(storeId) {
    this.getStore(storeId);
    return this.db
      .prepare(
        "SELECT * FROM discount_coupons WHERE store_id=? ORDER BY id DESC",
      )
      .all(storeId)
      .map(row);
  }

  #normalizedExitOffer(storeId, input, current = {}) {
    this.getStore(storeId);
    const value = (key, fallback) =>
        input[key] === undefined ? (current[key] ?? fallback) : input[key],
      name = normalizeSpaces(value("name", "Exit recovery offer")),
      status = clean(value("status", "draft")).toLowerCase(),
      discountType = clean(value("discountType", "percent")).toLowerCase(),
      discountValue = Number(value("discountValue", 10)),
      headline = normalizeSpaces(value("headline", "Wait — here is a special offer")),
      message = normalizeSpaces(value("message", "Complete your order now and save.")),
      buttonText = normalizeSpaces(value("buttonText", "Claim offer")),
      rejectText = normalizeSpaces(value("rejectText", "No thanks, continue")),
      inactivitySeconds = Number(value("inactivitySeconds", 30)),
      targetType = clean(value("targetType", "all_products")).toLowerCase(),
      targetProductId = value("targetProductId", null)
        ? Number(value("targetProductId", null))
        : null,
      targetPageId = value("targetPageId", null)
        ? Number(value("targetPageId", null))
        : null,
      maxShowsPerSession = Number(value("maxShowsPerSession", 1)),
      combinationRule = clean(
        value("combinationRule", "better_discount"),
      ).toLowerCase(),
      triggerExitIntent = accepted(value("triggerExitIntent", false)) ? 1 : 0,
      triggerBack = accepted(value("triggerBack", true)) ? 1 : 0,
      triggerInactivity = accepted(value("triggerInactivity", false)) ? 1 : 0,
      triggerMouseLeave = accepted(value("triggerMouseLeave", false)) ? 1 : 0,
      showProductPage = accepted(value("showProductPage", true)) ? 1 : 0,
      showCheckout = accepted(value("showCheckout", true)) ? 1 : 0;
    if (!name) throw new Error("Offer name is required");
    if (name.length > 100) throw new Error("Offer name must be 100 characters or fewer");
    if (!["active", "draft", "disabled"].includes(status))
      throw new Error("Offer status must be active, draft or disabled");
    if (!["percent", "fixed"].includes(discountType))
      throw new Error("Discount type must be percent or fixed");
    if (
      !Number.isInteger(discountValue) ||
      discountValue < 1 ||
      (discountType === "percent" && discountValue > 100)
    )
      throw new Error(
        discountType === "percent"
          ? "Percentage discount must be from 1 to 100"
          : "Fixed discount must be a positive integer in paise",
      );
    if (!headline || !buttonText || !rejectText)
      throw new Error("Headline and both button labels are required");
    if (headline.length > 140 || message.length > 300)
      throw new Error("Offer copy is too long");
    if (buttonText.length > 60 || rejectText.length > 60)
      throw new Error("Offer button labels must be 60 characters or fewer");
    if (
      !triggerExitIntent &&
      !triggerBack &&
      !triggerInactivity &&
      !triggerMouseLeave
    )
      throw new Error("Enable at least one offer trigger");
    if (
      !Number.isInteger(inactivitySeconds) ||
      inactivitySeconds < 5 ||
      inactivitySeconds > 600
    )
      throw new Error("Inactivity delay must be from 5 to 600 seconds");
    if (
      !["all_products", "specific_product", "specific_page"].includes(
        targetType,
      )
    )
      throw new Error("Offer target is invalid");
    if (!showProductPage && !showCheckout)
      throw new Error("Show the offer on the product page, checkout, or both");
    if (maxShowsPerSession !== 1)
      throw new Error("Exit offers can be shown at most once per session");
    if (
      ![
        "better_discount",
        "replace_coupon",
        "no_coupon",
        "allow_combination",
      ].includes(combinationRule)
    )
      throw new Error("Discount combination rule is invalid");
    let product = null,
      page = null;
    if (targetType === "specific_product") {
      if (!targetProductId) throw new Error("Select a product for this offer");
      product = this.getProduct(storeId, targetProductId);
    }
    if (targetType === "specific_page") {
      if (!targetPageId) throw new Error("Select a product page for this offer");
      page = this.getPage(storeId, targetPageId);
    }
    return {
      name,
      status,
      discountType,
      discountValue,
      headline,
      message,
      buttonText,
      rejectText,
      triggerExitIntent,
      triggerBack,
      triggerInactivity,
      triggerMouseLeave,
      inactivitySeconds,
      targetType,
      targetProductId: product?.id ?? null,
      targetPageId: page?.id ?? null,
      showProductPage,
      showCheckout,
      maxShowsPerSession,
      dismissalScope: "current_session",
      combinationRule,
    };
  }

  createExitOffer(storeId, input) {
    const value = this.#normalizedExitOffer(storeId, input),
      result = this.db
        .prepare(
          `INSERT INTO exit_offers
          (store_id,name,status,discount_type,discount_value,headline,message,button_text,reject_text,trigger_exit_intent,trigger_back,trigger_inactivity,trigger_mouse_leave,inactivity_seconds,target_type,target_product_id,target_page_id,show_product_page,show_checkout,max_shows_per_session,dismissal_scope,combination_rule)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          storeId,
          value.name,
          value.status,
          value.discountType,
          value.discountValue,
          value.headline,
          value.message,
          value.buttonText,
          value.rejectText,
          value.triggerExitIntent,
          value.triggerBack,
          value.triggerInactivity,
          value.triggerMouseLeave,
          value.inactivitySeconds,
          value.targetType,
          value.targetProductId,
          value.targetPageId,
          value.showProductPage,
          value.showCheckout,
          value.maxShowsPerSession,
          value.dismissalScope,
          value.combinationRule,
        );
    return this.getExitOffer(storeId, Number(result.lastInsertRowid));
  }

  getExitOffer(storeId, id) {
    const value = row(
      this.db
        .prepare(
          `SELECT eo.*,p.name target_product_name,pp.title target_page_title
           FROM exit_offers eo
           LEFT JOIN products p ON p.id=eo.target_product_id AND p.store_id=eo.store_id
           LEFT JOIN product_pages pp ON pp.id=eo.target_page_id AND pp.store_id=eo.store_id
           WHERE eo.store_id=? AND eo.id=?`,
        )
        .get(storeId, Number(id)),
    );
    if (!value) throw new Error("Exit offer not found");
    return { ...value, ...this.exitOfferAnalytics(storeId, value.id) };
  }

  listExitOffers(storeId) {
    this.getStore(storeId);
    return this.db
      .prepare(
        `SELECT eo.*,p.name target_product_name,pp.title target_page_title
         FROM exit_offers eo
         LEFT JOIN products p ON p.id=eo.target_product_id AND p.store_id=eo.store_id
         LEFT JOIN product_pages pp ON pp.id=eo.target_page_id AND pp.store_id=eo.store_id
         WHERE eo.store_id=? ORDER BY eo.id DESC`,
      )
      .all(storeId)
      .map(row)
      .map((value) => ({
        ...value,
        ...this.exitOfferAnalytics(storeId, value.id),
      }));
  }

  updateExitOffer(storeId, id, input) {
    const current = this.getExitOffer(storeId, id),
      value = this.#normalizedExitOffer(storeId, input, current);
    this.db
      .prepare(
        `UPDATE exit_offers SET name=?,status=?,discount_type=?,discount_value=?,headline=?,message=?,button_text=?,reject_text=?,trigger_exit_intent=?,trigger_back=?,trigger_inactivity=?,trigger_mouse_leave=?,inactivity_seconds=?,target_type=?,target_product_id=?,target_page_id=?,show_product_page=?,show_checkout=?,max_shows_per_session=?,dismissal_scope=?,combination_rule=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
      )
      .run(
        value.name,
        value.status,
        value.discountType,
        value.discountValue,
        value.headline,
        value.message,
        value.buttonText,
        value.rejectText,
        value.triggerExitIntent,
        value.triggerBack,
        value.triggerInactivity,
        value.triggerMouseLeave,
        value.inactivitySeconds,
        value.targetType,
        value.targetProductId,
        value.targetPageId,
        value.showProductPage,
        value.showCheckout,
        value.maxShowsPerSession,
        value.dismissalScope,
        value.combinationRule,
        storeId,
        Number(id),
      );
    return this.getExitOffer(storeId, id);
  }

  duplicateExitOffer(storeId, id) {
    const current = this.getExitOffer(storeId, id);
    return this.createExitOffer(storeId, {
      ...current,
      name: `${current.name} Copy`,
      status: "draft",
    });
  }

  deleteExitOffer(storeId, id) {
    this.getExitOffer(storeId, id);
    const history = this.db
      .prepare(
        "SELECT 1 FROM exit_offer_interactions WHERE store_id=? AND exit_offer_id=? LIMIT 1",
      )
      .get(storeId, Number(id));
    if (history)
      throw new Error(
        "Exit offers with customer history cannot be deleted; disable this offer instead",
      );
    this.db
      .prepare("DELETE FROM exit_offers WHERE store_id=? AND id=?")
      .run(storeId, Number(id));
    return { deleted: true, id: Number(id) };
  }

  exitOfferAnalytics(storeId, id = null) {
    this.getStore(storeId);
    const result =
        row(
          this.db
            .prepare(
              `SELECT COALESCE(SUM(show_count),0) shown,
                SUM(CASE WHEN status IN ('CLAIMED','CONVERTED') THEN 1 ELSE 0 END) claimed,
                SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) rejected,
                SUM(CASE WHEN status='CONVERTED' THEN 1 ELSE 0 END) converted,
                COALESCE(SUM(CASE WHEN status='CONVERTED' THEN final_total_paise ELSE 0 END),0) recovered_revenue
               FROM exit_offer_interactions WHERE store_id=?${id === null ? "" : " AND exit_offer_id=?"}`,
            )
            .get(...(id === null ? [storeId] : [storeId, Number(id)])),
        ) || {},
      shown = Number(result.shown || 0),
      claimed = Number(result.claimed || 0),
      converted = Number(result.converted || 0);
    return {
      shown,
      claimed,
      rejected: Number(result.rejected || 0),
      converted,
      claimRate: shown ? Math.round((claimed / shown) * 1000) / 10 : 0,
      conversionRate: claimed
        ? Math.round((converted / claimed) * 1000) / 10
        : 0,
      recoveredOrders: converted,
      recoveredRevenuePaise: Number(result.recoveredRevenue || 0),
    };
  }

  eligibleExitOffer(
    storeId,
    { productId, pageId, context = "product_page" } = {},
  ) {
    this.getStore(storeId);
    const cleanContext = clean(context).toLowerCase();
    if (!["product_page", "checkout"].includes(cleanContext))
      throw new Error("Exit offer context is invalid");
    const values = this.db
      .prepare(
        `SELECT * FROM exit_offers WHERE store_id=? AND status='active'
         AND ${cleanContext === "checkout" ? "show_checkout=1" : "show_product_page=1"}
         ORDER BY updated_at DESC,id DESC`,
      )
      .all(storeId)
      .map(row);
    return (
      values.find(
        (offer) =>
          offer.targetType === "all_products" ||
          (offer.targetType === "specific_product" &&
            Number(offer.targetProductId) === Number(productId)) ||
          (offer.targetType === "specific_page" &&
            Number(offer.targetPageId) === Number(pageId)),
      ) || null
    );
  }

  #exitSessionKey(value) {
    const sessionKey = clean(value);
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(sessionKey))
      throw new Error("Exit offer session is invalid");
    return sessionKey;
  }

  showExitOffer(storeId, id, input = {}) {
    const offer = this.getExitOffer(storeId, id),
      sessionKey = this.#exitSessionKey(input.sessionKey),
      context = clean(input.context || "product_page").toLowerCase(),
      checkout = input.checkoutSessionId
        ? this.getCheckout(storeId, clean(input.checkoutSessionId))
        : null,
      productId = checkout?.productId ?? Number(input.productId),
      pageId = checkout?.pageId ?? Number(input.pageId),
      eligible = this.eligibleExitOffer(storeId, {
        productId,
        pageId,
        context,
      });
    if (!eligible || eligible.id !== offer.id)
      throw new Error("Exit offer is not active or eligible for this page");
    if (checkout && checkout.status !== "draft")
      throw new Error("Checkout is no longer eligible for an exit offer");
    const existing = row(
      this.db
        .prepare(
          "SELECT * FROM exit_offer_interactions WHERE store_id=? AND exit_offer_id=? AND session_key=?",
        )
        .get(storeId, offer.id, sessionKey),
    );
    if (
      existing &&
      (existing.status !== "SHOWN" ||
        Number(existing.showCount) >= Number(offer.maxShowsPerSession))
    )
      return { eligible: false, reason: "already_handled" };
    if (existing) {
      this.db
        .prepare(
          "UPDATE exit_offer_interactions SET show_count=show_count+1,visitor_session_id=?,checkout_session_id=COALESCE(?,checkout_session_id),shown_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(
          clean(input.visitorSessionId),
          checkout?.id ?? null,
          storeId,
          existing.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO exit_offer_interactions
           (store_id,exit_offer_id,session_key,visitor_session_id,checkout_session_id,status,show_count,shown_at)
           VALUES (?,?,?,?,?,'SHOWN',1,CURRENT_TIMESTAMP)`,
        )
        .run(
          storeId,
          offer.id,
          sessionKey,
          clean(input.visitorSessionId),
          checkout?.id ?? null,
        );
    }
    this.db
      .prepare(
        "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?,'exit_offer_shown')",
      )
      .run(storeId, checkout?.id ?? sessionKey);
    return { eligible: true, offer };
  }

  rejectExitOffer(storeId, id, input = {}) {
    const sessionKey = this.#exitSessionKey(input.sessionKey),
      interaction = row(
        this.db
          .prepare(
            "SELECT * FROM exit_offer_interactions WHERE store_id=? AND exit_offer_id=? AND session_key=?",
          )
          .get(storeId, Number(id), sessionKey),
      );
    if (!interaction || interaction.status !== "SHOWN")
      return { rejected: false, reason: "not_shown" };
    this.db
      .prepare(
        "UPDATE exit_offer_interactions SET status='REJECTED',rejected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=? AND status='SHOWN'",
      )
      .run(storeId, interaction.id);
    this.db
      .prepare(
        "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?,'exit_offer_rejected')",
      )
      .run(storeId, interaction.checkoutSessionId ?? sessionKey);
    return { rejected: true };
  }

  #exitDiscount(offer, subtotalPaise) {
    const subtotal = Math.max(0, Number(subtotalPaise || 0));
    return offer.discountType === "percent"
      ? Math.floor((subtotal * Number(offer.discountValue)) / 100)
      : Math.min(Number(offer.discountValue), subtotal);
  }

  #resolvedExitPricing(
    storeId,
    offer,
    product,
    quantity,
    bundle,
    couponCode,
    downsell,
  ) {
    const couponPricing = this.#price(
        storeId,
        product,
        quantity,
        bundle,
        couponCode,
        null,
        downsell,
      ),
      exitDiscountPaise = this.#exitDiscount(
        offer,
        couponPricing.subtotalPaise,
      );
    if (offer.combinationRule === "no_coupon" && couponPricing.coupon)
      throw new Error("Remove the coupon before claiming this exit offer");
    if (offer.combinationRule === "replace_coupon")
      return { couponCode: null, exitDiscountPaise };
    if (offer.combinationRule === "allow_combination")
      return {
        couponCode: couponPricing.coupon?.code ?? null,
        exitDiscountPaise: Math.min(
          exitDiscountPaise,
          couponPricing.subtotalPaise - couponPricing.discountPaise,
        ),
      };
    if (couponPricing.discountPaise >= exitDiscountPaise)
      return {
        couponCode: couponPricing.coupon?.code ?? null,
        exitDiscountPaise: 0,
      };
    return { couponCode: null, exitDiscountPaise };
  }

  claimExitOffer(storeId, checkoutSessionId, id, input = {}) {
    const sessionKey = this.#exitSessionKey(input.sessionKey),
      checkout = this.getCheckout(storeId, clean(checkoutSessionId)),
      offer = this.getExitOffer(storeId, id),
      context = clean(input.context || "checkout").toLowerCase(),
      eligible = this.eligibleExitOffer(storeId, {
        productId: checkout.productId,
        pageId: checkout.pageId,
        context,
      }),
      interaction = row(
        this.db
          .prepare(
            "SELECT * FROM exit_offer_interactions WHERE store_id=? AND exit_offer_id=? AND session_key=?",
          )
          .get(storeId, offer.id, sessionKey),
      );
    if (checkout.status !== "draft")
      throw new Error("Checkout is no longer eligible for an exit offer");
    if (!eligible || eligible.id !== offer.id)
      throw new Error("Exit offer is not active or eligible for this checkout");
    if (!interaction || interaction.status !== "SHOWN")
      throw new Error("Show this exit offer before it can be claimed");
    const product = this.getProduct(storeId, checkout.productId),
      bundle = checkout.bundleId
        ? this.getBundle(storeId, checkout.bundleId)
        : null,
      downsell = checkout.downsellId
        ? this.getDownsell(storeId, checkout.downsellId)
        : null,
      resolved = this.#resolvedExitPricing(
        storeId,
        offer,
        product,
        checkout.quantity,
        bundle,
        checkout.couponCode,
        downsell,
      ),
      pricing = this.#price(
        storeId,
        product,
        checkout.quantity,
        bundle,
        resolved.couponCode,
        null,
        downsell,
        resolved.exitDiscountPaise,
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE checkout_sessions SET exit_offer_id=?,exit_offer_discount_paise=?,exit_offer_claimed_at=CURRENT_TIMESTAMP,coupon_code=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=? AND status='draft'",
        )
        .run(
          offer.id,
          resolved.exitDiscountPaise,
          resolved.couponCode,
          storeId,
          checkout.id,
        );
      this.db
        .prepare(
          `UPDATE exit_offer_interactions SET status='CLAIMED',checkout_session_id=?,discount_paise=?,original_total_paise=?,final_total_paise=?,claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=? AND status='SHOWN'`,
        )
        .run(
          checkout.id,
          resolved.exitDiscountPaise,
          pricing.subtotalPaise + checkout.shippingPaise,
          pricing.totalPaise + checkout.shippingPaise,
          storeId,
          interaction.id,
        );
      this.db
        .prepare(
          "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?,'exit_offer_claimed')",
        )
        .run(storeId, checkout.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      checkout: this.getCheckout(storeId, checkout.id),
      offer,
      applied: resolved.exitDiscountPaise > 0,
      message:
        resolved.exitDiscountPaise > 0
          ? "Exit offer applied"
          : "Your existing coupon already gives the better discount",
    };
  }

  createProductPage(storeId, input) {
    const product = this.getProduct(storeId, Number(input.productId));
    const title = clean(input.title),
      slug = this.#slug(input.slug),
      body = clean(input.body);
    if (!title) throw new Error("Page title is required");
    try {
      const result = this.db
        .prepare(
          "INSERT INTO product_pages (store_id,product_id,title,slug,body) VALUES (?,?,?,?,?)",
        )
        .run(storeId, product.id, title, slug, body);
      return this.getPage(storeId, Number(result.lastInsertRowid));
    } catch (error) {
      this.#friendlyConstraint(error, "Page slug already exists in this store");
    }
  }

  getPage(storeId, id) {
    const value = row(
      this.db
        .prepare(
          "SELECT * FROM product_pages WHERE store_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(storeId, id),
    );
    if (!value) throw new Error("Page not found");
    return value;
  }
  listPages(storeId) {
    this.getStore(storeId);
    return this.db
      .prepare(
        "SELECT pp.*, p.name product_name FROM product_pages pp JOIN products p ON p.id=pp.product_id WHERE pp.store_id=? AND pp.deleted_at IS NULL ORDER BY pp.id DESC",
      )
      .all(storeId)
      .map(row);
  }
  publishPage(storeId, id) {
    publishPageSnapshot(this.db, storeId, id);
    return this.getPage(storeId, id);
  }

  getPublishedPage(storeSlug, pageSlug) {
    const value = this.db
      .prepare(
        `SELECT pp.*, s.slug store_slug, s.name store_name, s.currency store_currency FROM product_pages pp JOIN stores s ON s.id=pp.store_id WHERE s.slug=? AND pp.slug=? AND pp.status='published' AND pp.deleted_at IS NULL`,
      )
      .get(storeSlug, pageSlug);
    if (!value) throw new Error("Published page not found");
    const page = row(value),
      product = this.getProduct(page.storeId, page.productId);
    const online = this.db
      .prepare(
        "SELECT sc.enabled,COALESCE(pca.available,1) available FROM sales_channels sc LEFT JOIN product_channel_availability pca ON pca.channel_id=sc.id AND pca.product_id=? WHERE sc.store_id=? AND sc.code='online_store'",
      )
      .get(product.id, page.storeId);
    if (online && (!online.enabled || !online.available))
      throw new Error("Product is not available on Online Store");
    return {
      page,
      product,
      bundles: this.listBundles(page.storeId, product.id).filter(
        (bundle) => bundle.active,
      ),
      upsells: this.listUpsells(page.storeId, product.id).filter(
        (upsell) => upsell.active && upsell.upsellProductStock > 0,
      ),
      downsells: this.listDownsells(page.storeId, product.id).filter(
        (downsell) => downsell.active && downsell.downsellProductStock > 0,
      ),
      exitOffer: this.eligibleExitOffer(page.storeId, {
        productId: product.id,
        pageId: page.id,
        context: "product_page",
      }),
    };
  }

  saveCheckoutDraft(storeId, input) {
    this.getStore(storeId);
    const customConfig = new SettingsService(this.db).get(storeId).codForm.customFields || [];
    const customValues = validateCustomCheckout(customConfig, input, input.sessionId ? customCheckoutValues(this.db,storeId,input.sessionId) : {}, input.intent === 'submit');
    const addons = checkoutAddons(this.db,storeId,input.sessionId||'',new SettingsService(this.db).get(storeId).codForm.addons||[],input,true);
    const ipAddress = clean(input.ipAddress);
    if (
      clean(input.website) &&
      input.protectionSettings?.botTraffic !== false
    ) {
      this.#recordCodRisk(storeId, "bot_honeypot", {
        ipAddress,
        details: "Checkout honeypot was completed",
      });
      throw new Error("Bot traffic detected");
    }
    if (input.sessionId) {
      const current = this.getCheckout(storeId, input.sessionId);
      if (current.status !== "draft")
        throw new Error("Checkout is no longer editable");
      if (checkoutExpired(current.updatedAt))
        throw new Error("Checkout session has expired. Please start again.");
      let bundle =
        input.bundleId === undefined
          ? current.bundleId
            ? this.getBundle(storeId, current.bundleId)
            : null
          : input.bundleId
            ? this.getBundle(storeId, Number(input.bundleId))
            : null;
      if (bundle && bundle.productId !== current.productId)
        throw new Error("Bundle and product do not match");
      if (bundle && !bundle.active) throw new Error("Bundle is not active");
      const upsell = null;
      const downsell =
        input.downsellId === undefined
          ? current.downsellId
            ? this.getDownsell(storeId, current.downsellId)
            : null
          : input.downsellId
            ? this.getDownsell(storeId, Number(input.downsellId))
            : null;
      if (downsell && downsell.productId !== current.productId)
        throw new Error("Downsell and product do not match");
      if (downsell && !downsell.active)
        throw new Error("Downsell is not active");
      if (downsell) {
        bundle = null;
      }
      const next = {
        name:
          input.name === undefined ? current.name : normalizeSpaces(input.name),
        phone: input.phone === undefined ? current.phone : clean(input.phone),
        alternatePhone:
          input.alternatePhone === undefined
            ? current.alternatePhone
            : clean(input.alternatePhone),
        email: input.email === undefined ? current.email : clean(input.email),
        address:
          input.address === undefined ? current.address : clean(input.address),
        addressLine2:
          input.addressLine2 === undefined
            ? current.addressLine2
            : clean(input.addressLine2),
        landmark:
          input.landmark === undefined
            ? current.landmark
            : clean(input.landmark),
        city: input.city === undefined ? current.city : clean(input.city),
        state: input.state === undefined ? current.state : clean(input.state),
        country:
          input.country === undefined ? current.country : clean(input.country),
        pincode:
          input.pincode === undefined ? current.pincode : clean(input.pincode),
        currentStage:
          input.currentStage === undefined
            ? current.currentStage
            : clean(input.currentStage),
        termsAccepted:
          input.termsAccepted === undefined
            ? Boolean(current.termsAccepted)
            : accepted(input.termsAccepted),
        quantity: downsell
          ? 1
          : bundle
            ? bundle.quantity
            : input.quantity === undefined
              ? current.quantity
              : Number(input.quantity),
      };
      if (!Number.isInteger(next.quantity) || next.quantity < 1)
        throw new Error("Quantity must be at least 1");
      let couponCode =
        input.couponCode === undefined
          ? current.couponCode
          : clean(input.couponCode).toUpperCase();
      const nextGiftCardCode =
        input.giftCardCode === undefined
          ? giftCardCode(current.giftCardCode)
          : giftCardCode(input.giftCardCode);
      const method = paymentMethod(
        input.paymentMethod === undefined
          ? current.paymentMethod
          : input.paymentMethod,
      );
      let exitOfferDiscountPaise = Number(
        current.exitOfferDiscountPaise || 0,
      );
      if (current.exitOfferId) {
        const resolved = this.#resolvedExitPricing(
          storeId,
          this.getExitOffer(storeId, current.exitOfferId),
          this.getProduct(storeId, current.productId),
          next.quantity,
          bundle,
          couponCode,
          downsell,
        );
        couponCode = resolved.couponCode;
        exitOfferDiscountPaise = resolved.exitDiscountPaise;
      }
      const pricing = this.#price(
          storeId,
          this.getProduct(storeId, current.productId),
          next.quantity,
          bundle,
          couponCode,
          upsell,
          downsell,
          exitOfferDiscountPaise,
        ),
        shipping = this.#shippingQuote(
          storeId,
          pricing.totalPaise + addons.reduce((sum,item)=>sum+item.pricePaise,0),
          next.state,
          input.shippingMethodId ?? current.shippingMethodId,
          next.country || 'India',
          shippingItems(current.productId,next.quantity,downsell,addons),
        );
      this.db
        .prepare(
          "UPDATE checkout_sessions SET name=?,phone=?,alternate_phone=?,email=?,address=?,address_line2=?,landmark=?,city=?,state=?,country=?,pincode=?,current_stage=?,terms_accepted=?,quantity=?,bundle_id=?,upsell_id=?,downsell_id=?,coupon_code=?,gift_card_code=?,exit_offer_discount_paise=?,payment_method=?,shipping_paise=?,shipping_method_id=?,shipping_method=?,ip_address=CASE WHEN ?='' THEN ip_address ELSE ? END,device_id=CASE WHEN ?='' THEN device_id ELSE ? END,behavior_json=CASE WHEN ?='' THEN behavior_json ELSE ? END,phone_verification_status=CASE WHEN phone<>? THEN CASE WHEN otp_required=1 THEN 'UNVERIFIED' ELSE 'NOT_REQUIRED' END ELSE phone_verification_status END,phone_verified_at=CASE WHEN phone<>? THEN NULL ELSE phone_verified_at END,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(
          next.name,
          next.phone,
          next.alternatePhone,
          next.email,
          next.address,
          next.addressLine2,
          next.landmark,
          next.city,
          next.state,
          next.country,
          next.pincode,
          next.currentStage,
          next.termsAccepted ? 1 : 0,
          next.quantity,
          bundle?.id ?? null,
          upsell?.id ?? null,
          downsell?.id ?? null,
          couponCode || null,
          nextGiftCardCode || null,
          exitOfferDiscountPaise,
          method,
          shipping.shippingPaise,
          shipping.shippingMethodId,
          shipping.shippingMethod,
          ipAddress,
          ipAddress,
          clean(input.deviceId),
          clean(input.deviceId),
          clean(input.behavior),
          clean(input.behavior),
          next.phone,
          next.phone,
          storeId,
          input.sessionId,
        );
      saveCustomCheckout(this.db,storeId,input.sessionId,customValues);
      saveCheckoutAddons(this.db,storeId,input.sessionId,addons);
      return this.getCheckout(storeId, input.sessionId);
    }
    const page = this.getPage(storeId, Number(input.pageId)),
      product = this.getProduct(storeId, Number(input.productId));
    if (page.productId !== product.id)
      throw new Error("Page and product do not match");
    let bundle = input.bundleId
      ? this.getBundle(storeId, Number(input.bundleId))
      : null;
    if (bundle && bundle.productId !== product.id)
      throw new Error("Bundle and product do not match");
    if (bundle && !bundle.active) throw new Error("Bundle is not active");
    const upsell = null;
    const downsell = input.downsellId
      ? this.getDownsell(storeId, Number(input.downsellId))
      : null;
    if (downsell && downsell.productId !== product.id)
      throw new Error("Downsell and product do not match");
    if (downsell && !downsell.active) throw new Error("Downsell is not active");
    if (downsell) {
      bundle = null;
    }
    const quantity = downsell
      ? 1
      : bundle
        ? bundle.quantity
        : Number(input.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1)
      throw new Error("Quantity must be at least 1");
    const couponCode = clean(input.couponCode).toUpperCase();
    const method = paymentMethod(input.paymentMethod);
    const cardCode = giftCardCode(input.giftCardCode);
    const pricing = this.#price(
        storeId,
        product,
        quantity,
        bundle,
        couponCode,
        upsell,
        downsell,
      ),
      shipping = this.#shippingQuote(
        storeId,
        pricing.totalPaise + addons.reduce((sum,item)=>sum+item.pricePaise,0),
        clean(input.state),
        input.shippingMethodId,
        clean(input.country) || 'India',
        shippingItems(product.id,quantity,downsell,addons),
      );
    if (ipAddress && input.protectionSettings?.botTraffic !== false) {
      const attempts = this.db
        .prepare(
          "SELECT COUNT(*) count FROM checkout_sessions WHERE store_id=? AND ip_address=? AND created_at>=datetime('now','-1 hour')",
        )
        .get(storeId, ipAddress).count;
      if (Number(attempts) >= 10) {
        this.#recordCodRisk(storeId, "bot_velocity", {
          phone: clean(input.phone),
          ipAddress,
          details: "More than 10 checkout sessions from one IP within one hour",
        });
        throw new Error("Too many checkout attempts; please try again later");
      }
    }
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO checkout_sessions (id,store_id,page_id,product_id,bundle_id,upsell_id,downsell_id,coupon_code,gift_card_code,payment_method,ip_address,quantity,name,phone,alternate_phone,email,address,address_line2,landmark,city,state,country,pincode,current_stage,shipping_paise,shipping_method_id,shipping_method,terms_accepted,phone_verification_status,otp_required,device_id,bot_risk_score,bot_risk_level,bot_action,behavior_json,checkout_token_valid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        storeId,
        page.id,
        product.id,
        bundle?.id ?? null,
        upsell?.id ?? null,
        downsell?.id ?? null,
        couponCode || null,
        cardCode || null,
        method,
        ipAddress,
        quantity,
        normalizeSpaces(input.name),
        clean(input.phone),
        clean(input.alternatePhone),
        clean(input.email),
        clean(input.address),
        clean(input.addressLine2),
        clean(input.landmark),
        clean(input.city),
        clean(input.state),
        clean(input.country),
        clean(input.pincode),
        clean(input.currentStage) || "opened",
        shipping.shippingPaise,
        shipping.shippingMethodId,
        shipping.shippingMethod,
        accepted(input.termsAccepted) ? 1 : 0,
        input.otpRequired ? "UNVERIFIED" : "NOT_REQUIRED",
        input.otpRequired ? 1 : 0,
        clean(input.deviceId),
        Number(input.botRiskScore || 0),
        clean(input.botRiskLevel) || "low",
        clean(input.botAction) || "allow",
        typeof input.behavior === "string"
          ? input.behavior
          : JSON.stringify(input.behavior || {}),
        input.checkoutTokenValid ? 1 : 0,
      );
    this.db
      .prepare(
        "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?, 'checkout_start')",
      )
      .run(storeId, id);
    saveCustomCheckout(this.db,storeId,id,customValues);
    saveCheckoutAddons(this.db,storeId,id,addons);
    return this.getCheckout(storeId, id);
  }

  applyValidatedPincode(storeId, sessionId, location) {
    const checkout = this.getCheckout(storeId, sessionId);
    if (checkout.status !== "draft")
      throw Error("Checkout was already submitted");
    if (checkout.pincode !== location.pincode)
      throw Error("Please enter a valid pincode");
    this.db
      .prepare(
        "UPDATE checkout_sessions SET city=?,state=?,country='India',pincode_validated=1,pincode_validated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
      )
      .run(clean(location.city), clean(location.state), storeId, sessionId);
    return this.getCheckout(storeId, sessionId);
  }

  getCheckout(storeId, id) {
    const value = row(
      this.db
        .prepare("SELECT * FROM checkout_sessions WHERE store_id=? AND id=?")
        .get(storeId, id),
    );
    if (!value) throw new Error("Checkout not found");
    value.customFields = customCheckoutValues(this.db,storeId,id);
    const product = this.getProduct(storeId, value.productId),
      bundle = value.bundleId ? this.getBundle(storeId, value.bundleId) : null,
      upsell = null,
      downsell = value.downsellId
        ? this.getDownsell(storeId, value.downsellId)
        : null,
      pricing = this.#price(
        storeId,
        product,
        value.quantity,
        bundle,
        value.couponCode,
        upsell,
        downsell,
        value.exitOfferDiscountPaise,
      );
    const addons = value.status === 'draft' ? checkoutAddons(this.db,storeId,id,new SettingsService(this.db).get(storeId).codForm.addons||[]) : [];
    const addonTotal = addons.reduce((sum,a)=>sum+a.pricePaise,0);
    const shipping = this.#shippingQuote(storeId,pricing.totalPaise+addonTotal,value.state,value.shippingMethodId,value.country||'India',shippingItems(value.productId,value.quantity,downsell,addons));
    const orderTotalPaise = pricing.totalPaise + addonTotal + shipping.shippingPaise,
      giftCard = this.#giftCardCredit(storeId, value.giftCardCode, orderTotalPaise);
    return {
      ...value,
      ...shipping,
      addons,
      couponCode: pricing.coupon?.code ?? null,
      couponDiscountPaise: pricing.couponDiscountPaise,
      exitOfferDiscountPaise: pricing.exitOfferDiscountPaise,
      subtotalPaise: pricing.subtotalPaise + addonTotal,
      discountPaise: pricing.discountPaise,
      shippingPaise: shipping.shippingPaise,
      giftCardAppliedPaise: giftCard.appliedPaise,
      totalPaise: orderTotalPaise - giftCard.appliedPaise,
      deliveryEstimate: shipping.deliveryEstimate,
    };
  }

  hasCompletedCheckout(storeSlug, sessionId) {
    return Boolean(this.db.prepare(
      `SELECT o.id FROM checkout_sessions cs
       JOIN stores s ON s.id=cs.store_id
       JOIN orders o ON o.checkout_session_id=cs.id AND o.store_id=cs.store_id
       WHERE s.slug=? AND cs.id=? AND cs.status='completed'`,
    ).get(clean(storeSlug), clean(sessionId)));
  }

  getPublicCheckoutDetails(storeSlug, sessionId) {
    const match = row(
      this.db
        .prepare(
          `SELECT cs.store_id,cs.page_id,cs.product_id,pp.slug page_slug,pp.title page_title,pp.content_json,pp.template_key,s.name store_name,s.slug store_slug,s.currency store_currency
           FROM checkout_sessions cs
           JOIN stores s ON s.id=cs.store_id
           JOIN product_pages pp ON pp.id=cs.page_id AND pp.store_id=cs.store_id
           WHERE s.slug=? AND cs.id=? AND cs.status='draft' AND pp.status='published' AND pp.deleted_at IS NULL`,
        )
        .get(clean(storeSlug), clean(sessionId)),
    );
    if (!match) throw new Error("Checkout not found");
    const checkout = this.getCheckout(match.storeId, clean(sessionId)),
      page = this.getPage(match.storeId, match.pageId),
      product = this.getProduct(match.storeId, match.productId);
    return {
      checkout,
      page: {
        ...page,
        storeName: match.storeName,
        storeSlug: match.storeSlug,
        storeCurrency: match.storeCurrency,
      },
      product,
      bundle: checkout.bundleId
        ? this.getBundle(match.storeId, checkout.bundleId)
        : null,
      upsells: this.listUpsells(match.storeId, product.id).filter(
        (upsell) => upsell.active && upsell.upsellProductStock > 0,
      ),
      downsells: this.listDownsells(match.storeId, product.id).filter(
        (downsell) => downsell.active && downsell.downsellProductStock > 0,
      ),
      exitOffer: this.eligibleExitOffer(match.storeId, {
        productId: product.id,
        pageId: page.id,
        context: "checkout",
      }),
    };
  }
  listAbandonedCheckouts(storeId, { timeoutMinutes = 30 } = {}) {
    const timeout = Math.max(5, Math.min(1440, Number(timeoutMinutes) || 30)),
      cutoff = new Date(Date.now() - timeout * 60_000)
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");
    return this.db
      .prepare(
        `SELECT cs.*,p.name product_name,pp.title page_name,pb.name bundle_name,
          COALESCE(pb.price_paise,p.price_paise*cs.quantity) checkout_value_paise
         FROM checkout_sessions cs
         JOIN products p ON p.id=cs.product_id AND p.store_id=cs.store_id
         JOIN product_pages pp ON pp.id=cs.page_id AND pp.store_id=cs.store_id
         LEFT JOIN product_bundles pb ON pb.id=cs.bundle_id AND pb.store_id=cs.store_id
         WHERE cs.store_id=? AND cs.status='draft' AND cs.updated_at<=?
           AND COALESCE(cs.bot_action,'allow')!='block'
         ORDER BY cs.updated_at DESC`,
      )
      .all(storeId, cutoff)
      .map(row);
  }

  placeCodOrder(storeId, { sessionId }) {
    const checkout = this.getCheckout(storeId, sessionId);
    validateCustomCheckout(new SettingsService(this.db).get(storeId).codForm.customFields || [], {}, checkout.customFields, true);
    checkout.addons = checkoutAddons(this.db,storeId,sessionId,new SettingsService(this.db).get(storeId).codForm.addons || [],undefined,true);
    if (checkout.status !== "draft")
      throw new Error("Checkout was already submitted");
    if (checkoutExpired(checkout.updatedAt))
      throw new Error("Checkout session has expired. Please start again.");
    if (checkout.shippingUnavailable) throw Error('Delivery is not available for these products and address.');
    const savedShipping=this.db.prepare('SELECT shipping_paise,shipping_method_id FROM checkout_sessions WHERE store_id=? AND id=?').get(storeId,sessionId);
    if(Number(savedShipping.shipping_paise)!==checkout.shippingPaise||savedShipping.shipping_method_id!==checkout.shippingMethodId)throw Error('Shipping rates changed. Review your checkout and submit again.');
    if (!/^[\p{L}][\p{L}\p{M} .'’\-]{1,}$/u.test(checkout.name))
      throw new Error("Enter a valid customer name of at least 2 characters");
    if (!/^[6-9][0-9]{9}$/.test(checkout.phone))
      throw new Error("Enter a valid 10-digit Indian mobile number");
    if (fakeMobile(checkout.phone))
      throw new Error(
        "Enter a real mobile number; obvious fake mobile numbers are not accepted",
      );
    if (
      checkout.alternatePhone &&
      (!/^[6-9][0-9]{9}$/.test(checkout.alternatePhone) ||
        checkout.alternatePhone === checkout.phone)
    )
      throw new Error(
        "Alternate mobile number must be valid and different from the primary number",
      );
    if (checkout.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkout.email))
      throw new Error("Enter a valid email address");
    if (!meaningfulAddress(checkout.address))
      throw new Error(
        "Please enter your delivery address.",
      );
    if (!/^[\p{L} ]{2,}$/u.test(checkout.city))
      throw new Error("Enter a valid city using letters only");
    if (!indianStates.has(checkout.state))
      throw new Error("Select a valid Indian state");
    if (!/^[1-9][0-9]{5}$/.test(checkout.pincode))
      throw new Error("Enter a valid 6-digit Indian pincode");
    if (!checkout.termsAccepted)
      throw new Error(
        "Accept the Terms and Conditions before placing the order",
      );
    const product = this.getProduct(storeId, checkout.productId);
    if (!product.active) throw new Error("Product is not active");
    const downsell = checkout.downsellId
      ? this.getDownsell(storeId, checkout.downsellId)
      : null;
    const downsellProduct = downsell
      ? this.getProduct(storeId, downsell.downsellProductId)
      : null;
    if (downsellProduct && !downsellProduct.active)
      throw new Error("Downsell product is not active");
    const orderProduct = downsellProduct || product,
      orderQuantity = downsell ? 1 : checkout.quantity;
    if (orderProduct.stock < orderQuantity)
      throw new Error(
        downsell
          ? "Insufficient stock for the downsell product"
          : "Insufficient stock for this order",
      );
    const protection = this.#codProtection(storeId);
    const addressFingerprint = identityFingerprint(checkout.address),
      nameFingerprint = identityFingerprint(checkout.name),
      blockedIdentity = this.db
        .prepare(
          `SELECT 1 FROM cod_blocklist WHERE store_id=? AND (phone=? OR (address_fingerprint<>'' AND address_fingerprint=?) OR (name_fingerprint<>'' AND address_fingerprint<>'' AND name_fingerprint=? AND address_fingerprint=?))`,
        )
        .get(
          storeId,
          checkout.phone,
          addressFingerprint,
          nameFingerprint,
          addressFingerprint,
        );
    if (protection.blackOrders && blockedIdentity) {
      this.#recordCodRisk(storeId, "blacklisted_phone", {
        sessionId,
        phone: checkout.phone,
        ipAddress: checkout.ipAddress,
        details:
          "Phone, customer, or address matches the merchant COD blocklist",
      });
      throw new Error("This customer or address is blocked for COD orders");
    }
    const duplicate = this.db
      .prepare(
        `SELECT 1 FROM orders o JOIN customers c ON c.id=o.customer_id JOIN order_items oi ON oi.order_id=o.id WHERE o.store_id=? AND (c.phone=? OR lower(trim(c.address))=lower(trim(?))) AND oi.product_id=? AND o.payment_status='pending' AND o.created_at>=datetime('now','-24 hours') LIMIT 1`,
      )
      .get(storeId, checkout.phone, checkout.address, orderProduct.id);
    if (protection.duplicateOrders && duplicate) {
      this.#recordCodRisk(storeId, "duplicate_order", {
        sessionId,
        phone: checkout.phone,
        ipAddress: checkout.ipAddress,
        details: "Matching pending COD order already exists",
      });
      throw new Error("Duplicate order detected");
    }
    const pending = this.db
      .prepare(
        "SELECT COUNT(*) count FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.store_id=? AND c.phone=? AND o.payment_status='pending'",
      )
      .get(storeId, checkout.phone).count;
    if (protection.multipleFakeOrders && Number(pending) >= 2) {
      this.#recordCodRisk(storeId, "multiple_fake_orders", {
        sessionId,
        phone: checkout.phone,
        ipAddress: checkout.ipAddress,
        details: "Phone already has two pending COD orders",
      });
      throw new Error("Multiple pending COD orders detected");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO customers (store_id,name,phone,alternate_phone,email,address,address_line2,landmark,city,state,country,pincode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(store_id,phone) DO UPDATE SET name=excluded.name,alternate_phone=excluded.alternate_phone,email=excluded.email,address=excluded.address,address_line2=excluded.address_line2,landmark=excluded.landmark,city=excluded.city,state=excluded.state,country=excluded.country,pincode=excluded.pincode,updated_at=CURRENT_TIMESTAMP`,
        )
        .run(
          storeId,
          checkout.name,
          checkout.phone,
          checkout.alternatePhone,
          checkout.email,
          checkout.address,
          checkout.addressLine2,
          checkout.landmark,
          checkout.city,
          checkout.state,
          checkout.country,
          checkout.pincode,
        );
      const customer = this.db
        .prepare("SELECT * FROM customers WHERE store_id=? AND phone=?")
        .get(storeId, checkout.phone);
      const bundle = checkout.bundleId
        ? this.getBundle(storeId, checkout.bundleId)
        : null;
      const pricing = this.#price(
        storeId,
        product,
        checkout.quantity,
        bundle,
        checkout.couponCode,
        null,
        downsell,
        checkout.exitOfferDiscountPaise,
      );
      const method = paymentMethod(checkout.paymentMethod);
      const addonTotal = checkout.addons.reduce((sum,a)=>sum+a.pricePaise,0);
      const orderTotalPaise = pricing.totalPaise + addonTotal + checkout.shippingPaise,
        giftCard = this.#giftCardCredit(storeId, checkout.giftCardCode, orderTotalPaise);
      if (giftCard.appliedPaise) {
        const debit = this.db.prepare("UPDATE gift_cards SET balance_paise=balance_paise-? WHERE id=? AND store_id=? AND status='active' AND balance_paise>=?").run(giftCard.appliedPaise, giftCard.id, storeId, giftCard.appliedPaise);
        if (debit.changes !== 1)
          throw new Error("Gift card balance changed. Please review the updated total.");
      }
      const result = this.db
        .prepare(
          `INSERT INTO orders (store_id,customer_id,checkout_session_id,bundle_id,coupon_code,gift_card_code,gift_card_applied_paise,subtotal_paise,discount_paise,shipping_paise,shipping_method_id,shipping_method,payment_method,channel,total_paise,payment_status,fulfillment_status,delivery_status,delivery_method,phone_verification_status,phone_verified_at,bot_risk_score,bot_risk_level) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'product_page',?,'pending','unfulfilled','not_shipped','cod',?,?,?,?)`,
        )
        .run(
          storeId,
          customer.id,
          sessionId,
          bundle?.id ?? null,
          pricing.coupon?.code ?? null,
          giftCard.code || null,
          giftCard.appliedPaise,
          pricing.subtotalPaise + addonTotal,
          pricing.discountPaise,
          checkout.shippingPaise,
          checkout.shippingMethodId,
          checkout.shippingMethod,
          method,
          orderTotalPaise - giftCard.appliedPaise,
          checkout.phoneVerificationStatus || "NOT_REQUIRED",
          checkout.phoneVerifiedAt || null,
          Number(checkout.botRiskScore || 0),
          checkout.botRiskLevel || "low",
        );
      const orderId = Number(result.lastInsertRowid),
        orderNumber = `#${String(orderId).padStart(6, "0")}`;
      placeCheckoutAddons(this.db,storeId,orderId,checkout.addons);
      this.db
        .prepare("UPDATE orders SET order_number=? WHERE id=?")
        .run(orderNumber, orderId);
      this.db
        .prepare(
          "INSERT INTO order_events (store_id,order_id,event_type,new_status,note) VALUES (?,?,'order_placed','unfulfilled','Customer submitted the order')",
        )
        .run(storeId, orderId);
      const mainSubtotal = downsell
        ? downsell.pricePaise
        : bundle
          ? bundle.pricePaise
          : product.pricePaise * checkout.quantity;
      const itemName = downsell
        ? downsell.downsellProductName
        : bundle
          ? `${product.name} — ${bundle.name}`
          : product.name;
      this.db
        .prepare(
          "INSERT INTO order_items (order_id,product_id,name,quantity,unit_price_paise,line_total_paise) VALUES (?,?,?,?,?,?)",
        )
        .run(
          orderId,
          orderProduct.id,
          itemName,
          orderQuantity,
          downsell
            ? downsell.pricePaise
            : bundle
              ? Math.floor(bundle.pricePaise / checkout.quantity)
              : product.pricePaise,
          mainSubtotal,
        );
      if (pricing.coupon) {
        const use = this.db
          .prepare(
            "UPDATE discount_coupons SET used_count=used_count+1 WHERE store_id=? AND id=? AND active=1 AND (usage_limit IS NULL OR used_count<usage_limit)",
          )
          .run(storeId, pricing.coupon.id);
        if (use.changes !== 1)
          throw new Error("Coupon usage limit has been reached");
      }
      const stockUpdate = this.db
        .prepare(
          "UPDATE products SET stock=stock-? WHERE store_id=? AND id=? AND stock>=?",
        )
        .run(orderQuantity, storeId, orderProduct.id, orderQuantity);
      if (stockUpdate.changes !== 1)
        throw new Error("Insufficient stock for this order");
      const trackedLocation = this.db
        .prepare(
          `SELECT il.location_id FROM inventory_levels il JOIN locations l ON l.id=il.location_id WHERE il.store_id=? AND il.product_id=? AND l.is_default=1`,
        )
        .get(storeId, orderProduct.id);
      if (trackedLocation) {
        const locationUpdate = this.db
          .prepare(
            "UPDATE inventory_levels SET quantity=quantity-? WHERE store_id=? AND product_id=? AND location_id=? AND quantity>=?",
          )
          .run(
            orderQuantity,
            storeId,
            orderProduct.id,
            trackedLocation.location_id,
            orderQuantity,
          );
        if (locationUpdate.changes !== 1)
          throw new Error("Insufficient stock at primary location");
        this.db
          .prepare(
            "INSERT INTO inventory_movements (store_id,product_id,location_id,delta,reason,reference_type,reference_id) VALUES (?,?,?,?,'order_placed','order',?)",
          )
          .run(
            storeId,
            orderProduct.id,
            trackedLocation.location_id,
            -orderQuantity,
            orderId,
          );
      }
      this.db
        .prepare(
          "UPDATE checkout_sessions SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(storeId, sessionId);
      if (checkout.exitOfferId) {
        const converted = this.db
          .prepare(
            `UPDATE exit_offer_interactions SET status='CONVERTED',order_id=?,final_total_paise=?,converted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
             WHERE store_id=? AND exit_offer_id=? AND checkout_session_id=? AND status='CLAIMED'`,
          )
          .run(
            orderId,
            orderTotalPaise - giftCard.appliedPaise,
            storeId,
            checkout.exitOfferId,
            sessionId,
          );
        if (converted.changes) {
          this.db
            .prepare(
              "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?,'exit_offer_converted')",
            )
            .run(storeId, sessionId);
        }
      }
      this.db
        .prepare(
          "INSERT INTO events (store_id,session_id,event_type) VALUES (?,?, 'purchase')",
        )
        .run(storeId, sessionId);
      const postPurchaseUpsell = this.#createOrderUpsell(storeId, orderId);
      this.db.exec("COMMIT");
      return { ...this.getOrder(storeId, orderId), postPurchaseUpsell };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getOrder(storeId, id) {
    const value = withTags(
      this.db
        .prepare("SELECT * FROM orders WHERE store_id=? AND id=?")
        .get(storeId, id),
    );
    if (!value) throw new Error("Order not found");
    return value;
  }
  getOrderDetails(storeId, id) {
    const order = withTags(
      this.db
        .prepare(
          `SELECT o.*,c.name customer_name,c.phone customer_phone,c.alternate_phone customer_alternate_phone,
            c.email customer_email,c.address customer_address,c.address_line2 customer_address_line2,
            c.landmark customer_landmark,c.city customer_city,c.state customer_state,
            c.country customer_country,c.pincode customer_pincode
          FROM orders o JOIN customers c ON c.id=o.customer_id
          WHERE o.store_id=? AND o.id=?`,
        )
        .get(storeId, id),
    );
    if (!order) throw new Error("Order not found");
    const customValues = customCheckoutValues(this.db,storeId,order.checkoutSessionId);
    const customFields = new SettingsService(this.db).get(storeId).codForm.customFields || [];
    order.customFields = Object.entries(customValues).map(([id,value])=>({id,label:customFields.find(f=>f.id===id)?.label || id,value}));
    order.items = this.db
      .prepare(
        "SELECT id,product_id,name,quantity,unit_price_paise,line_total_paise FROM order_items WHERE order_id=? ORDER BY id",
      )
      .all(order.id)
      .map(row);
    order.shipment = row(
      this.db
        .prepare(
          `SELECT sh.*,dp.name partner_name,dp.code partner_code
          FROM shipments sh JOIN delivery_partners dp ON dp.id=sh.partner_id
          WHERE sh.store_id=? AND sh.order_id=?`,
        )
        .get(storeId, order.id),
    );
    order.events = this.db
      .prepare(
        "SELECT id,event_type,old_status,new_status,note,source,created_at FROM order_events WHERE store_id=? AND order_id=? ORDER BY id DESC",
      )
      .all(storeId, order.id)
      .map(row);
    return order;
  }
  setOrderPaymentStatus(storeId, id, value) {
    const order = this.getOrder(storeId, id),
      next = clean(value).toLowerCase(),
      transitions = {
        pending: new Set(["paid"]),
        paid: new Set(["pending", "refunded"]),
      };
    if (!transitions[order.paymentStatus]?.has(next))
      throw new Error(
        `Payment cannot change from ${order.paymentStatus} to ${next || "empty"}`,
      );
    if (order.fulfillmentStatus === "cancelled")
      throw new Error("Cancelled orders cannot change payment status");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("UPDATE orders SET payment_status=?,reversal_paise=CASE WHEN ?='refunded' THEN total_paise ELSE reversal_paise END WHERE store_id=? AND id=?")
        .run(next, next, storeId, id);
      this.db
        .prepare(
          "INSERT INTO order_events (store_id,order_id,event_type,old_status,new_status,note) VALUES (?,?,'payment_status',?,?,?)",
        )
        .run(
          storeId,
          id,
          order.paymentStatus,
          next,
          next === "refunded"
            ? "Merchant confirmed the manual refund"
            : `Merchant marked payment ${next}`,
        );
      this.db.exec("COMMIT");
      return this.getOrderDetails(storeId, id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  cancelOrder(storeId, id, input = {}) {
    const order = this.getOrder(storeId, id);
    if (order.fulfillmentStatus === "cancelled")
      throw new Error("Order is already cancelled");
    if (order.fulfillmentStatus !== "unfulfilled")
      throw new Error("Only unfulfilled orders can be cancelled");
    if (
      this.db
        .prepare("SELECT 1 FROM shipments WHERE store_id=? AND order_id=?")
        .get(storeId, id)
    )
      throw new Error("Cancel the carrier shipment before cancelling this order");
    if (order.paymentStatus === "paid")
      throw new Error("Refund the payment before cancelling this order");
    const reason = clean(input.reason);
    if (reason.length > 240)
      throw new Error("Cancellation reason must be 240 characters or fewer");
    const items = this.db
      .prepare(
        "SELECT product_id,SUM(quantity) quantity FROM order_items WHERE order_id=? GROUP BY product_id",
      )
      .all(id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of items) {
        this.db
          .prepare("UPDATE products SET stock=stock+? WHERE store_id=? AND id=?")
          .run(item.quantity, storeId, item.product_id);
        const location = this.db
          .prepare(
            `SELECT il.location_id FROM inventory_levels il JOIN locations l ON l.id=il.location_id
            WHERE il.store_id=? AND il.product_id=? AND l.is_default=1`,
          )
          .get(storeId, item.product_id);
        if (location) {
          this.db
            .prepare(
              "UPDATE inventory_levels SET quantity=quantity+? WHERE store_id=? AND product_id=? AND location_id=?",
            )
            .run(item.quantity, storeId, item.product_id, location.location_id);
          this.db
            .prepare(
              "INSERT INTO inventory_movements (store_id,product_id,location_id,delta,reason,reference_type,reference_id) VALUES (?,?,?,?,'order_cancelled','order',?)",
            )
            .run(storeId, item.product_id, location.location_id, item.quantity, id);
        }
      }
      this.db
        .prepare(
          "UPDATE orders SET payment_status=CASE WHEN payment_status='refunded' THEN 'refunded' ELSE 'cancelled' END,fulfillment_status='cancelled',delivery_status='cancelled' WHERE store_id=? AND id=?",
        )
        .run(storeId, id);
      if (order.couponCode)
        this.db
          .prepare(
            "UPDATE discount_coupons SET used_count=CASE WHEN used_count>0 THEN used_count-1 ELSE 0 END WHERE store_id=? AND code=?",
          )
          .run(storeId, order.couponCode);
      this.db
        .prepare(
          "INSERT INTO order_events (store_id,order_id,event_type,old_status,new_status,note) VALUES (?,?,'order_cancelled',?,'cancelled',?)",
        )
        .run(storeId, id, order.fulfillmentStatus, reason || "Cancelled by merchant");
      this.db.exec("COMMIT");
      return this.getOrderDetails(storeId, id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  getThankYouDetails(storeSlug, sessionId) {
    const value = this.db
      .prepare(
        `SELECT o.*,c.name customer_name,c.phone customer_phone,c.email customer_email,
          c.address customer_address,c.address_line2 customer_address_line2,c.landmark customer_landmark,
          c.city customer_city,c.state customer_state,c.country customer_country,c.pincode customer_pincode,
          cs.id session_id,cs.page_id,pp.slug page_slug,pp.content_json,s.name store_name,s.slug store_slug,s.currency store_currency
      FROM orders o JOIN checkout_sessions cs ON cs.id=o.checkout_session_id JOIN customers c ON c.id=o.customer_id
      JOIN product_pages pp ON pp.id=cs.page_id JOIN stores s ON s.id=o.store_id
      WHERE s.slug=? AND cs.id=? AND cs.status='completed'`,
      )
      .get(clean(storeSlug), clean(sessionId));
    if (!value) throw new Error("Thank You Page not found");
    const details = row(value);
    details.items = this.db
      .prepare(
        "SELECT product_id,name,quantity,unit_price_paise,line_total_paise FROM order_items WHERE order_id=? ORDER BY id",
      )
      .all(details.id)
      .map(row);
    return details;
  }
  listOrders(storeId, filters = {}) {
    this.getStore(storeId);
    const where = ["o.store_id=?"], values = [storeId];
    if (filters.hideArchived !== false) where.push("o.archived=0");
    if (filters.archived === true) where.push("o.archived=1");
    for (const [key, column] of [["paymentStatus","o.payment_status"],["fulfillmentStatus","o.fulfillment_status"],["deliveryStatus","o.delivery_status"]])
      if (clean(filters[key]) && filters[key] !== "all") { where.push(`${column}=?`); values.push(clean(filters[key])); }
    const search = clean(filters.search).toLowerCase();
    if (search) { where.push("(lower(o.order_number) LIKE ? OR lower(c.name) LIKE ? OR lower(c.phone) LIKE ? OR lower(c.email) LIKE ?)"); values.push(...Array(4).fill(`%${search}%`)); }
    const sortColumns = {date:"o.created_at",orderNumber:"o.id",customer:"c.name",total:"o.total_paise"}, sort = sortColumns[filters.sortField] || sortColumns.date, direction = filters.sortDirection === "asc" ? "ASC" : "DESC";
    return this.db.prepare(
        `SELECT o.*,c.name customer_name,c.phone customer_phone,c.email customer_email,c.city customer_city,c.state customer_state,c.country customer_country,c.pincode customer_pincode,COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id=o.id),0) item_count,COALESCE((SELECT GROUP_CONCAT(quantity || '× ' || name, ', ') FROM order_items WHERE order_id=o.id),'') item_summary FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${where.join(" AND ")} ORDER BY ${sort} ${direction},o.id ${direction}`,
      ).all(...values)
      .map(withTags);
  }

  getOrderPreferences(storeId, userId = "merchant") {
    this.getStore(storeId);
    const defaults = { columnOrder:["date","customer","channel","total","paymentStatus","fulfillmentStatus","items","deliveryStatus","deliveryMethod","tags","destination","returnStatus"], visibleColumns:["date","customer","channel","total","paymentStatus","fulfillmentStatus","items","deliveryStatus","deliveryMethod","tags"], sortField:"date", sortDirection:"desc", hideArchived:true };
    const value = row(this.db.prepare("SELECT * FROM order_table_preferences WHERE user_id=? AND store_id=?").get(clean(userId)||"merchant",storeId));
    if (!value) return defaults;
    try { return {...defaults,columnOrder:JSON.parse(value.columnOrderJson),visibleColumns:JSON.parse(value.visibleColumnsJson),sortField:value.sortField,sortDirection:value.sortDirection,hideArchived:Boolean(value.hideArchived)}; } catch { return defaults; }
  }
  saveOrderPreferences(storeId, userId, input = {}) {
    const current=this.getOrderPreferences(storeId,userId), allowed=new Set(["date","customer","channel","total","paymentStatus","fulfillmentStatus","items","deliveryStatus","deliveryMethod","tags","destination","returnStatus"]), sorts=new Set(["date","orderNumber","customer","total"]);
    const order=Array.isArray(input.columnOrder)?[...new Set(input.columnOrder.filter((v)=>allowed.has(v)))]:current.columnOrder;
    for(const key of allowed) if(!order.includes(key)) order.push(key);
    const visible=Array.isArray(input.visibleColumns)?[...new Set(input.visibleColumns.filter((v)=>allowed.has(v)))]:current.visibleColumns;
    const next={columnOrder:order,visibleColumns:visible,sortField:sorts.has(input.sortField)?input.sortField:current.sortField,sortDirection:input.sortDirection==="asc"?"asc":input.sortDirection==="desc"?"desc":current.sortDirection,hideArchived:input.hideArchived===undefined?current.hideArchived:Boolean(input.hideArchived)};
    this.db.prepare(`INSERT INTO order_table_preferences (user_id,store_id,column_order_json,visible_columns_json,sort_field,sort_direction,hide_archived) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,store_id) DO UPDATE SET column_order_json=excluded.column_order_json,visible_columns_json=excluded.visible_columns_json,sort_field=excluded.sort_field,sort_direction=excluded.sort_direction,hide_archived=excluded.hide_archived,updated_at=CURRENT_TIMESTAMP`).run(clean(userId)||"merchant",storeId,JSON.stringify(next.columnOrder),JSON.stringify(next.visibleColumns),next.sortField,next.sortDirection,next.hideArchived?1:0);
    return next;
  }
  getOrderMetrics(storeId, range="today", customStart="", customEnd="") {
    this.getStore(storeId);
    const now=new Date(), day=(date)=>date.toISOString().slice(0,10); let start=day(now), end=start;
    if(range==="yesterday"){const d=new Date(now);d.setUTCDate(d.getUTCDate()-1);start=end=day(d);} else if(range==="last7"){const d=new Date(now);d.setUTCDate(d.getUTCDate()-6);start=day(d);} else if(range==="last30"){const d=new Date(now);d.setUTCDate(d.getUTCDate()-29);start=day(d);} else if(range==="custom"){if(!/^\d{4}-\d{2}-\d{2}$/.test(customStart)||!/^\d{4}-\d{2}-\d{2}$/.test(customEnd)||customStart>customEnd)throw new Error("Choose a valid custom date range");start=customStart;end=customEnd;}
    const created=this.db.prepare(`SELECT COUNT(*) orders,COALESCE(SUM(o.reversal_paise),0) reversals,COALESCE(SUM((SELECT SUM(quantity) FROM order_items WHERE order_id=o.id)),0) items FROM orders o WHERE o.store_id=? AND date(o.created_at) BETWEEN ? AND ?`).get(storeId,start,end);
    const fulfilled=this.db.prepare(`SELECT COUNT(*) count,AVG((julianday(fulfilled_at)-julianday(created_at))*86400) seconds FROM orders WHERE store_id=? AND fulfilled_at IS NOT NULL AND date(fulfilled_at) BETWEEN ? AND ?`).get(storeId,start,end);
    const delivered=this.db.prepare(`SELECT COUNT(DISTINCT o.id) count FROM orders o LEFT JOIN shipments sh ON sh.order_id=o.id WHERE o.store_id=? AND ((sh.delivered_at IS NOT NULL AND date(sh.delivered_at) BETWEEN ? AND ?) OR (sh.id IS NULL AND o.delivery_status='delivered' AND date(o.created_at) BETWEEN ? AND ?))`).get(storeId,start,end,start,end);
    return {range,start,end,orders:Number(created.orders),itemsOrdered:Number(created.items),salesReversalsPaise:Number(created.reversals),ordersFulfilled:Number(fulfilled.count),ordersDelivered:Number(delivered.count),averageFulfillmentSeconds:fulfilled.seconds==null?null:Math.round(Number(fulfilled.seconds))};
  }
  getOrdersWorkspace(storeId, userId="merchant", options={}) {
    const preferences=this.getOrderPreferences(storeId,userId), filters={...options,sortField:options.sortField||preferences.sortField,sortDirection:options.sortDirection||preferences.sortDirection,hideArchived:options.hideArchived===undefined?preferences.hideArchived:options.hideArchived};
    return {orders:this.listOrders(storeId,filters),metrics:this.getOrderMetrics(storeId,options.range,options.start,options.end),preferences,drafts:this.listDraftOrders(storeId),orderCount:Number(this.db.prepare("SELECT COUNT(*) count FROM orders WHERE store_id=?").get(storeId).count),abandonedCount:this.listAbandonedCheckouts(storeId,{timeoutMinutes:options.abandonedCheckoutTimeoutMinutes}).length};
  }
  archiveOrders(storeId, orderIds, archived=true) {
    if(!Array.isArray(orderIds)||!orderIds.length) throw new Error("Select at least one order");
    const ids=[...new Set(orderIds.map(Number))]; this.db.exec("BEGIN IMMEDIATE");
    try { for(const id of ids){this.getOrder(storeId,id);this.db.prepare("UPDATE orders SET archived=?,archived_at=? WHERE store_id=? AND id=?").run(archived?1:0,archived?new Date().toISOString():null,storeId,id);this.db.prepare("INSERT INTO order_events (store_id,order_id,event_type,new_status,note,source) VALUES (?,?,'archive_status',?,?, 'merchant')").run(storeId,id,archived?"archived":"active",archived?"Archived by merchant":"Restored by merchant");} this.db.exec("COMMIT");return ids.map((id)=>this.getOrder(storeId,id)); } catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  setOrderFulfillmentStatus(storeId,id,value){const order=this.getOrder(storeId,id), next=clean(value);if(!["unfulfilled","partially_fulfilled","fulfilled"].includes(next))throw new Error("Unsupported fulfillment status");if(order.fulfillmentStatus==="cancelled")throw new Error("Cancelled orders cannot be fulfilled");this.db.prepare("UPDATE orders SET fulfillment_status=?,fulfilled_at=CASE WHEN ?='fulfilled' THEN COALESCE(fulfilled_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE store_id=? AND id=?").run(next,next,storeId,id);this.db.prepare("INSERT INTO order_events (store_id,order_id,event_type,old_status,new_status,note,source) VALUES (?,?,'fulfillment_status',?,?,?, 'merchant')").run(storeId,id,order.fulfillmentStatus,next,`Merchant marked fulfillment ${next}`);return this.getOrderDetails(storeId,id);}
  setOrderDeliveryStatus(storeId,id,value){const order=this.getOrder(storeId,id), next=clean(value);if(!["not_shipped","ready_to_ship","in_transit","out_for_delivery","delivered","ndr","rto"].includes(next))throw new Error("Unsupported delivery status");this.db.prepare("UPDATE orders SET delivery_status=? WHERE store_id=? AND id=?").run(next,storeId,id);this.db.prepare("INSERT INTO order_events (store_id,order_id,event_type,old_status,new_status,note,source) VALUES (?,?,'delivery_status',?,?,?, 'merchant')").run(storeId,id,order.deliveryStatus,next,`Merchant marked delivery ${next}`);return this.getOrderDetails(storeId,id);}
  createDraftOrder(storeId,input={},userId="merchant") {
    this.getStore(storeId); const name=clean(input.customerName), phone=clean(input.customerPhone), items=Array.isArray(input.items)?input.items:[];
    if(!name)throw new Error("Customer name is required"); if(!/^\+?[0-9][0-9 -]{7,14}$/.test(phone))throw new Error("Enter a valid customer phone"); if(!items.length)throw new Error("Add at least one product");
    const normalized=items.map((item)=>{const product=this.getProduct(storeId,Number(item.productId)),quantity=Number(item.quantity);if(!product.active)throw new Error(`${product.name} is not active`);if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(product.pricePaise*quantity))throw new Error("Quantity must be a positive whole number within the supported range");return{product,quantity,lineTotalPaise:product.pricePaise*quantity};});
    const discount=Number(input.discountPaise??0), shipping=Number(input.shippingPaise??0);
    const subtotal=normalized.reduce((sum,item)=>sum+item.lineTotalPaise,0);
    if(!Number.isSafeInteger(discount)||discount<0||discount>subtotal)throw new Error("Discount must be a non-negative whole amount in paise, no greater than the subtotal");
    if(!Number.isSafeInteger(shipping)||shipping<0||!Number.isSafeInteger(subtotal+shipping))throw new Error("Shipping must be a non-negative whole amount in paise within the supported range");
    const result=this.db.prepare(`INSERT INTO draft_orders (store_id,customer_name,customer_phone,customer_email,customer_address,customer_city,customer_state,customer_country,customer_pincode,discount_paise,shipping_paise,shipping_method,payment_method,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(storeId,name,phone,clean(input.customerEmail),clean(input.customerAddress),clean(input.customerCity),clean(input.customerState),clean(input.customerCountry),clean(input.customerPincode),discount,shipping,clean(input.shippingMethod)||"Standard Shipping",clean(input.paymentMethod)||"cod",clean(input.note),clean(userId));
    const id=Number(result.lastInsertRowid); for(const item of normalized)this.db.prepare("INSERT INTO draft_order_items (draft_id,product_id,name,quantity,unit_price_paise,line_total_paise) VALUES (?,?,?,?,?,?)").run(id,item.product.id,item.product.name,item.quantity,item.product.pricePaise,item.lineTotalPaise); return this.getDraftOrder(storeId,id);
  }
  getDraftOrder(storeId,id){const draft=row(this.db.prepare("SELECT * FROM draft_orders WHERE store_id=? AND id=?").get(storeId,id));if(!draft)throw new Error("Draft order not found");draft.items=this.db.prepare("SELECT * FROM draft_order_items WHERE draft_id=? ORDER BY id").all(id).map(row);draft.subtotalPaise=draft.items.reduce((sum,item)=>sum+item.lineTotalPaise,0);draft.totalPaise=Math.max(0,draft.subtotalPaise-draft.discountPaise+draft.shippingPaise);return draft;}
  listDraftOrders(storeId){this.getStore(storeId);return this.db.prepare("SELECT d.*,COALESCE((SELECT SUM(quantity) FROM draft_order_items WHERE draft_id=d.id),0) item_count,COALESCE((SELECT SUM(line_total_paise) FROM draft_order_items WHERE draft_id=d.id),0)-d.discount_paise+d.shipping_paise total_paise FROM draft_orders d WHERE d.store_id=? AND d.status='draft' ORDER BY d.updated_at DESC,d.id DESC").all(storeId).map(row);}
  convertDraftOrder(storeId,id,userId="merchant") {
    const draft=this.getDraftOrder(storeId,id); if(draft.status!=="draft")throw new Error("Draft has already been converted");
    const first=draft.items[0], page=this.db.prepare("SELECT id FROM product_pages WHERE store_id=? AND product_id=? AND deleted_at IS NULL ORDER BY id LIMIT 1").get(storeId,first.productId);if(!page)throw new Error("The selected product needs a product page before this order can be created");
    for(const item of draft.items){const product=this.getProduct(storeId,item.productId);if(!product.active)throw new Error(`${product.name} is not active`);if(product.stock<item.quantity)throw new Error(`Insufficient stock for ${product.name}`);}
    const sessionId=`manual-${randomUUID()}`; this.db.exec("BEGIN IMMEDIATE");
    try{
      this.db.prepare(`INSERT INTO customers (store_id,name,phone,email,address,city,state,country,pincode) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(store_id,phone) DO UPDATE SET name=excluded.name,email=excluded.email,address=excluded.address,city=excluded.city,state=excluded.state,country=excluded.country,pincode=excluded.pincode,updated_at=CURRENT_TIMESTAMP`).run(storeId,draft.customerName,draft.customerPhone,draft.customerEmail,draft.customerAddress,draft.customerCity,draft.customerState,draft.customerCountry,draft.customerPincode);
      const customer=this.db.prepare("SELECT id FROM customers WHERE store_id=? AND phone=?").get(storeId,draft.customerPhone);
      this.db.prepare(`INSERT INTO checkout_sessions (id,store_id,page_id,product_id,quantity,name,phone,email,address,city,state,country,pincode,pincode_validated,current_stage,shipping_paise,shipping_method,payment_method,status,terms_accepted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,'manual_order',?,?,?,'completed',1)`).run(sessionId,storeId,page.id,first.productId,first.quantity,draft.customerName,draft.customerPhone,draft.customerEmail,draft.customerAddress,draft.customerCity,draft.customerState,draft.customerCountry,draft.customerPincode,draft.shippingPaise,draft.shippingMethod,draft.paymentMethod);
      const subtotal=draft.items.reduce((sum,item)=>sum+item.lineTotalPaise,0), total=Math.max(0,subtotal-draft.discountPaise+draft.shippingPaise), result=this.db.prepare(`INSERT INTO orders (store_id,customer_id,checkout_session_id,subtotal_paise,discount_paise,shipping_paise,shipping_method,payment_method,channel,total_paise,payment_status,fulfillment_status,delivery_status,delivery_method,source) VALUES (?,?,?,?,?,?,?,?, 'manual',?,'pending','unfulfilled','not_shipped',?,'manual')`).run(storeId,customer.id,sessionId,subtotal,draft.discountPaise,draft.shippingPaise,draft.shippingMethod,draft.paymentMethod,total,draft.shippingMethod);
      const orderId=Number(result.lastInsertRowid), orderNumber=`#${String(orderId).padStart(6,"0")}`;this.db.prepare("UPDATE orders SET order_number=? WHERE id=?").run(orderNumber,orderId);
      for(const item of draft.items){this.db.prepare("INSERT INTO order_items (order_id,product_id,name,quantity,unit_price_paise,line_total_paise) VALUES (?,?,?,?,?,?)").run(orderId,item.productId,item.name,item.quantity,item.unitPricePaise,item.lineTotalPaise);const update=this.db.prepare("UPDATE products SET stock=stock-? WHERE store_id=? AND id=? AND stock>=?").run(item.quantity,storeId,item.productId,item.quantity);if(update.changes!==1)throw new Error(`Insufficient stock for ${item.name}`);const location=this.db.prepare(`SELECT il.location_id FROM inventory_levels il JOIN locations l ON l.id=il.location_id WHERE il.store_id=? AND il.product_id=? AND l.is_default=1`).get(storeId,item.productId);if(location){const tracked=this.db.prepare("UPDATE inventory_levels SET quantity=quantity-? WHERE store_id=? AND product_id=? AND location_id=? AND quantity>=?").run(item.quantity,storeId,item.productId,location.location_id,item.quantity);if(tracked.changes!==1)throw new Error(`Insufficient stock at primary location for ${item.name}`);this.db.prepare("INSERT INTO inventory_movements (store_id,product_id,location_id,delta,reason,reference_type,reference_id) VALUES (?,?,?,?,'manual_order','order',?)").run(storeId,item.productId,location.location_id,-item.quantity,orderId);}}
      this.db.prepare("UPDATE draft_orders SET status='converted',converted_order_id=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?").run(orderId,storeId,id);this.db.prepare("INSERT INTO order_events (store_id,order_id,event_type,new_status,note,source) VALUES (?,?,'order_created','unfulfilled',?,'merchant')").run(storeId,orderId,`Manual order created by ${clean(userId)||"merchant"}`);this.db.prepare("INSERT INTO order_events (store_id,order_id,event_type,new_status,note,source) VALUES (?,?,'inventory_updated','reserved','Inventory deducted for order','system')").run(storeId,orderId);this.db.exec("COMMIT");return this.getOrderDetails(storeId,orderId);
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  setOrderTags(storeId, id, tags) {
    this.getOrder(storeId, id);
    const normalized = normalizeTags(tags);
    this.db
      .prepare("UPDATE orders SET tags_json=? WHERE store_id=? AND id=?")
      .run(JSON.stringify(normalized), storeId, id);
    return this.getOrder(storeId, id);
  }
  bulkSetOrderTags(storeId, orderIds, tags) {
    if (!Array.isArray(orderIds) || !orderIds.length)
      throw new Error("Select at least one order");
    const ids = [...new Set(orderIds.map(Number))];
    const normalized = normalizeTags(tags);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of ids) {
        this.getOrder(storeId, id);
        this.db
          .prepare("UPDATE orders SET tags_json=? WHERE store_id=? AND id=?")
          .run(JSON.stringify(normalized), storeId, id);
      }
      this.db.exec("COMMIT");
      return ids.map((id) => this.getOrder(storeId, id));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  listCustomers(storeId) {
    this.getStore(storeId);
    return this.db
      .prepare(
        `SELECT c.*,COUNT(o.id) order_count,COALESCE(SUM(o.total_paise),0) total_spent_paise FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE c.store_id=? GROUP BY c.id ORDER BY c.id DESC`,
      )
      .all(storeId)
      .map(row);
  }
  getCustomerDetails(storeId, customerId) {
    this.getStore(storeId);
    const customer = this.db
      .prepare("SELECT * FROM customers WHERE store_id=? AND id=?")
      .get(storeId, customerId);
    if (!customer) throw new Error("Customer not found");
    const orders = this.db
        .prepare(
          "SELECT * FROM orders WHERE store_id=? AND customer_id=? ORDER BY id DESC",
        )
        .all(storeId, customerId)
        .map(withTags),
      checkouts = this.db
        .prepare(
          `SELECT cs.id,cs.status,cs.current_stage,cs.quantity,cs.updated_at,
            p.name product_name,pp.title page_name
           FROM checkout_sessions cs
           JOIN products p ON p.id=cs.product_id
           JOIN product_pages pp ON pp.id=cs.page_id
           WHERE cs.store_id=? AND cs.phone=? ORDER BY cs.updated_at DESC LIMIT 50`,
        )
        .all(storeId, customer.phone)
        .map(row);
    return {
      ...row(customer),
      orders,
      checkouts,
      codHistory: {
        orders: orders.length,
        delivered: orders.filter((order) => order.deliveryStatus === "delivered")
          .length,
        cancelled: orders.filter(
          (order) => order.fulfillmentStatus === "cancelled",
        ).length,
        totalSpentPaise: orders.reduce(
          (total, order) => total + Number(order.totalPaise || 0),
          0,
        ),
      },
    };
  }
  blockCodPhone(storeId, input) {
    this.getStore(storeId);
    const phone = clean(input.phone),
      reason = clean(input.reason),
      addressFingerprint = identityFingerprint(input.address),
      nameFingerprint = identityFingerprint(input.name);
    if (!/^\+?[0-9]{10,13}$/.test(phone))
      throw new Error("Enter a valid phone number");
    this.db
      .prepare(
        "INSERT INTO cod_blocklist (store_id,phone,address_fingerprint,name_fingerprint,reason) VALUES (?,?,?,?,?) ON CONFLICT(store_id,phone) DO UPDATE SET address_fingerprint=excluded.address_fingerprint,name_fingerprint=excluded.name_fingerprint,reason=excluded.reason",
      )
      .run(storeId, phone, addressFingerprint, nameFingerprint, reason);
    return row(
      this.db
        .prepare("SELECT * FROM cod_blocklist WHERE store_id=? AND phone=?")
        .get(storeId, phone),
    );
  }
  listCodBlocklist(storeId) {
    this.getStore(storeId);
    return this.db
      .prepare("SELECT * FROM cod_blocklist WHERE store_id=? ORDER BY id DESC")
      .all(storeId)
      .map(row);
  }
  listCodRiskEvents(storeId) {
    this.getStore(storeId);
    return this.db
      .prepare(
        "SELECT * FROM cod_risk_events WHERE store_id=? ORDER BY id DESC",
      )
      .all(storeId)
      .map(row);
  }
  getStoreMetrics(storeId) {
    this.getStore(storeId);
    const orders = this.db
      .prepare(
        "SELECT COUNT(*) count,COALESCE(SUM(total_paise),0) sales FROM orders WHERE store_id=?",
      )
      .get(storeId);
    const checkouts = this.db
      .prepare("SELECT COUNT(*) count FROM checkout_sessions WHERE store_id=?")
      .get(storeId).count;
    return {
      totalSalesPaise: Number(orders.sales),
      orders: Number(orders.count),
      conversionRate: checkouts
        ? Math.round((Number(orders.count) * 10000) / checkouts) / 100
        : 0,
    };
  }

  #giftCardCredit(storeId, code, orderTotalPaise) {
    const normalizedCode = giftCardCode(code);
    if (!normalizedCode) return { id: null, code: null, appliedPaise: 0 };
    const card = row(
      this.db.prepare("SELECT id,code,balance_paise,status FROM gift_cards WHERE store_id=? AND code=?").get(storeId, normalizedCode),
    );
    if (!card || card.status !== "active")
      throw new Error("Gift card is invalid or inactive");
    return {
      id: card.id,
      code: card.code,
      appliedPaise: Math.min(Number(card.balancePaise), Math.max(0, Number(orderTotalPaise))),
    };
  }

  #shippingQuote(storeId, netSubtotalPaise, state, methodId = null, country = 'India', items = []) {
    return quoteShipping(this.db,storeId,netSubtotalPaise,state,methodId,country,items);
  }
  #codProtection(storeId) {
    const fallback = {
        duplicateOrders: true,
        blackOrders: true,
        multipleFakeOrders: true,
        botTraffic: true,
      },
      value = this.db
        .prepare("SELECT cod_form_json FROM store_settings WHERE store_id=?")
        .get(storeId);
    if (!value) return fallback;
    try {
      return {
        ...fallback,
        ...JSON.parse(value.cod_form_json || "{}").protection,
      };
    } catch {
      return fallback;
    }
  }
  #price(
    storeId,
    product,
    quantity,
    bundle,
    couponCode,
    upsell = null,
    downsell = null,
    exitOfferDiscountPaise = 0,
  ) {
    const subtotalPaise = downsell
      ? downsell.pricePaise
      : (bundle ? bundle.pricePaise : product.pricePaise * quantity) +
        (upsell ? upsell.pricePaise : 0);
    const code = clean(couponCode).toUpperCase();
    const exitDiscount = Math.min(
      subtotalPaise,
      Math.max(0, Number(exitOfferDiscountPaise || 0)),
    );
    if (!code)
      return {
        subtotalPaise,
        couponDiscountPaise: 0,
        exitOfferDiscountPaise: exitDiscount,
        discountPaise: exitDiscount,
        totalPaise: subtotalPaise - exitDiscount,
        coupon: null,
      };
    const coupon = row(
      this.db
        .prepare("SELECT * FROM discount_coupons WHERE store_id=? AND code=?")
        .get(storeId, code),
    );
    if (!coupon || !coupon.active)
      throw new Error("Coupon code is invalid or inactive");
    if (coupon.expiresAt && Date.parse(coupon.expiresAt) <= Date.now())
      throw new Error("Coupon code has expired");
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit)
      throw new Error("Coupon usage limit has been reached");
    if (subtotalPaise < coupon.minimumOrderPaise)
      throw new Error("Coupon minimum order has not been reached");
    const couponDiscountPaise =
      coupon.discountType === "percent"
        ? Math.floor((subtotalPaise * coupon.value) / 100)
        : Math.min(coupon.value, subtotalPaise);
    const discountPaise = Math.min(
      subtotalPaise,
      couponDiscountPaise + exitDiscount,
    );
    return {
      subtotalPaise,
      couponDiscountPaise,
      exitOfferDiscountPaise: Math.min(
        exitDiscount,
        subtotalPaise - couponDiscountPaise,
      ),
      discountPaise,
      totalPaise: subtotalPaise - discountPaise,
      coupon,
    };
  }

  #slug(value) {
    const slug = clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug) throw new Error("A valid slug is required");
    return slug;
  }
  #nextStoreSlug(name) {
    const base = this.#slug(name),
      matching = this.db
        .prepare("SELECT slug FROM stores WHERE slug=? OR slug LIKE ?")
        .all(base, `${base}-%`)
        .map((item) => item.slug);
    if (!matching.includes(base)) return base;
    let suffix = 2;
    while (matching.includes(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }
  #recordCodRisk(
    storeId,
    eventType,
    { sessionId = null, phone = "", ipAddress = "", details = "" },
  ) {
    this.db
      .prepare(
        "INSERT INTO cod_risk_events (store_id,session_id,event_type,phone,ip_address,details) VALUES (?,?,?,?,?,?)",
      )
      .run(
        storeId,
        sessionId,
        clean(eventType),
        clean(phone),
        clean(ipAddress),
        clean(details),
      );
  }
  #friendlyConstraint(error, message) {
    if (String(error.message).includes("UNIQUE constraint"))
      throw new Error(message);
    throw error;
  }
}
