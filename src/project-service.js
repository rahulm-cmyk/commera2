import { pageTemplates, templateContent } from "./page-templates.js";
import sanitizeHtml from "sanitize-html";
import { confirmationAnimation } from "./confirmation.js";
import { editablePage, publishPageSnapshot } from "./page-publication.js";
import { normalizeBlocks } from '../public/page-blocks.js';

const socialProofType = (value) =>
  String(value || "real").toLowerCase() === "fake" ? "fake" : "real";

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
const checkoutAction = (value) => {
  const action = clean(value).toLowerCase() || "direct";
  if (!["direct", "redirect"].includes(action))
    throw Error("Checkout action must be Direct Checkout or Redirect");
  return action;
};
const toBoolean = (value, defaultValue = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return defaultValue;
    return ["1", "true", "on", "yes"].includes(normalized);
  }
  return defaultValue;
};
const urgencyOptions = new Set([
  "none",
  "limited-stock",
  "limited-time",
  "high-demand",
]);
const normalizeUrgencyType = (value) =>
  urgencyOptions.has(String(value || "none").toLowerCase())
    ? String(value || "none").toLowerCase()
    : "none";
const urgencyFromInput = (input, current = {}) => {
  const type = normalizeUrgencyType(input.urgencyType ?? current.type);
  const defaults = {
    "limited-stock": "Limited stock available",
    "limited-time": "Limited-time offer",
    "high-demand": "High demand — selling fast",
  };
  return {
    enabled: type !== "none",
    type,
    text:
      clean(input.urgencyText ?? current.text ?? defaults[type] ?? "") ||
      defaults[type] ||
      "",
  };
};
const connectedSections = () => [
  {
    id: "header",
    type: "header",
    label: "Header",
    visible: true,
    connected: true,
  },
  {
    id: "announcement-bar",
    type: "announcement-bar",
    label: "Announcement Bar",
    visible: false,
    connected: false,
  },
  {
    id: "product-media",
    type: "product-media",
    label: "Product Media",
    visible: true,
    connected: true,
  },
  {
    id: "product-information",
    type: "product-information",
    label: "Product Title & Price",
    visible: true,
    connected: true,
  },
  {
    id: "description",
    type: "description",
    label: "Product Description",
    visible: true,
    connected: true,
  },
  {
    id: "bundle",
    type: "bundle",
    label: "Product Options / Bundles",
    visible: true,
    connected: true,
  },
  {
    id: "checkout-button",
    type: "checkout-button",
    label: "Checkout Button",
    visible: true,
    connected: true,
  },
  {
    id: "urgency",
    type: "urgency",
    label: "Urgency",
    visible: false,
    connected: false,
  },
  {
    id: "reviews",
    type: "reviews",
    label: "Reviews",
    visible: true,
    connected: true,
  },
  {
    id: "policies-footer",
    type: "policies-footer",
    label: "Footer / Policies",
    visible: true,
    connected: true,
  },
];
const universalSectionLabels = Object.fromEntries(
  connectedSections().map(({ id, label }) => [id, label]),
);
const withEditorConfig = (content, method) => {
  const editorSections = (
    Array.isArray(content.editorSections)
      ? content.editorSections
      : method === "blank"
        ? []
        : connectedSections()
  )
    .filter(
      (section) =>
        !["social-proof", "proof", "testimonials", "rating"].includes(
          section.type || section.id,
        ),
    )
    .map((section) => ({
      ...section,
      label: universalSectionLabels[section.id] || section.label,
    }));
  for (const section of editorSections) {
    if (section.id === "urgency")
      section.visible = Boolean(content.urgency?.enabled);
    if (section.id === "announcement-bar")
      section.visible = Boolean(content.announcement);
  }
  return {
    ...content,
    editorSections,
    mediaSettings: {
      mainImage: true,
      imageGallery: true,
      gif: true,
      video: true,
      ...(content.mediaSettings || {}),
    },
    reviewSettings: {
      showReviews: true,
      showRating: true,
      showImages: true,
      limit: 6,
      ...(content.reviewSettings || {}),
    },
    // Old pages may contain the previously advertised `cart` action. No cart
    // exists, so load those pages as the truthful Direct Checkout behavior.
    checkoutAction: ["direct", "redirect"].includes(
      clean(content.checkoutAction).toLowerCase(),
    )
      ? clean(content.checkoutAction).toLowerCase()
      : "direct",
    redirectUrl: clean(content.redirectUrl),
  };
};

