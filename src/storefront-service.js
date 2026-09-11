import { coreSectionIds, normalizeSectionOrder, normalizeThemeSections, normalizeThemeSettings } from './theme-sections.js';

const clean = (value) => String(value ?? "").trim();

const row = (value) =>
  value
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
          item,
        ]),
      )
    : null;

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoTypes = new Set(["video/mp4", "video/webm"]);
const storeFonts = new Set(["Inter", "Arial", "Georgia", "Poppins"]);
const color = (value, fallback) => {
  const candidate = clean(value);
  if (!candidate) return fallback;
  if (!/^#[0-9a-f]{6}$/i.test(candidate))
    throw new Error("Store colors must use six-digit hex values");
  return candidate.toLowerCase();
};
const publicUrl = (value, { optional = true } = {}) => {
  const candidate = clean(value);
  if (!candidate && optional) return "";
  if (!/^(?:https?:\/\/|\/|#)/i.test(candidate))
    throw new Error("Store links must use HTTPS, HTTP, or a store-relative path");
  return candidate;
};
const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value || "") ?? fallback;
  } catch {
    return fallback;
  }
};
const navigationLinks = (value) => {
  if (!Array.isArray(value)) throw new Error("Header links must be a list");
  if (value.length > 8) throw new Error("The header can contain at most 8 links");
  return value.map((item) => {
    const label = clean(item?.label);
    if (!label) throw new Error("Every header link needs a label");
    if (label.length > 40) throw new Error("Header link labels must be 40 characters or fewer");
    return { label, url: publicUrl(item?.url, { optional: false }) };
  });
};
export const safeThemeCss = (value) => {
  const css = String(value ?? "").trim();
  if (Buffer.byteLength(css) > 100_000) throw Error("Theme CSS must be 100 KB or smaller");
  if (/<\/?style\b|@import\b|(?:url|image-set)\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:/i.test(css))
    throw Error("Theme CSS cannot load external files or contain script-like rules");
  return css;
};

const toBase64 = (value) =>
  String(value ?? "")
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s/g, "");

const normalizeDataUrl = (value) => {
  const source = clean(value);
  if (!source) return null;
  const payload = toBase64(source);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))
    throw new Error("Invalid image payload");
  return payload;
};

const clampSize = (bytes, maxBytes, label) => {
  if (!bytes || bytes > maxBytes)
    throw new Error(
      `${label} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller`,
    );
};

const safeRichHtml = (input) => {
  let html = String(input ?? "").trim();
  if (Buffer.byteLength(html) > 3_000_000)
    throw new Error("Product Description is too large");

  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|iframe|object|embed|form|meta|link|base|svg|math|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<(script|style|iframe|object|embed|form|meta|link|base|svg|math|video|audio)\b[^>]*\/?>/gi,
      "",
    );

  const allowed = new Set([
    "p",
    "br",
    "strong",
    "em",
    "u",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "a",
    "img",
  ]);
  return html
    .replace(/<\/?[a-z][^>]*>/gi, (tag) => {
      const isClosing = /^<\//.test(tag);
      const name = tag.match(/^<\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
      if (!name || !allowed.has(name)) return "";
      if (isClosing) return name === "img" || name === "br" ? "" : `</${name}>`;
      if (name === "br") return "<br>";
      if (name === "a") {
        const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || "";
        return /^(https?:|mailto:)/i.test(href)
          ? `<a href="${href.replace(/["<>]/g, "")}" rel="noopener">`
          : "<a>";
      }
      if (name === "img") {
        const src = tag.match(/src\s*=\s*["']([^"']+)["']/i)?.[1] || "";
        const alt = tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] || "";
        if (
          !/^(https:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(src)
        )
          return "";
        return `<img src="${src.replace(/["<>]/g, "")}" alt="${alt.replace(/["<>]/g, "")}">`;
      }
      return `<${name}>`;
    })
    .trim();
};

