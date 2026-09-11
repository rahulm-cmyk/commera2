const escape = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Store menu fragments refer to homepage sections, even from a product or checkout.
export function storeLink(url, storeSlug) {
  const value = String(url || "").trim();
  const home = `/s/${encodeURIComponent(storeSlug)}`;
  if (value.startsWith("#")) return home + value;
  return /^(https?:\/\/|\/)/i.test(value) ? value : home;
}

export function renderStoreChrome(model, policies = [], options = {}) {
  if (!model) return { announcement: "", header: "", footer: "", style: "", favicon: "" };
  const { store, home = {}, branding = {} } = model;
  const homeHref = `/s/${encodeURIComponent(store.slug)}`;
  const logo = model.logo?.dataUrl
    ? `<img class="store-logo" src="${escape(model.logo.dataUrl)}" alt="${escape(model.logo.alt || store.name)}">`
    : `<strong>${escape(store.name)}</strong>`;
  const links = home.header?.links?.length ? home.header.links : [
    { label: "Home", url: homeHref },
    { label: "Products", url: "#products" },
    ...(policies.length ? [{ label: "Policies", url: "#policies" }] : []),
    ...(home.footer?.contact ? [{ label: "Contact", url: "#contact" }] : []),
  ];
  const navigation = links.map((link) =>
    `<a href="${escape(storeLink(link.url, store.slug))}">${escape(link.label)}</a>`
  ).join("");
  const message = home.announcement;
  const announcement = message?.enabled
    ? `<aside class="store-announcement" data-store-editor-section="announcement" style="--announcement-bg:${escape(message.backgroundColor)};--announcement-text:${escape(message.textColor)}"><span>${escape(message.message)}</span>${message.linkText && message.linkUrl ? `<a href="${escape(storeLink(message.linkUrl, store.slug))}">${escape(message.linkText)}</a>` : ""}</aside>`
    : "";
  const header = `<header class="store-site-header${home.header?.sticky ? " is-sticky" : ""}" data-store-editor-section="header"><a class="store-site-brand" href="${homeHref}">${options.logoHtml || logo}</a><nav aria-label="Store navigation">${navigation}</nav><details class="store-mobile-menu"><summary aria-label="Open store menu">Menu</summary><nav aria-label="Mobile store navigation">${navigation}</nav></details></header>`;
  const products = home.footer?.showProducts
    ? (home.featuredProducts || []).filter((product) => product.active !== 0 && product.productPageStatus === "published")
      .map((product) => `<a href="${homeHref}/products/${encodeURIComponent(product.slug)}">${escape(product.name)}</a>`).join("")
    : "";
  const policyLinks = policies.map((policy) =>
    `<a href="${homeHref}/policies/${encodeURIComponent(policy.type)}">${escape(policy.label || policy.title || policy.type)}</a>`
  ).join("");
  const footer = `<footer class="store-policy-footer" id="policies" data-store-editor-section="footer"><div id="contact"><a class="store-site-brand" href="${homeHref}">${logo}</a>${home.footer?.contact ? `<p>${escape(home.footer.contact)}</p>` : ""}</div>${products ? `<nav aria-label="Products"><strong>Products</strong>${products}</nav>` : ""}${policyLinks ? `<nav aria-label="Policies"><strong>Policies</strong>${policyLinks}</nav>` : ""}<small>© ${new Date().getUTCFullYear()} ${escape(store.name)}</small></footer>`;
  const style = `--store-primary:${escape(branding.primaryColor || "#0f5132")};--store-secondary:${escape(branding.secondaryColor || "#f4efe5")};--store-heading-font:${escape(branding.headingFont || "Inter")};--store-body-font:${escape(branding.bodyFont || "Inter")};`;
  const favicon = model.favicon?.dataUrl ? `<link rel="icon" href="${escape(model.favicon.dataUrl)}">` : "";
  return {
    announcement: options.announcement === false ? "" : announcement,
    header: options.header === false ? "" : header,
    footer: options.footer === false ? "" : footer,
    style,
    favicon,
  };
}