export function sanitizeImportedHtml(input) {
  const html = String(input ?? "");
  if (!html.trim()) throw Error("Uploaded page HTML is empty");
  if (Buffer.byteLength(html) > 500_000)
    throw Error("Uploaded page exceeds the 500 KB limit");
  return sanitizeHtml(html, {
    allowedTags: [
      "main", "section", "article", "header", "footer", "nav", "aside",
      "div", "span", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5",
      "h6", "strong", "b", "em", "i", "u", "s", "small", "blockquote",
      "pre", "code", "ul", "ol", "li", "dl", "dt", "dd", "figure",
      "figcaption", "picture", "img", "video", "audio", "source", "a",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "button",
    ],
    allowedAttributes: {
      "*": ["class", "id", "title", "style", "role", "aria-*", "data-*"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height", "loading"],
      video: ["src", "poster", "controls", "muted", "loop", "autoplay", "playsinline"],
      audio: ["src", "controls", "muted", "loop", "autoplay"],
      source: ["src", "srcset", "type", "media"],
      button: ["type", "disabled"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      video: ["http", "https", "data"],
      audio: ["http", "https", "data"],
      source: ["http", "https", "data"],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => ({
        tagName,
        attribs: {
          ...attributes,
          ...(attributes.target === "_blank" ? { rel: "noopener noreferrer" } : {}),
        },
      }),
    },
  }).trim();
}

function safeImportedStyles(input) {
  const css = String(input || "").trim();
  if (!css || Buffer.byteLength(css) > 200_000) return "";
  // Imported CSS is visual-only: remove network fetches and obsolete script-like
  // CSS features while retaining the layout, colors, animations, and responsive rules.
  const safe = css
    .replace(/@import\s+(?:url\()?[^;]+;?/gi, "")
    .replace(/(?:url|image-set)\s*\([^)]*\)/gi, "none")
    .replace(/(?:expression|behavior|-moz-binding)\s*:[^;}]+;?/gi, "")
    .replace(/<\/?style\b[^>]*>/gi, "");
  return safe.trim() ? `<style>${safe}</style>` : "";
}

export const importedPageStaticStyle = `<style data-commera-import-static>
.reveal,.reveal-scale,[data-aos],.wow{opacity:1!important;visibility:visible!important;transform:none!important}
</style>`;

export function staticImportedPageHtml(input) {
  const html = String(input || "").trim();
  if (!html || html.includes("data-commera-import-static")) return html;
  return `${html}\n${importedPageStaticStyle}`;
}

function importedPageWarnings(input) {
  const html = String(input || "");
  const warnings = [];
  if (
    /(?:src|srcset|poster)\s*=\s*["']\s*(?:file:\/{2,3}|[a-z]:[\\/]|\.{1,2}[\\/])/i.test(
      html,
    )
  )
    warnings.push(
      "This page references image or media files from a local computer. Those files cannot be published from the HTML alone; replace them with HTTPS or embedded data URLs.",
    );
  return warnings;
}

function prepareImportedPageHtml(input) {
  const html = String(input || "");
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map((match) => safeImportedStyles(match[1]))
    .filter(Boolean)
    .join("\n");
  const body = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "");
  return staticImportedPageHtml(`${styles}${sanitizeImportedHtml(body)}`);
}