export class StorefrontService {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS storefront_publications (
      store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
      snapshot_json TEXT NOT NULL
    )`);
  }

  #preservePublished(storeId) {
    if (this.#settings(storeId).status !== 'published') return;
    const model=this.get(storeId);
    delete model.products;
    this.db.prepare('INSERT INTO storefront_publications(store_id,snapshot_json) VALUES(?,?) ON CONFLICT(store_id) DO NOTHING').run(storeId,JSON.stringify(model));
  }

  publicationStatus(storeId) {
    const settings=this.#settings(storeId);
    const hasSnapshot=Boolean(this.db.prepare('SELECT store_id FROM storefront_publications WHERE store_id=?').get(storeId));
    return { live:hasSnapshot || settings.status==='published', hasUnpublishedChanges:hasSnapshot && settings.status!=='published' };
  }

  getPublic(storeId) {
    const saved=this.db.prepare('SELECT snapshot_json FROM storefront_publications WHERE store_id=?').get(storeId);
    if (!saved) return this.get(storeId);
    const model=JSON.parse(saved.snapshot_json);
    // Freeze design only. Product prices, availability and media remain live.
    model.store={...this.#store(storeId),name:model.store.name};
    model.products=this.listProducts(storeId).map(item=>this.getProduct(storeId,item.id));
    model.home.featuredProducts=model.home.featuredProducts.flatMap(item=>{
      const product=model.products.find(product=>product.id===item.id);
      if (!product) return [];
      const rating=this.db.prepare("SELECT AVG(rating) average,COUNT(*) count FROM reviews WHERE store_id=? AND product_id=? AND status='approved'").get(storeId,product.id);
      return [{...item,...product,productPageStatus:product.status==='published' ? product.pageStatus : 'draft',mainImage:product.media.main,ratingAverage:rating.average||0,ratingCount:rating.count}];
    });
    if (model.home.buttonTarget?.type==='page') {
      const page=this.db.prepare('SELECT slug FROM product_pages WHERE store_id=? AND id=? AND deleted_at IS NULL').get(storeId,model.home.buttonTarget.id);
      if(page)model.home.buttonTargetUrl=`/s/${encodeURIComponent(model.store.slug)}/${encodeURIComponent(page.slug)}`;
    }
    if (model.home.buttonTarget?.type==='product') {
      const product=model.products.find(item=>item.id===model.home.buttonTarget.id);
      if(product)model.home.buttonTargetUrl=`/s/${encodeURIComponent(model.store.slug)}/products/${encodeURIComponent(product.slug)}`;
    }
    return model;
  }

  #store(storeId) {
    const value = this.db
      .prepare("SELECT id,name,slug,currency FROM stores WHERE id=?")
      .get(storeId);
    if (!value) throw Error("Store not found");
    return row(value);
  }

  #storeBySlug(slug) {
    const value = this.db
      .prepare("SELECT id,name,slug,currency FROM stores WHERE slug=?")
      .get(clean(slug));
    if (!value) throw Error("Storefront not found");
    return row(value);
  }

  #product(storeId, productId) {
    const value = this.db
      .prepare("SELECT * FROM products WHERE store_id=? AND id=?")
      .get(storeId, Number(productId));
    if (!value) throw Error("Product must belong to the current store");
    return row(value);
  }

  #settings(storeId) {
    this.#store(storeId);
    this.db
      .prepare(
        "INSERT INTO storefront_settings(store_id) VALUES(?) ON CONFLICT(store_id) DO NOTHING",
      )
      .run(storeId);
    return this.db
      .prepare("SELECT * FROM storefront_settings WHERE store_id=?")
      .get(storeId);
  }

  #asset(input, kind) {
    if (input === null) return null;
    if (input === undefined) return undefined;
    if (typeof input !== "object") throw Error(`${kind} upload is invalid`);

    const type = clean(input.type).toLowerCase();
    const payload = toBase64(input.data);
    const name = clean(input.name) || kind;
    const isGif = kind === "Product GIF",
      isVideo = kind === "Product Video",
      allowed = isGif
        ? new Set(["image/gif"])
        : isVideo
          ? videoTypes
          : imageTypes;

    if (!allowed.has(type))
      throw Error(
        `${kind} must be ${isGif ? "a GIF" : isVideo ? "MP4 or WebM" : "JPEG, PNG, or WebP"}`,
      );
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))
      throw Error(`${kind} data is invalid`);

    const bytes = Buffer.from(payload, "base64").length;
    clampSize(
      bytes,
      isVideo ? 4 * 1024 * 1024 : isGif ? 5 * 1024 * 1024 : 2 * 1024 * 1024,
      kind,
    );
    return { name: name.slice(0, 160), type, data: payload };
  }

  #assetOutput(name, type, data) {
    return data ? { name, type, dataUrl: `data:${type};base64,${data}` } : null;
  }

  #mediaRows(storeId, productId) {
    const rows = this.db
      .prepare(
        `SELECT * FROM product_storefront_media WHERE store_id=? AND product_id=? ORDER BY
         CASE media_kind WHEN 'main' THEN 1 WHEN 'additional' THEN 2 ELSE 3 END,sort_order,id`,
      )
      .all(storeId, productId)
      .map((item) => ({
        id: item.id,
        mediaKind: item.media_kind,
        fileName: item.file_name,
        mimeType: item.mime_type,
        dataBase64: item.data_base64,
        sortOrder: item.sort_order,
      }));

    const convert = (item) =>
      item
        ? {
            id: item.id,
            name: item.fileName,
            type: item.mimeType,
            dataUrl: `data:${item.mimeType};base64,${item.dataBase64}`,
            sortOrder: item.sortOrder,
          }
        : null;

    return {
      main: convert(rows.find((item) => item.mediaKind === "main")),
      additional: rows
        .filter(
          (item) =>
            item.mediaKind === "additional" &&
            !item.mimeType.startsWith("video/"),
        )
        .map(convert),
      gif: convert(rows.find((item) => item.mediaKind === "gif")),
      videos: rows
        .filter(
          (item) =>
            item.mediaKind === "additional" &&
            item.mimeType.startsWith("video/"),
        )
        .map(convert),
    };
  }

  get(storeId) {
    const settings = row(this.#settings(storeId));
    const customSections = normalizeThemeSections(parseJson(settings.homeSectionsJson, []));
    const themeSettings = normalizeThemeSettings(parseJson(settings.themeSettingsJson, {}));
    let sectionOrder;
    try { sectionOrder = normalizeSectionOrder(parseJson(settings.homeSectionOrderJson, coreSectionIds), customSections); }
    catch { sectionOrder = [...coreSectionIds, ...customSections.map(section => section.id)]; }
    const featured = this.db
      .prepare(
        `
        SELECT
          p.id,p.name,p.slug,p.price_paise,p.stock,p.active,
          sf.sort_order,
          CASE WHEN ps.status='published' AND pp.status='published' AND pp.deleted_at IS NULL
            THEN 'published' ELSE 'draft' END AS product_page_status,
          COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.store_id=p.store_id AND r.product_id=p.id AND r.status='approved'),0) rating_average,
          (SELECT COUNT(*) FROM reviews r WHERE r.store_id=p.store_id AND r.product_id=p.id AND r.status='approved') rating_count,
          (SELECT file_name FROM product_storefront_media m WHERE m.store_id=p.store_id AND m.product_id=p.id AND media_kind='main' ORDER BY sort_order,id LIMIT 1) main_file_name,
          (SELECT mime_type FROM product_storefront_media m WHERE m.store_id=p.store_id AND m.product_id=p.id AND media_kind='main' ORDER BY sort_order,id LIMIT 1) main_mime,
          (SELECT data_base64 FROM product_storefront_media m WHERE m.store_id=p.store_id AND m.product_id=p.id AND media_kind='main' ORDER BY sort_order,id LIMIT 1) main_data
        FROM storefront_featured_products sf
        JOIN products p ON p.id=sf.product_id AND p.store_id=sf.store_id
        LEFT JOIN product_storefronts ps ON ps.product_id=p.id AND ps.store_id=p.store_id
        LEFT JOIN product_pages pp ON pp.id=ps.page_id AND pp.store_id=p.store_id
        WHERE sf.store_id=?
        ORDER BY sf.sort_order,p.id
      `,
      )
      .all(storeId)
      .map((raw) => {
        const item = row(raw);
        const linked = this.getProduct(storeId, item.id);
        item.productPageStatus = linked.status === "published" && linked.pageStatus === "published" && item.active !== 0 ? "published" : "draft";
        item.mainImage = item.mainData
          ? {
              name: item.mainFileName || "product-image",
              type: item.mainMime,
              dataUrl: `data:${item.mainMime};base64,${item.mainData}`,
            }
          : null;
        return item;
      });

    const buttonTarget = settings.buttonTargetType
      ? { type: settings.buttonTargetType, id: settings.buttonTargetId }
      : null;
    let buttonTargetUrl = "";
    if (buttonTarget?.type === "product") {
      const product = this.db
        .prepare("SELECT slug FROM products WHERE store_id=? AND id=?")
        .get(storeId, buttonTarget.id);
      if (product?.slug)
        buttonTargetUrl = `/s/${encodeURIComponent(this.#store(storeId).slug)}/products/${encodeURIComponent(product.slug)}`;
    }
    if (buttonTarget?.type === "page") {
      const page = this.db
        .prepare("SELECT slug FROM product_pages WHERE store_id=? AND id=?")
        .get(storeId, buttonTarget.id);
      if (page?.slug)
        buttonTargetUrl = `/s/${encodeURIComponent(this.#store(storeId).slug)}/${encodeURIComponent(page.slug)}`;
    }
    if (buttonTarget?.type === "url")
      buttonTargetUrl = publicUrl(settings.buttonTargetUrl);

    const logo = {
        ...this.#assetOutput(
          settings.logoName,
          settings.logoMime,
          settings.logoBase64,
        ),
        alt: settings.logoAlt,
      },
      favicon = this.#assetOutput(
        settings.faviconName,
        settings.faviconMime,
        settings.faviconBase64,
      ),
      branding = {
        ...logo,
        favicon,
        primaryColor: settings.primaryColor,
        secondaryColor: settings.secondaryColor,
        headingFont: settings.headingFont,
        bodyFont: settings.bodyFont,
      };

    return {
      store: this.#store(storeId),
      logo,
      favicon,
      branding,
      home: {
        banner: this.#assetOutput(
          settings.bannerName,
          settings.bannerMime,
          settings.bannerBase64,
        ),
        heading: settings.bannerHeading,
        subheading: settings.bannerSubheading,
        buttonText: settings.buttonText,
        buttonTarget,
        buttonTargetUrl,
        announcement: {
          enabled: Boolean(settings.announcementEnabled),
          message: settings.announcementMessage,
          linkText: settings.announcementLinkText,
          linkUrl: settings.announcementLinkUrl,
          backgroundColor: settings.announcementBackground,
          textColor: settings.announcementTextColor,
        },
        header: {
          sticky: Boolean(settings.headerSticky),
          links: parseJson(settings.headerLinksJson, []),
        },
        footer: {
          contact: settings.footerContact,
          showProducts: Boolean(settings.footerShowProducts),
        },
        bannerVisible: Boolean(settings.bannerVisible),
        featuredVisible: Boolean(settings.featuredVisible),
        sectionOrder,
        customSections,
        themeSettings,
        customCss: settings.customCss || "",
        sectionHeading: settings.sectionHeading,
        status: settings.status,
        featuredProducts: featured,
        updatedAt: settings.updatedAt,
        publishedAt: settings.publishedAt,
      },
      products: this.listProducts(storeId).map((product) =>
        this.getProduct(storeId, product.id),
      ),
    };
  }

  saveBranding(storeId, input = {}) {
    const current = row(this.#settings(storeId));
    let image = current.logoBase64
      ? this.#assetOutput(
          current.logoName,
          current.logoMime,
          current.logoBase64,
        )
      : null;

    if (input.removeLogo) image = null;
    else if (input.logo !== undefined)
      image =
        input.logo === null ? null : this.#asset(input.logo, "Store Logo");

    let favicon = current.faviconBase64
      ? this.#assetOutput(
          current.faviconName,
          current.faviconMime,
          current.faviconBase64,
        )
      : null;
    if (input.removeFavicon) favicon = null;
    else if (input.favicon !== undefined)
      favicon =
        input.favicon === null
          ? null
          : this.#asset(input.favicon, "Store Favicon");

    const alt = clean(input.logoAlt ?? current.logoAlt),
      storeName = clean(input.storeName ?? this.#store(storeId).name),
      primaryColor = color(
        input.primaryColor ?? current.primaryColor,
        "#0f5132",
      ),
      secondaryColor = color(
        input.secondaryColor ?? current.secondaryColor,
        "#f4efe5",
      ),
      headingFont = clean(input.headingFont ?? current.headingFont) || "Inter",
      bodyFont = clean(input.bodyFont ?? current.bodyFont) || "Inter";
    if (!storeName) throw Error("Store Name is required");
    if (storeName.length > 100)
      throw Error("Store Name must be 100 characters or fewer");
    if (!storeFonts.has(headingFont) || !storeFonts.has(bodyFont))
      throw Error("Choose a supported store font");
    if (alt.length > 240)
      throw Error("Logo Alt Text must be 240 characters or fewer");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.#preservePublished(storeId);
      this.db
        .prepare("UPDATE stores SET name=? WHERE id=?")
        .run(storeName, storeId);
      this.db
        .prepare(
          `
          UPDATE storefront_settings
          SET
            logo_name=?, logo_mime=?, logo_base64=?, logo_alt=?,
            favicon_name=?, favicon_mime=?, favicon_base64=?,
            primary_color=?, secondary_color=?, heading_font=?, body_font=?,
            status='draft',
            updated_at=CURRENT_TIMESTAMP
          WHERE store_id=?
        `,
        )
        .run(
          image?.name || "",
          image?.type || "",
          image
            ? toBase64(image.data || image.dataUrl || "")
            : "",
          alt,
          favicon?.name || "",
          favicon?.type || "",
          favicon
            ? String(favicon.data || favicon.dataUrl || "").replace(
                /^data:[^;]+;base64,/,
                "",
              )
            : "",
          primaryColor,
          secondaryColor,
          headingFont,
          bodyFont,
          storeId,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return this.get(storeId);
  }

  getProduct(storeId, productId) {
    const product = this.#product(storeId, productId);
    let value = this.db
      .prepare(
        `
        SELECT ps.*,pp.slug page_slug,pp.status page_status
        FROM product_storefronts ps
        JOIN product_pages pp
          ON pp.id=ps.page_id AND pp.store_id=ps.store_id
        WHERE ps.store_id=? AND ps.product_id=? AND pp.deleted_at IS NULL
      `,
      )
      .get(storeId, product.id);

    // A directly published Product Page is usable without a second storefront setup.
    // Never replace an explicit connection, including one deliberately left as a draft.
    if (!value && !this.db.prepare('SELECT product_id FROM product_storefronts WHERE store_id=? AND product_id=?').get(storeId, product.id)) {
      const page = this.db.prepare(`SELECT id,slug,published_at FROM product_pages
        WHERE store_id=? AND product_id=? AND status='published' AND deleted_at IS NULL
        ORDER BY published_at DESC,id DESC LIMIT 1`).get(storeId, product.id);
      if (page) value = { status: 'published', page_id: page.id, page_slug: page.slug,
        page_status: 'published', published_at: page.published_at, description_html: product.description || '' };
    }

    return {
      ...product,
      status: value?.status || "not_configured",
      description: value?.description_html || "",
      buttonText: value?.button_text || "Buy Now",
      buttonAction: value?.button_action || "checkout",
      pageId: value?.pageId || value?.page_id || null,
      pageSlug: value?.pageSlug || value?.page_slug || null,
      pageStatus: value?.pageStatus || value?.page_status || null,
      media: this.#mediaRows(storeId, product.id),
      updatedAt: value?.updated_at || null,
      publishedAt: value?.published_at || null,
    };
  }

  listProducts(storeId) {
    this.#store(storeId);
    return this.db
      .prepare(
        `
      SELECT p.id,p.name,p.slug,p.price_paise,p.stock,COALESCE(ps.status,'not_configured') storefront_status
      FROM products p
      LEFT JOIN product_storefronts ps
        ON ps.product_id=p.id AND ps.store_id=p.store_id
      WHERE p.store_id=?
      ORDER BY p.id DESC
    `,
      )
      .all(storeId)
      .map(row);
  }

  connectPage(storeId, productId, pageId) {
    const product = this.#product(storeId, productId);
    const page = this.db.prepare("SELECT id FROM product_pages WHERE store_id=? AND product_id=? AND id=? AND status='published' AND deleted_at IS NULL")
      .get(storeId, product.id, Number(pageId));
    if (!page) throw Error('Connected checkout page must be published and belong to this product and store');
    const current = this.getProduct(storeId, productId);
    this.db.prepare(`INSERT INTO product_storefronts (product_id,store_id,page_id,description_html,button_text,button_action,status,published_at)
      VALUES (?,?,?,?,?,?,'published',CURRENT_TIMESTAMP) ON CONFLICT(product_id) DO UPDATE SET
      page_id=excluded.page_id,status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .run(product.id, storeId, page.id, current.description || product.description || '', current.buttonText, current.buttonAction);
    return this.getProduct(storeId, productId);
  }

  saveProductMedia(storeId, productId, input = {}) {
    const product = this.#product(storeId, productId);
    if (input.clear) {
      this.db
        .prepare(
          "DELETE FROM product_storefront_media WHERE store_id=? AND product_id=?",
        )
        .run(storeId, product.id);
      return this.getProduct(storeId, product.id);
    }
    const main = input.mainImage
        ? this.#asset(input.mainImage, "Main Product Image")
        : null,
      additional = Array.isArray(input.additionalImages)
        ? input.additionalImages.map((item) =>
            this.#asset(item, "Additional Product Image"),
          )
        : [],
      gif = input.productGif
        ? this.#asset(input.productGif, "Product GIF")
        : null,
      videos = Array.isArray(input.productVideos)
        ? input.productVideos.map((item) => this.#asset(item, "Product Video"))
        : [];
    if (additional.length > 6)
      throw Error("A product can have at most 6 additional images");
    if (videos.length > 2) throw Error("A product can have at most 2 videos");
    if (!main && !additional.length && !gif && !videos.length)
      throw Error("Choose at least one product media file");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "DELETE FROM product_storefront_media WHERE store_id=? AND product_id=?",
        )
        .run(storeId, product.id);
      const insert = this.db.prepare(
          "INSERT INTO product_storefront_media(store_id,product_id,media_kind,file_name,mime_type,data_base64,sort_order) VALUES (?,?,?,?,?,?,?)",
        ),
        write = (kind, item, index = 0) => {
          if (!item) return;
          insert.run(
            storeId,
            product.id,
            kind,
            item.name,
            item.type,
            item.data,
            index,
          );
        };
      write("main", main);
      additional.forEach((item, index) => write("additional", item, index));
      videos.forEach((item, index) =>
        write("additional", item, additional.length + index),
      );
      write("gif", gif);
      this.db.exec("COMMIT");
      return this.getProduct(storeId, product.id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveProduct(storeId, productId, input, pageId) {
    const product = this.#product(storeId, productId);
    const current = this.getProduct(storeId, product.id);

    const selectedPage = this.db
      .prepare(
        "SELECT id,status FROM product_pages WHERE store_id=? AND id=? AND product_id=? AND deleted_at IS NULL",
      )
      .get(storeId, Number(pageId), product.id);
    if (!selectedPage)
      throw Error(
        "Connected checkout page must belong to this product and store",
      );
    if (selectedPage.status !== "published")
      throw Error("Connected checkout page must be published");

    const description = safeRichHtml(input.description ?? current.description);
    const buttonText = clean(input.buttonText ?? current.buttonText);
    const buttonAction =
      clean(input.buttonAction ?? current.buttonAction) || "checkout";
    const publish = Boolean(input.publish);

    if (!description.replace(/<[^>]+>/g, "").trim())
      throw Error("Product Description is required");
    if (!buttonText) throw Error("Checkout Button Text is required");
    if (buttonAction !== "checkout")
      throw Error("Checkout is the only supported Button Action");

    const hasMain = input.mainImage !== undefined;
    const hasAdditional = input.additionalImages !== undefined;
    const hasGif = input.productGif !== undefined;

    const main =
      input.mainImage === undefined
        ? undefined
        : input.mainImage === null
          ? null
          : this.#asset(input.mainImage, "Main Product Image");

    const additional =
      input.additionalImages === undefined
        ? undefined
        : Array.isArray(input.additionalImages)
          ? input.additionalImages
              .filter(Boolean)
              .map((item) => this.#asset(item, "Additional Product Image"))
          : [];

    if (additional && additional.length > 6)
      throw Error("A product can have at most 6 additional images");

    const gif =
      input.productGif === undefined
        ? undefined
        : input.productGif === null
          ? null
          : this.#asset(input.productGif, "Product GIF");

    if (publish && !hasMain && !current.media.main)
      throw Error("Main Product Image is required before publishing");
    if (publish && hasMain && !main)
      throw Error("Main Product Image is required before publishing");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO product_storefronts
             (product_id,store_id,page_id,description_html,button_text,button_action,status,published_at)
           VALUES (?,?,?,?,?,?,?,CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE NULL END)
           ON CONFLICT(product_id)
           DO UPDATE SET
             page_id=excluded.page_id,
             description_html=excluded.description_html,
             button_text=excluded.button_text,
             button_action=excluded.button_action,
             status=excluded.status,
             published_at=excluded.published_at,
             updated_at=CURRENT_TIMESTAMP`,
        )
        .run(
          product.id,
          storeId,
          selectedPage.id,
          description,
          buttonText,
          buttonAction,
          publish ? "published" : "draft",
          publish ? "published" : "draft",
        );

      if (hasMain || hasAdditional || hasGif) {
        this.db
          .prepare(
            "DELETE FROM product_storefront_media WHERE store_id=? AND product_id=?",
          )
          .run(storeId, product.id);
        const insert = this.db.prepare(
          "INSERT INTO product_storefront_media(store_id,product_id,media_kind,file_name,mime_type,data_base64,sort_order) VALUES (?,?,?,?,?,?,?)",
        );

        const write = (kind, item, index = 0) => {
          if (!item) return;
          const payload =
            item.dataUrl || item.data ? item.data : normalizeDataUrl(item);
          if (!payload) throw Error("Invalid media payload");
          insert.run(
            storeId,
            product.id,
            kind,
            item.name || "image",
            item.type,
            payload,
            index,
          );
        };

        if (main !== null) {
          write("main", main, 0);
        }

        if (additional !== undefined) {
          additional.forEach((item, index) => write("additional", item, index));
        }

        if (gif !== undefined) {
          write("gif", gif, 0);
        }
      }

      this.db.exec("COMMIT");
      return this.getProduct(storeId, product.id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveHome(storeId, input = {}) {
    const settings = this.#settings(storeId);
    const current = row(settings);
    const currentSections=normalizeThemeSections(parseJson(current.homeSectionsJson, []));
    const customSections=input.customSections===undefined?currentSections:normalizeThemeSections(input.customSections,currentSections,(image,label,previous)=>{
      if(image===null)return null;
      if(image?.dataUrl){
        if(!previous||image.dataUrl!==previous.dataUrl||image.name!==previous.name||image.type!==previous.type)throw Error(`${label} upload is invalid`);
        return previous;
      }
      const saved=this.#asset(image,label);
      return {name:saved.name,type:saved.type,dataUrl:`data:${saved.type};base64,${saved.data}`};
    });
    const themeSettings=normalizeThemeSettings(input.themeSettings??parseJson(current.themeSettingsJson,{}));
    const banner =
      input.bannerImage === undefined
        ? settings.banner_base64
          ? {
              name: settings.banner_name,
              type: settings.banner_mime,
              data: settings.banner_base64,
            }
          : null
        : input.bannerImage === null
          ? null
          : this.#asset(input.bannerImage, "Banner Image");

    const featuredIds = [
      ...new Set(
        (input.featuredProductIds ?? this.get(storeId).home.featuredProducts.map(item => item.id))
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];
    featuredIds.forEach((id) => {
      this.#product(storeId, id);
    });

    const target =
      input.buttonTarget === undefined
        ? current.buttonTargetType
          ? {
              type: current.buttonTargetType,
              id: current.buttonTargetId,
              url: current.buttonTargetUrl,
            }
          : null
        : input.buttonTarget || null;
    if (target) {
      if (!["product", "page", "url"].includes(clean(target.type)))
        throw Error("Banner Button Link must select a product, page, or URL");
      const targetId = Number(target.id);
      if (
        clean(target.type) !== "url" &&
        target.id && (!Number.isInteger(targetId) || targetId <= 0)
      )
        throw Error("Banner Button Link must be valid");
      if (clean(target.type) === "product" && targetId) {
        this.#product(storeId, targetId);
      } else if (clean(target.type) === "page" && targetId) {
        const page = this.db
          .prepare(
            "SELECT id FROM product_pages WHERE store_id=? AND id=? AND deleted_at IS NULL",
          )
          .get(storeId, targetId);
        if (!page)
          throw Error(
            "Banner Button Link page must belong to this store",
          );
      }
      if (clean(target.type) === "url")
        target.url = publicUrl(target.url);
    }

    const announcementEnabled = Boolean(
        input.announcementEnabled ?? current.announcementEnabled,
      ),
      announcementMessage = clean(
        input.announcementMessage ?? current.announcementMessage,
      ),
      announcementLinkText = clean(
        input.announcementLinkText ?? current.announcementLinkText,
      ),
      announcementLinkUrl = publicUrl(
        input.announcementLinkUrl ?? current.announcementLinkUrl,
      ),
      announcementBackground = color(
        input.announcementBackground ?? current.announcementBackground,
        "#0f5132",
      ),
      announcementTextColor = color(
        input.announcementTextColor ?? current.announcementTextColor,
        "#ffffff",
      ),
      headerLinks = navigationLinks(
        input.headerLinks ?? parseJson(current.headerLinksJson, []),
      ),
      headerSticky = Boolean(input.headerSticky ?? current.headerSticky),
      footerContact = clean(input.footerContact ?? current.footerContact),
      footerShowProducts = Boolean(
        input.footerShowProducts ?? current.footerShowProducts,
      ),
      bannerVisible = Boolean(input.bannerVisible ?? current.bannerVisible),
      featuredVisible = Boolean(input.featuredVisible ?? current.featuredVisible),
      sectionOrder = (()=>{
        if(input.sectionOrder!==undefined)return normalizeSectionOrder(input.sectionOrder,customSections);
        const expected=[...coreSectionIds,...customSections.map(section=>section.id)];
        const saved=parseJson(current.homeSectionOrderJson,coreSectionIds);
        const reconciled=[...saved.filter(id=>expected.includes(id)),...expected.filter(id=>!saved.includes(id))];
        return normalizeSectionOrder(reconciled,customSections);
      })(),
      customCss = safeThemeCss(input.customCss ?? current.customCss);
    if (footerContact.length > 500)
      throw Error("Footer contact information must be 500 characters or fewer");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.#preservePublished(storeId);
      this.db
        .prepare(
          `
        UPDATE storefront_settings
        SET
          banner_name=?,
          banner_mime=?,
          banner_base64=?,
          banner_heading=?,
          banner_subheading=?,
          button_text=?,
          button_target_type=?,
          button_target_id=?,
          button_target_url=?,
          announcement_enabled=?, announcement_message=?,
          announcement_link_text=?, announcement_link_url=?,
          announcement_background=?, announcement_text_color=?,
          header_links_json=?, header_sticky=?,
          footer_contact=?, footer_show_products=?,
          banner_visible=?, featured_visible=?, home_section_order_json=?, custom_css=?, home_sections_json=?, theme_settings_json=?,
          section_heading=?,
          status='draft',
          published_at=NULL,
          updated_at=CURRENT_TIMESTAMP
        WHERE store_id=?
      `,
        )
        .run(
          banner?.name || "",
          banner?.type || "",
          banner?.data
            ? banner.data
            : banner?.dataUrl
              ? toBase64(banner.dataUrl)
              : banner?.name
                ? ""
                : "",
          clean(input.bannerHeading ?? current.bannerHeading),
          clean(input.bannerSubheading ?? current.bannerSubheading),
          clean(input.buttonText ?? current.buttonText),
          target?.type ? String(target.type) : "",
          target?.type !== "url" && target?.id ? Number(target.id) : null,
          target?.type === "url" ? target.url : "",
          announcementEnabled ? 1 : 0,
          announcementMessage,
          announcementLinkText,
          announcementLinkUrl,
          announcementBackground,
          announcementTextColor,
          JSON.stringify(headerLinks),
          headerSticky ? 1 : 0,
          footerContact,
          footerShowProducts ? 1 : 0,
          bannerVisible ? 1 : 0,
          featuredVisible ? 1 : 0,
          JSON.stringify(sectionOrder),
          customCss,
          JSON.stringify(customSections),
          JSON.stringify(themeSettings),
          clean(input.sectionHeading ?? current.sectionHeading),
          storeId,
        );

      this.db
        .prepare("DELETE FROM storefront_featured_products WHERE store_id=?")
        .run(storeId);
      const insert = this.db.prepare(
        "INSERT INTO storefront_featured_products(store_id,product_id,sort_order) VALUES (?,?,?)",
      );
      featuredIds.forEach((id, index) => insert.run(storeId, id, index));
      this.db.exec("COMMIT");
      return this.get(storeId).home;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  publishHome(storeId) {
    const model = this.get(storeId);
    if (!model.logo?.dataUrl)
      throw Error("Store Logo is required before publishing");
    const customById=new Map(model.home.customSections.map(section=>[section.id,section]));
    const visibleSections = model.home.sectionOrder.filter((section) => section === "banner" ? model.home.bannerVisible : section === "featured" ? model.home.featuredVisible : customById.get(section)?.visible);
    if (!visibleSections.length)
      throw Error("Show at least one homepage section before publishing. Your draft is saved.");
    if (model.home.bannerVisible && !model.home.banner?.dataUrl)
      throw Error("Banner Image is required before publishing");
    if (model.home.featuredVisible && !model.home.featuredProducts.length)
      throw Error("Select at least one product for the homepage");
    const unavailable = model.home.featuredVisible ? model.home.featuredProducts.filter(item => item.productPageStatus !== "published") : [];
    if (unavailable.length)
      throw Error(`Cannot publish store: ${unavailable.map(item => item.name).join(', ')} must be active and connected to a published Product Page. Your draft is saved.`);
    const settings = row(this.#settings(storeId));
    if (settings.announcementEnabled && !settings.announcementMessage)
      throw Error("Announcement Message is required when enabled. Your draft is saved.");
    if (settings.announcementLinkText && !settings.announcementLinkUrl)
      throw Error("Announcement Link is required when link text is set. Your draft is saved.");
    if (model.home.bannerVisible && settings.buttonText) {
      if (settings.buttonTargetType === 'product') {
        const product = settings.buttonTargetId && this.getProduct(storeId, settings.buttonTargetId);
        if (!product || product.status !== 'published' || product.pageStatus !== 'published' || product.active === 0)
          throw Error('Banner Button Link needs an active product with a published page. Your draft is saved.');
      } else if (settings.buttonTargetType === 'page') {
        const page = this.db.prepare("SELECT pp.id FROM product_pages pp JOIN products p ON p.id=pp.product_id AND p.store_id=pp.store_id WHERE pp.store_id=? AND pp.id=? AND pp.status='published' AND pp.deleted_at IS NULL AND p.active=1").get(storeId, settings.buttonTargetId);
        if (!page) throw Error('Banner Button Link needs a published page in this store. Your draft is saved.');
      } else if (settings.buttonTargetType !== 'url' || !settings.buttonTargetUrl) {
        throw Error('Choose a Banner Button Link before publishing. Your draft is saved.');
      }
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE storefront_settings SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=?").run(storeId);
      const published=this.get(storeId);
      delete published.products;
      this.db.prepare('INSERT INTO storefront_publications(store_id,snapshot_json) VALUES(?,?) ON CONFLICT(store_id) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(storeId,JSON.stringify(published));
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK');throw error; }

    return this.get(storeId).home;
  }

  publicHome(storeSlug) {
    const store = this.#storeBySlug(storeSlug);
    const model = this.getPublic(store.id);
    if (model.home.status !== "published") throw Error("Storefront not found");
    return model;
  }

  publicProduct(storeSlug, productSlug) {
    const store = this.#storeBySlug(storeSlug);
    const product = this.db
      .prepare("SELECT id FROM products WHERE store_id=? AND slug=?")
      .get(store.id, clean(productSlug));
    if (!product) throw Error("Published product storefront not found");
    const model = this.getProduct(store.id, product.id);
    if (model.status !== "published")
      throw Error("Published product storefront not found");
    return { storefront: this.getPublic(store.id), ...model, product };
  }
}