export function processPageImport(input) {
  const fileName = clean(input.fileName),
    extension = fileName.toLowerCase().match(/\.(html?|HTML?)$/i);
  if (!extension)
    throw Error("Supported import must be an .html or .htm page file");
  const mime = clean(input.mimeType).toLowerCase();
  if (mime && !["text/html", "application/xhtml+xml"].includes(mime))
    throw Error("Supported import must use an HTML file type");
  const encoded = clean(input.fileContentBase64);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw Error("Page File / Supported Import is required");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw Error("Uploaded page HTML is empty");
  if (buffer.length > 500_000)
    throw Error("Uploaded page exceeds the 500 KB limit");
  const source = buffer.toString("utf8");
  let sanitized = prepareImportedPageHtml(source);
  const body = sanitized.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  if (body) sanitized = body[1].trim();
  sanitized = sanitized
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "")
    .trim();
  if (!sanitized)
    throw Error("Uploaded page contains no usable content after processing");
  return {
    fileName,
    mimeType: mime || "text/html",
    previewHtml: sanitized,
    sizeBytes: buffer.length,
    warnings: importedPageWarnings(source),
  };
}

export class ProjectService {
  constructor(db, { aiGenerator = null, aiProvider = null } = {}) {
    this.db = db;
    this.aiGenerator = aiGenerator;
    this.aiProvider = aiProvider;
  }
  createProject(storeId, input) {
    this.#store(storeId);
    const product = this.#product(storeId, Number(input.productId)),
      name = clean(input.name),
      slug = this.#slug(input.slug);
    if (!name) throw Error("Project name is required");
    try {
      const result = this.db
        .prepare(
          "INSERT INTO projects (store_id,product_id,name,slug) VALUES (?,?,?,?)",
        )
        .run(storeId, product.id, name, slug);
      return this.getProject(storeId, Number(result.lastInsertRowid));
    } catch (e) {
      this.#unique(e, "Project slug already exists in this store");
    }
  }
  listProjects(storeId) {
    this.#store(storeId);
    return this.db
      .prepare(
        `SELECT pr.*,p.name product_name,(SELECT COUNT(*) FROM product_pages pp WHERE pp.project_id=pr.id AND pp.deleted_at IS NULL) page_count FROM projects pr JOIN products p ON p.id=pr.product_id WHERE pr.store_id=? ORDER BY pr.id DESC`,
      )
      .all(storeId)
      .map(row);
  }
  getProject(storeId, id) {
    const value = row(
      this.db
        .prepare("SELECT * FROM projects WHERE store_id=? AND id=?")
        .get(storeId, id),
    );
    if (!value) throw Error("Project not found");
    return value;
  }
  ensureStorefrontPage(storeId, productId, buttonText) {
    const product = this.#product(storeId, Number(productId));
    let page = this.db
      .prepare(
        `SELECT pp.* FROM product_pages pp
         LEFT JOIN product_storefronts ps ON ps.store_id=pp.store_id AND ps.product_id=pp.product_id
         WHERE pp.store_id=? AND pp.product_id=? AND pp.deleted_at IS NULL
         ORDER BY CASE WHEN pp.id=ps.page_id THEN 0 WHEN pp.status='published' THEN 1 ELSE 2 END,pp.id LIMIT 1`,
      )
      .get(storeId, product.id);
    if (!page) {
      let project = this.db
        .prepare(
          "SELECT * FROM projects WHERE store_id=? AND product_id=? ORDER BY id LIMIT 1",
        )
        .get(storeId, product.id);
      if (!project)
        project = this.createProject(storeId, {
          productId: product.id,
          name: `${product.name} Storefront`,
          slug: `${product.slug}-storefront-${product.id}`,
        });
      page = this.createBlankPage(storeId, {
        projectId: project.id,
        productId: product.id,
        title: product.name,
        slug: product.slug,
        body: `Discover ${product.name}.`,
        status: "published",
      });
    } else if (page.status !== "published")
      page = this.publishPage(storeId, page.id);
    const content = JSON.parse(page.content_json || page.contentJson || "{}");
    content.ctaText = clean(buttonText) || content.ctaText || "Buy Now";
    this.db
      .prepare(
        "UPDATE product_pages SET content_json=? WHERE store_id=? AND id=?",
      )
      .run(JSON.stringify(content), storeId, page.id);
    return this.getPage(storeId, page.id);
  }
  listTemplates() {
    return structuredClone(pageTemplates);
  }

  createBlankPage(storeId, input) {
    const context = this.#pageContext(storeId, input),
      checkoutActionValue = checkoutAction(
        input.ctaAction || input.checkoutAction,
      ),
      redirectUrl = clean(input.redirectUrl);
    if (checkoutActionValue === "redirect") {
      if (!redirectUrl) throw Error("Redirect URL is required");
      try {
        const url = new URL(redirectUrl);
        if (!["http:", "https:"].includes(url.protocol)) throw Error();
      } catch {
        throw Error("Redirect URL must be a valid HTTP or HTTPS URL");
      }
    }
    const content = {
      hero: {
        eyebrow: "NEW PRODUCT",
        headline: clean(input.title),
        subheadline: clean(input.body) || `Discover ${context.product.name}.`,
      },
      sections: [
        { type: "benefits", title: "Benefits", items: [] },
        {
          type: "cta",
          title: "Order now",
          body:
            checkoutActionValue === "redirect"
              ? "Continue to the configured destination."
              : "Cash on delivery available.",
        },
      ],
      ctaText: clean(input.ctaText) || "Order with COD",
      checkoutAction: checkoutActionValue,
      redirectUrl,
    };
    return this.#insertPage(storeId, input, {
      creationMethod: "blank",
      templateKey: "custom",
      content,
      body: clean(input.body),
    });
  }
  createPageFromTemplate(storeId, input) {
    const context = this.#pageContext(storeId, input),
      template = pageTemplates.find((item) => item.key === input.templateKey);
    if (!template) throw Error("Template not found");
    const title = this.#pageName(input.title);
    const content = templateContent(
      template,
      title,
      context.product,
      socialProofType(input.socialProofType),
      context.store.currency,
    );
    content.ctaText = clean(input.ctaText) || content.ctaText;
    content.checkoutAction = checkoutAction(
      input.ctaAction || input.checkoutAction,
    );
    content.redirectUrl = clean(input.redirectUrl);
    return this.#insertPage(storeId, input, {
      creationMethod:
        input.creationMethod === "default" ? "default" : "template",
      templateKey: template.key,
      content,
      body: content.hero.subheadline,
    });
  }
  previewPageImport(storeId, input) {
    this.#store(storeId);
    return processPageImport(input);
  }
  importPrebuiltPage(storeId, input) {
    this.#pageContext(storeId, input);
    const processed = input.fileContentBase64
      ? processPageImport(input)
      : {
          previewHtml: prepareImportedPageHtml(input.html),
          fileName: "legacy-import.html",
          mimeType: "text/html",
        };
    const ctaText = clean(input.ctaText) || "Order with COD",
      codEnabled = toBoolean(input.codEnabled, true);
    const content = {
      hero: {
        eyebrow: "IMPORTED PAGE",
        headline: clean(input.title || input.pageName),
        subheadline: "Imported pre-built product page",
      },
      sections: [
        { type: "imported", title: "Imported content" },
        {
          type: "cta",
          title: ctaText,
          body: codEnabled
            ? "Cash on delivery available."
            : "View product details.",
        },
      ],
      ctaText,
      codEnabled,
      importFile: { name: processed.fileName, mimeType: processed.mimeType },
    };
    return this.#insertPage(
      storeId,
      { ...input, title: input.title || input.pageName },
      {
        creationMethod: "upload",
        templateKey: "imported",
        content,
        body: "Imported pre-built page",
        importedHtml: processed.previewHtml,
      },
    );
  }
  aiStatus() {
    return {
      available: Boolean(this.aiGenerator && this.aiProvider?.authorized),
      provider: this.aiProvider?.provider ?? null,
      model: this.aiProvider?.model ?? null,
      reason:
        this.aiGenerator && this.aiProvider?.authorized
          ? null
          : "AI provider is not configured or authorized",
    };
  }
  async createAIPage(storeId, input) {
    const context = this.#pageContext(storeId, input),
      status = this.aiStatus();
    if (!status.available)
      throw Error("AI provider is not configured or authorized");
    const generated = await this.aiGenerator({
      product: context.product,
      project: context.project,
      title: clean(input.title),
      brief: clean(input.brief),
    });
    if (
      !generated?.hero?.headline ||
      !Array.isArray(generated.sections) ||
      generated.sections.length < 3
    )
      throw Error("AI provider returned an invalid editable page structure");
    return this.#insertPage(storeId, input, {
      creationMethod: "ai",
      templateKey: "ai-generated",
      content: generated,
      body: generated.hero.subheadline || "",
    });
  }
  updatePageContent(storeId, id, patch) {
    const page = this.getPage(storeId, id),
      current = JSON.parse(page.contentJson || "{}"),
      requestedTitle = patch.title,
      requestedSlug = patch.slug,
      contentPatch = { ...patch };
    delete contentPatch.title;
    delete contentPatch.slug;
    const next = {
      ...current,
      ...contentPatch,
      hero: { ...(current.hero || {}), ...(contentPatch.hero || {}) },
      thankYou: {
        ...(current.thankYou || {}),
        ...(contentPatch.thankYou || {}),
        animation: confirmationAnimation({
          ...(current.thankYou?.animation || {}),
          ...(contentPatch.thankYou?.animation || {}),
        }),
      },
    };
    delete next.socialProofType;
    delete next.socialProofEnabled;
    next.sections = (next.sections || []).filter(
      (section) => !["proof", "reviews"].includes(section.type),
    );
    if (Array.isArray(next.editorSections))
      next.editorSections = next.editorSections.filter(
        (section) =>
          !["social-proof", "proof", "testimonials", "rating"].includes(
            section.type || section.id,
          ),
      );
    if (next.urgency) {
      next.urgency = urgencyFromInput(
        { urgencyType: next.urgency.type, urgencyText: next.urgency.text },
        next.urgency,
      );
    }
    this.#validateContent(next);
    for (const section of next.sections || []) {
      if (section.type === 'blocks') section.blocks = normalizeBlocks(section.blocks);
    }
    for (const section of next.editorSections || []) {
      if (section.type === 'blocks' && next.sectionSettings?.[section.id]) {
        next.sectionSettings[section.id].blocks = normalizeBlocks(next.sectionSettings[section.id].blocks);
      }
    }
    // Store a single block list in both legacy page payload and editor settings.
    // The two renderers must never receive different block content.
    for (const section of next.sections || []) {
      if (section.type !== 'blocks') continue;
      const settings = next.sectionSettings?.[section.id];
      if (settings?.blocks) section.blocks = settings.blocks;
      else {
        next.sectionSettings ||= {};
        next.sectionSettings[section.id] = { ...(settings || {}), blocks: section.blocks };
      }
    }
    const title =
        requestedTitle === undefined
          ? this.#pageName(clean(next.hero.headline) || page.title)
          : this.#pageName(requestedTitle),
      slug =
        requestedSlug === undefined ? page.slug : this.#pageSlug(requestedSlug);
    try {
      if (page.status === 'published' || page.draftJson) {
        this.db.prepare('UPDATE product_pages SET draft_json=? WHERE store_id=? AND id=? AND deleted_at IS NULL')
          .run(JSON.stringify({ title, slug, body: clean(next.hero.subheadline) || page.body, contentJson: JSON.stringify(next) }), storeId, id);
      } else this.db
        .prepare(
          "UPDATE product_pages SET content_json=?,title=?,slug=?,body=? WHERE store_id=? AND id=? AND deleted_at IS NULL",
        )
        .run(
          JSON.stringify(next),
          title,
          slug,
          clean(next.hero.subheadline) || page.body,
          storeId,
          id,
        );
    } catch (error) {
      this.#unique(
        error,
        "This URL is already being used. Choose another URL.",
      );
    }
    return this.getPage(storeId, id);
  }
  listPages(storeId, productId = null) {
    this.#store(storeId);
    const filteredProductId = Number(productId);
    return this.db
      .prepare(
        `SELECT pp.*,p.name product_name,pr.name project_name FROM product_pages pp JOIN products p ON p.id=pp.product_id LEFT JOIN projects pr ON pr.id=pp.project_id WHERE pp.store_id=? AND pp.deleted_at IS NULL${filteredProductId ? " AND pp.product_id=?" : ""} ORDER BY pp.id DESC`,
      )
      .all(...(filteredProductId ? [storeId, filteredProductId] : [storeId]))
      .map(row).map(editablePage);
  }
  getPage(storeId, id) {
    const value = row(
      this.db
        .prepare(
          "SELECT * FROM product_pages WHERE store_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(storeId, id),
    );
    if (!value) throw Error("Page not found");
    return editablePage(value);
  }
  publishPage(storeId, id) {
    try { publishPageSnapshot(this.db, storeId, id); }
    catch (error) { this.#unique(error, 'This URL is already being used. Choose another URL.'); }
    return this.getPage(storeId, id);
  }
  unpublishPage(storeId, id) {
    this.getPage(storeId, id);
    this.db
      .prepare(
        "UPDATE product_pages SET status='draft',published_at=NULL WHERE store_id=? AND id=? AND deleted_at IS NULL",
      )
      .run(storeId, id);
    this.db
      .prepare(
        "UPDATE product_storefronts SET status='draft',published_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND page_id=?",
      )
      .run(storeId, id);
    return this.getPage(storeId, id);
  }
  duplicatePage(storeId, id) {
    const source = this.getPage(storeId, id);
    let suffix = 1,
      title = `${source.title} Copy`,
      slug = `${source.slug}-copy`;
    while (
      this.db
        .prepare(
          "SELECT id FROM product_pages WHERE store_id=? AND slug=? AND deleted_at IS NULL",
        )
        .get(storeId, slug)
    ) {
      suffix += 1;
      title = `${source.title} Copy ${suffix}`;
      slug = `${source.slug}-copy-${suffix}`;
    }
    const result = this.db
      .prepare(
        `INSERT INTO product_pages (store_id,product_id,project_id,title,slug,body,creation_method,template_key,content_json,imported_html,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`,
      )
      .run(
        storeId,
        source.productId,
        source.projectId,
        this.#pageName(title),
        this.#pageSlug(slug),
        source.body,
        source.creationMethod,
        source.templateKey,
        source.contentJson,
        source.importedHtml,
      );
    return this.getPage(storeId, Number(result.lastInsertRowid));
  }
  deletePage(storeId, id) {
    const page = this.getPage(storeId, id),
      deletedSlug = `${page.slug}-deleted-${page.id}-${Date.now()}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "DELETE FROM product_storefronts WHERE store_id=? AND page_id=?",
        )
        .run(storeId, id);
      this.db
        .prepare(
          "UPDATE product_pages SET status='draft',published_at=NULL,deleted_at=CURRENT_TIMESTAMP,slug=? WHERE store_id=? AND id=? AND deleted_at IS NULL",
        )
        .run(deletedSlug, storeId, id);
      this.db.exec("COMMIT");
      return { id: page.id, deleted: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  getPublishedPage(storeSlug, pageSlug) {
    const value = row(
      this.db
        .prepare(
          `SELECT pp.*,s.slug store_slug,s.name store_name,s.currency store_currency FROM product_pages pp JOIN stores s ON s.id=pp.store_id WHERE s.slug=? AND pp.slug=? AND pp.status='published' AND pp.deleted_at IS NULL`,
        )
        .get(storeSlug, pageSlug),
    );
    if (!value) throw Error("Published page not found");
    return {
      page: value,
      product: this.#product(value.storeId, value.productId),
    };
  }
  #insertPage(storeId, input, details) {
    const context = this.#pageContext(storeId, input),
      title = this.#pageName(input.title),
      slug = this.#pageSlug(input.slug);
    const methodContent =
      details.creationMethod === "blank"
        ? { ...details.content, sections: [] }
        : details.content;
    const content = withEditorConfig(
      {
        ...methodContent,
        urgency: urgencyFromInput(input, methodContent.urgency),
      },
      details.creationMethod,
    );
    if (input.announcementText !== undefined) {
      content.announcement = clean(input.announcementText);
      const announcementSection = content.editorSections.find(
        (section) => section.id === "announcement-bar",
      );
      if (announcementSection)
        announcementSection.visible = Boolean(content.announcement);
    }
    this.#validateContent(content);
    const requestedStatus = clean(input.status || "draft").toLowerCase();
    if (!["draft", "published"].includes(requestedStatus))
      throw Error("Status must be draft or published");
    try {
      const result = this.db
        .prepare(
          `INSERT INTO product_pages (store_id,product_id,project_id,title,slug,body,creation_method,template_key,content_json,imported_html)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          storeId,
          context.product.id,
          context.project.id,
          title,
          slug,
          details.body || "",
          details.creationMethod,
          details.templateKey,
          JSON.stringify(content),
          details.importedHtml || "",
        );
      const pageId = Number(result.lastInsertRowid);
      if (requestedStatus === "published")
        this.db
          .prepare(
            "UPDATE product_pages SET status='published',published_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
          )
          .run(storeId, pageId);
      return this.getPage(storeId, pageId);
    } catch (e) {
      this.#unique(e, "This URL is already being used. Choose another URL.");
    }
  }
  #pageContext(storeId, input) {
    const project = this.getProject(storeId, Number(input.projectId)),
      product = this.#product(storeId, Number(input.productId));
    if (project.productId !== product.id)
      throw Error("Project and product do not match");
    return { project, product, store: this.#store(storeId) };
  }
  #validateContent(content) {
    if (
      !content ||
      typeof content !== "object" ||
      !content.hero ||
      !Array.isArray(content.sections)
    )
      throw Error("Page content must contain a hero and sections");
    content.checkoutAction = checkoutAction(content.checkoutAction);
    if (content.checkoutAction === "redirect") {
      const redirectUrl = clean(content.redirectUrl);
      try {
        const parsed = new URL(redirectUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw Error();
      } catch {
        throw Error("Redirect URL must be a valid HTTP or HTTPS URL");
      }
    }
  }
  #store(id) {
    const value = this.db.prepare("SELECT * FROM stores WHERE id=?").get(id);
    if (!value) throw Error("Store not found");
    return row(value);
  }
  #product(storeId, id) {
    const value = this.db
      .prepare("SELECT * FROM products WHERE store_id=? AND id=?")
      .get(storeId, id);
    if (!value) throw Error("Product not found");
    return row(value);
  }
  #slug(value) {
    const source = clean(value).toLowerCase();
    if (/[^a-z0-9\s-]/.test(source))
      throw Error("Page URL can only contain letters, numbers, and hyphens");
    const slug = source.replace(/[\s-]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) throw Error("Page URL is required");
    return slug;
  }
  #pageSlug(value) {
    const slug = this.#slug(value);
    if (slug.length < 3) throw Error("Page URL must be at least 3 characters");
    return slug;
  }
  #pageName(value) {
    const title = clean(value).replace(/\s+/g, " ");
    if (!title) throw Error("Page name is required.");
    if ((title.match(/[A-Za-z0-9]/g) || []).length < 3)
      throw Error("Page name must be at least 3 meaningful characters.");
    return title;
  }
  #unique(error, message) {
    if (
      error?.code === "23505" ||
      /UNIQUE constraint|duplicate key value/i.test(String(error.message))
    )
      throw Error(message);
    throw error;
  }
}
