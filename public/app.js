import { renderAccount, renderRecovery } from "./account.js";
import { mountCodFormEditor } from './cod-form-editor.js';
import { mountShippingRules } from './shipping-rules.js';
import { clientSectionMarkup, newThemeSection, readThemeSections, readThemeSectionState, themeSectionBlock, themeSectionCatalog, themeSectionLabel, themeSectionPanel } from './store-theme-sections.js';
import { overviewMarkup, setupWorkspaceSearch, setupStoreSwitcher, workspaceIcon } from './merchant-workspace.js';
const $ = (selector) => document.querySelector(selector);
const content = $("#content"),
  select = $("#store-select"),
  modal = $("#modal"),
  modalContent = $("#modal-content"),
  floatingLayer = $("#floating-layer-root");
const storeSwitcher = setupStoreSwitcher({ document, select });

let floatingMenuState = null,
  floatingMenuSequence = 0,
  floatingPositionFrame = 0;
const FLOATING_VIEWPORT_PADDING = 8,
  FLOATING_GAP = 6;

function floatingMenuItems(panel = floatingMenuState?.panel) {
  if (!panel) return [];
  return [...panel.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role='menuitem']:not([aria-disabled='true'])")].filter(
    (item) => !item.hidden && item.getClientRects().length,
  );
}

function positionFloatingMenu() {
  const state = floatingMenuState;
  if (!state || !state.source.isConnected || !state.trigger.isConnected) {
    if (state) closeFloatingMenu();
    return;
  }
  const viewportWidth = window.visualViewport?.width || innerWidth,
    viewportHeight = window.visualViewport?.height || innerHeight,
    viewportLeft = window.visualViewport?.offsetLeft || 0,
    viewportTop = window.visualViewport?.offsetTop || 0,
    triggerRect = state.trigger.getBoundingClientRect();
  if (
    triggerRect.bottom < viewportTop ||
    triggerRect.top > viewportTop + viewportHeight ||
    triggerRect.right < viewportLeft ||
    triggerRect.left > viewportLeft + viewportWidth
  ) {
    closeFloatingMenu();
    return;
  }
  const panel = state.panel,
    availableHeight = Math.max(120, viewportHeight - FLOATING_VIEWPORT_PADDING * 2);
  panel.style.maxHeight = `${availableHeight}px`;
  panel.style.visibility = "hidden";
  panel.style.left = `${viewportLeft + FLOATING_VIEWPORT_PADDING}px`;
  panel.style.top = `${viewportTop + FLOATING_VIEWPORT_PADDING}px`;
  const panelRect = panel.getBoundingClientRect(),
    width = Math.min(panelRect.width, viewportWidth - FLOATING_VIEWPORT_PADDING * 2),
    height = Math.min(panelRect.height, availableHeight),
    spaceBelow = viewportTop + viewportHeight - FLOATING_VIEWPORT_PADDING - triggerRect.bottom - FLOATING_GAP,
    spaceAbove = triggerRect.top - viewportTop - FLOATING_VIEWPORT_PADDING - FLOATING_GAP,
    opensAbove = height > spaceBelow && spaceAbove > spaceBelow,
    minimumLeft = viewportLeft + FLOATING_VIEWPORT_PADDING,
    maximumLeft = viewportLeft + viewportWidth - width - FLOATING_VIEWPORT_PADDING,
    idealLeft = triggerRect.right - width,
    left = Math.max(minimumLeft, Math.min(idealLeft, maximumLeft)),
    idealTop = opensAbove
      ? triggerRect.top - height - FLOATING_GAP
      : triggerRect.bottom + FLOATING_GAP,
    minimumTop = viewportTop + FLOATING_VIEWPORT_PADDING,
    maximumTop = viewportTop + viewportHeight - height - FLOATING_VIEWPORT_PADDING,
    top = Math.max(minimumTop, Math.min(idealTop, maximumTop));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.visibility = "visible";
  panel.dataset.placement = opensAbove ? "top-end" : "bottom-end";
}

function scheduleFloatingMenuPosition() {
  if (!floatingMenuState || floatingPositionFrame) return;
  floatingPositionFrame = requestAnimationFrame(() => {
    floatingPositionFrame = 0;
    positionFloatingMenu();
  });
}

function closeFloatingMenu({ returnFocus = false } = {}) {
  const state = floatingMenuState;
  if (!state) return;
  floatingMenuState = null;
  if (floatingPositionFrame) cancelAnimationFrame(floatingPositionFrame);
  floatingPositionFrame = 0;
  state.resizeObserver?.disconnect();
  state.trigger.setAttribute("aria-expanded", "false");
  state.source.open = false;
  state.panel.classList.remove("floating-menu");
  [...state.sourceClasses].forEach((name) =>
    state.panel.classList.remove(`floating-source-${name}`),
  );
  state.panel.removeAttribute("data-placement");
  state.panel.style.removeProperty("left");
  state.panel.style.removeProperty("top");
  state.panel.style.removeProperty("max-height");
  state.panel.style.removeProperty("visibility");
  if (state.placeholder.isConnected) state.placeholder.replaceWith(state.panel);
  else state.panel.remove();
  state.formAssociations.forEach(({ control, previous }) => {
    if (previous === null) control.removeAttribute("form");
    else control.setAttribute("form", previous);
  });
  if (typeof floatingLayer.hidePopover === "function") {
    try {
      if (floatingLayer.matches(":popover-open")) floatingLayer.hidePopover();
    } catch {}
  }
  if (returnFocus && state.trigger.isConnected) state.trigger.focus();
}

function openFloatingMenu(source, { focusFirst = false } = {}) {
  const trigger = source.querySelector(":scope > summary"),
    panel = source.querySelector(":scope > [data-floating-menu], :scope > div");
  if (!trigger || !panel) return;
  if (floatingMenuState?.source === source) {
    scheduleFloatingMenuPosition();
    if (focusFirst) floatingMenuItems(panel)[0]?.focus();
    return;
  }
  closeFloatingMenu();
  const placeholder = document.createComment("floating-menu-origin"),
    sourceClasses = [...source.classList],
    ownerForm = source.closest("form"),
    formAssociations = [];
  if (ownerForm) {
    if (!ownerForm.id) ownerForm.id = `floating-form-${++floatingMenuSequence}`;
    panel.querySelectorAll("button, input, select, textarea").forEach((control) => {
      formAssociations.push({
        control,
        previous: control.hasAttribute("form") ? control.getAttribute("form") : null,
      });
      control.setAttribute("form", ownerForm.id);
    });
  }
  source.insertBefore(placeholder, panel);
  panel.hidden = false;
  panel.classList.add("floating-menu");
  sourceClasses.forEach((name) => panel.classList.add(`floating-source-${name}`));
  if (typeof floatingLayer.showPopover === "function") {
    try {
      if (!floatingLayer.matches(":popover-open")) floatingLayer.showPopover();
    } catch {}
  }
  floatingLayer.append(panel);
  source.open = true;
  trigger.setAttribute("aria-expanded", "true");
  const resizeObserver = new ResizeObserver(scheduleFloatingMenuPosition);
  floatingMenuState = {
    source,
    trigger,
    panel,
    placeholder,
    sourceClasses,
    formAssociations,
    resizeObserver,
  };
  resizeObserver.observe(trigger);
  resizeObserver.observe(panel);
  positionFloatingMenu();
  if (focusFirst) floatingMenuItems(panel)[0]?.focus();
}

function wireFloatingMenus(root = document) {
  root.querySelectorAll?.("details.row-menu").forEach((source) => {
    const trigger = source.querySelector(":scope > summary"),
      panel = source.querySelector(":scope > div");
    if (!trigger || !panel || trigger.dataset.floatingTrigger !== undefined) return;
    const menuId = panel.id || `floating-menu-${++floatingMenuSequence}`;
    panel.id = menuId;
    const isInteractivePopover = source.classList.contains("field-row-menu");
    panel.dataset.floatingMenu = "";
    panel.setAttribute("role", isInteractivePopover ? "dialog" : "menu");
    trigger.dataset.floatingTrigger = "";
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-haspopup", isInteractivePopover ? "dialog" : "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menuId);
    if (!trigger.id) trigger.id = `${menuId}-trigger`;
    panel.setAttribute("aria-labelledby", trigger.id);
    if (!isInteractivePopover)
      panel.querySelectorAll("button, a[href]").forEach((item) =>
        item.setAttribute("role", "menuitem"),
      );
  });
}
function syncModalAccessibleName() {
  const title = modalContent?.querySelector("h2");
  if (title) {
    title.id = "application-dialog-title";
    modal.setAttribute("aria-labelledby", title.id);
    modal.removeAttribute("aria-label");
    return;
  }
  modal.removeAttribute("aria-labelledby");
  modal.setAttribute("aria-label", "Application dialog");
}

document.addEventListener(
  "toggle",
  (event) => {
    const source = event.target;
    if (!(source instanceof HTMLDetailsElement) || !source.classList.contains("row-menu")) return;
    wireFloatingMenus(source.parentElement || document);
    if (source.open) openFloatingMenu(source);
    else if (floatingMenuState?.source === source) closeFloatingMenu();
  },
  true,
);
document.addEventListener("pointerdown", (event) => {
  if (!floatingMenuState) return;
  if (
    floatingMenuState.panel.contains(event.target) ||
    floatingMenuState.trigger.contains(event.target)
  )
    return;
  closeFloatingMenu();
});
document.addEventListener("keydown", (event) => {
  const trigger = event.target.closest?.("[data-floating-trigger]");
  if (trigger && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
    const source = trigger.closest("details.row-menu");
    if (source.open && ["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (!source.open) source.open = true;
    openFloatingMenu(source, { focusFirst: true });
    const items = floatingMenuItems();
    if (event.key === "ArrowUp") items.at(-1)?.focus();
    return;
  }
  if (!floatingMenuState) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeFloatingMenu({ returnFocus: true });
    return;
  }
  if (!floatingMenuState.panel.contains(event.target)) return;
  const items = floatingMenuItems(),
    index = items.indexOf(document.activeElement);
  let nextIndex = null;
  if (event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
  else if (event.key === "ArrowUp") nextIndex = (index - 1 + items.length) % items.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  if (nextIndex !== null && items.length) {
    event.preventDefault();
    items[nextIndex].focus();
  }
});
document.addEventListener("keydown", (event) => {
  const tab = event.target.closest?.("[role='tab']");
  if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...tab.closest("[role='tablist']")?.querySelectorAll("[role='tab']") || []];
  if (!tabs.length) return;
  event.preventDefault();
  const index = tabs.indexOf(tab),
    next = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs.at(-1)
        : tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  next.click();
  requestAnimationFrame(() =>
    document.querySelector("[role='tab'][aria-selected='true']")?.focus(),
  );
});
window.addEventListener("resize", scheduleFloatingMenuPosition, { passive: true });
window.addEventListener("scroll", scheduleFloatingMenuPosition, { capture: true, passive: true });
window.visualViewport?.addEventListener("resize", scheduleFloatingMenuPosition, { passive: true });
window.visualViewport?.addEventListener("scroll", scheduleFloatingMenuPosition, { passive: true });
new MutationObserver(() => {
  if (floatingMenuState && !floatingMenuState.source.isConnected) closeFloatingMenu();
  wireFloatingMenus(content);
  wireFloatingMenus(modal);
  syncModalAccessibleName();
}).observe(document.body, { childList: true, subtree: true });
wireFloatingMenus();
syncModalAccessibleName();

$("#modal-close").onclick = () => modal.close();
modal.addEventListener("close", () => closeFloatingMenu());
let stores = [],
  merchantIdentity = null,
  csrfToken = "",
  googleAuthEnabled = false,
  storeId = null,
  data = null,
  ops = null,
  templates = [],
  aiState = null,
  view = "home",
  productTab = "all",
  settingsTab = "cod-form",
  upsellStatusFilter = "all",
  pixelTab = "connected",
  pixelMappingConnectionId = null,
  reviewTab = "all",
  reviewSearch = "",
  reviewSearchTimer = null,
  reviewProduct = "all",
  reviewSource = "all",
  reviewRating = "all",
  reviewEditing = null,
  reviewImportPreview = null,
  reviewImportResult = null,
  reviewImportFile = null,
  policyTab = "overview",
  codSettingsSection = "general",
  orderSearch = "",
  orderStatus = "all",
  orderPayment = "all",
  orderDelivery = "all",
  orderRange = "today",
  orderRangeStart = "",
  orderRangeEnd = "",
  orderSection = "all",
  customerSearch = "",
  liveVisitorFilter = "all",
  liveVisitorStream = null,
  liveVisitorStreamStoreId = null,
  productPageDirty = false,
  productPageSaveHandler = null,
  currentMerchantLocation = location.pathname + location.search;
const selectedStoreKey = "commera2-selected-store";
const viewPaths = {
  campaigns: '/campaigns',
  account: "/account",
  home: "/overview",
  store: "/store",
  'online-store': '/online-store/themes',
  products: "/products",
  pages: "/product-pages",
  reviews: "/reviews",
  orders: "/orders",
  customers: "/customers",
  abandoned: "/abandoned",
  visitors: "/live-visitors",
  policies: "/policy",
  settings: "/settings/cod-form",
};
const validProductTabs = new Set([
    "all",
    "bundles",
    "discounts",
    "collections",
    "inventory",
    "purchase-orders",
    "transfers",
    "gift-cards",
  ]),
  validSettingsTabs = new Set([
    "cod-form",
    "domain",
    "pixel",
    "checkout",
    "shipping",
    "channels",
    "privacy",
  ]),
  validReviewTabs = new Set([
    "all",
    "pending",
    "approved",
    "disapproved",
    "consumer-all",
    "consumer-pending",
    "consumer-approved",
    "consumer-disapproved",
    "manual-add",
    "bulk-upload",
  ]),
  validPolicyTabs = new Set(["rules", "written", "contact"]);
function routeFromPath(pathname = location.pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === '/campaigns') return {valid:true,view:'campaigns',path};
  if (path === "/account") return { valid: true, view: "account", path };
  if (path === "/" || path === "/overview")
    return { valid: true, view: "home", path: "/overview" };
  if (path === "/store") return { valid: true, view: "store", path };
  if (path === '/online-store') return {valid:true,view:'online-store',onlineTab:'themes',path:'/online-store/themes'};
  const onlineMatch=path.match(/^\/online-store\/(themes|pages|preferences)(?:\/(new|[a-f0-9-]+\/edit|current\/edit))?$/);
  if (onlineMatch && (!onlineMatch[2] || (onlineMatch[1]==='themes' && onlineMatch[2]==='current/edit') || (onlineMatch[1]==='pages' && onlineMatch[2]!=='current/edit')))
    return {valid:true,view:'online-store',onlineTab:onlineMatch[1],onlineScreen:onlineMatch[2]||'',path};
  if (path === "/products/new")
    return { valid: true, view: "products", screen: "product-new", path };
  const productMatch = path.match(/^\/products\/(\d+)$/);
  if (productMatch)
    return {
      valid: true,
      view: "products",
      screen: "product-edit",
      productId: Number(productMatch[1]),
      path,
    };
  if (path === "/products")
    return { valid: true, view: "products", productTab: "all", path };
  const productTabMatch = path.match(/^\/products\/([a-z-]+)$/);
  if (productTabMatch && validProductTabs.has(productTabMatch[1]))
    return {
      valid: true,
      view: "products",
      productTab: productTabMatch[1],
      path,
    };
  if (path === "/product-pages") return { valid: true, view: "pages", path };
  const pageMatch = path.match(/^\/product-pages\/(\d+)\/edit$/);
  if (pageMatch)
    return {
      valid: true,
      view: "pages",
      screen: "page-edit",
      pageId: Number(pageMatch[1]),
      path,
    };
  if (path === "/reviews")
    return { valid: true, view: "reviews", reviewTab: "all", path };
  const reviewMatch = path.match(/^\/reviews\/([a-z-]+)$/);
  if (reviewMatch && validReviewTabs.has(reviewMatch[1]))
    return {
      valid: true,
      view: "reviews",
      reviewTab: reviewMatch[1],
      path,
    };
  if (path === "/orders") return { valid: true, view: "orders", path };
  const orderMatch = path.match(/^\/orders\/(\d+)$/);
  if (orderMatch)
    return {
      valid: true,
      view: "orders",
      screen: "order-detail",
      orderId: Number(orderMatch[1]),
      path,
    };
  if (path === "/customers") return { valid: true, view: "customers", path };
  if (path === "/abandoned") return { valid: true, view: "abandoned", path };
  if (path === "/live-visitors")
    return { valid: true, view: "visitors", path };
  if (path === "/policy")
    return { valid: true, view: "policies", policyTab: "overview", path };
  const policyMatch = path.match(/^\/policy\/([a-z-]+)$/);
  if (policyMatch && validPolicyTabs.has(policyMatch[1]))
    return {
      valid: true,
      view: "policies",
      policyTab: policyMatch[1],
      path,
    };
  if (path === "/settings")
    return {
      valid: true,
      view: "settings",
      settingsTab: "cod-form",
      path: "/settings/cod-form",
    };
  const settingsMatch = path.match(/^\/settings\/([a-z-]+)$/);
  if (settingsMatch && validSettingsTabs.has(settingsMatch[1]))
    return {
      valid: true,
      view: "settings",
      settingsTab: settingsMatch[1],
      path,
    };
  return { valid: false, view: "home", path: "/overview" };
}
function unsavedNavigationChoice() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(choice);
    };
    modalContent.innerHTML = `<div class="unsaved-dialog"><span class="eyebrow">UNSAVED CHANGES</span><h2>You have unsaved changes.</h2><p>Save before leaving? Save your latest page edits or choose to leave without saving.</p><div class="modal-actions"><button class="secondary" id="continue-editing" type="button">Stay</button><button class="danger" id="discard-changes" type="button">Leave without saving</button><button class="primary" id="save-before-leaving" type="button">Save and leave</button></div></div>`;
    $("#modal-form").onsubmit = (event) => event.preventDefault();
    $("#continue-editing").onclick = () => finish("continue");
    $("#discard-changes").onclick = () => finish("discard");
    $("#save-before-leaving").onclick = () => finish("save");
    modal.addEventListener("close", () => finish("continue"), { once: true });
    modal.showModal();
  });
}
async function confirmEditorNavigation() {
  if (productPageDirty) {
    const choice = await unsavedNavigationChoice();
    if (choice === "continue") return false;
    if (choice === "save") {
      const saved = await productPageSaveHandler?.();
      if (!saved) return false;
    }
  }
  productPageDirty = false;
  productPageSaveHandler = null;
  return true;
}
async function navigateTo(path, { replace = false } = {}) {
  if (!await confirmEditorNavigation()) return false;
  const method = replace ? "replaceState" : "pushState";
  history[method]({}, "", path);
  currentMerchantLocation = location.pathname + location.search;
  if (merchantIdentity) {
    if (data || routeFromPath().view === "account") render();
    else await load();
  }
}
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
const rupees = (paise) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: data?.store?.currency || "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);
const activeStoreDomain = () => {
  const domains = data?.domainOverview?.customDomains || data?.domains || [],
    usable = (domain) =>
      domain &&
      (domain.overallStatus === "ACTIVE" || domain.status === "active") &&
      domain.openUrl;
  return domains.find((domain) => usable(domain) && domain.primaryDomain) || domains.find(usable);
};
const storeUrl = (path = "") => {
  const suffix = path ? `/${String(path).replace(/^\/+/, "")}` : "",
    domain = activeStoreDomain();
  if (domain) return `${String(domain.openUrl).replace(/\/+$/, "")}${suffix}`;
  return `/s/${encodeURIComponent(data.store.slug)}${suffix}`;
};
const ratingStars = (rating) => {
  const filled = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
};
async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)
        ? { "x-csrf-token": csrfToken }
        : {}),
      ...(options.headers || {}),
    },
  });
  const out = await response.json();
  if (!response.ok) {
    const error = Error(out.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return out;
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}
function openForm(title, fields, submitLabel, onSubmit) {
  modalContent.innerHTML = `<h2>${esc(title)}</h2>${fields}<button class="primary" type="submit">${esc(submitLabel)}</button>`;
  const form = $("#modal-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(form));
      await onSubmit(values);
      modal.close();
      toast("Saved to live database");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  modal.showModal();
}
async function refreshStores() {
  stores = await api("/api/stores");
  select.innerHTML = stores
    .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
    .join("");
  if (!storeId && stores.length) {
    const savedStoreId = Number(localStorage.getItem(selectedStoreKey));
    storeId = stores.some((store) => store.id === savedStoreId)
      ? savedStoreId
      : stores[0].id;
  }
  if (storeId && !stores.some((store) => store.id === Number(storeId)))
    storeId = stores[0]?.id || null;
  if (storeId) localStorage.setItem(selectedStoreKey, String(storeId));
  if (storeId) select.value = storeId;
  storeSwitcher.sync();
  const mobileName = $("#mobile-store-name"),
    active = stores.find((store) => store.id === Number(storeId));
  if (mobileName) mobileName.textContent = active?.name || "Store";
}
function renderAuthentication() {
  closeSidebar();
  closeFloatingMenu();
  if (liveVisitorStream) { liveVisitorStream.close(); liveVisitorStream = null; }
  document.body.classList.add("auth-screen");
  const authError = new URLSearchParams(location.search).get("authError") || "";
  content.innerHTML = `<section class="auth-card"><a class="auth-brand" href="/overview" aria-label="Commera2 home"><img class="commera-wordmark" src="/brand/commera2-logo-v1.png" width="2172" height="724" alt="Commera2"></a>${googleAuthEnabled ? '<a class="google-auth-button" href="/api/auth/google?returnTo=%2Foverview"><span aria-hidden="true">G</span>Continue with Google</a><div class="auth-divider"><span>or use email</span></div>' : ""}<div class="auth-tabs"><button class="active" type="button" data-auth-mode="login">Sign in</button><button type="button" data-auth-mode="register">Create account</button></div><form id="auth-form"><label class="field auth-name" hidden>Your name<input name="displayName" autocomplete="name"></label><label class="field">Email<input name="email" type="email" autocomplete="email" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" minlength="10" required></label><p class="helper-text auth-password-help" hidden>Use at least 10 characters with a letter and number.</p><button class="primary" type="submit">Sign in</button><p id="auth-message" role="status"${authError ? ' data-state="error"' : ""}>${esc(authError)}</p></form></section>`;
  let mode = "login";
  const confirmField = document.createElement("label");
  confirmField.className = "field auth-confirm";
  confirmField.hidden = true;
  confirmField.innerHTML = 'Confirm password <input name="confirmPassword" type="password" autocomplete="new-password" maxlength="256">';
  $("#auth-form").insertBefore(confirmField, $("#auth-form button[type='submit']"));
  const forgot = document.createElement("button");
  forgot.type = "button";
  forgot.className = "text-button";
  forgot.id = "forgot-password";
  forgot.textContent = "Forgot password?";
  $("#auth-form").append(forgot);
  forgot.onclick = () => renderRecovery({ root: content, api, esc, back: renderAuthentication, googleEnabled: googleAuthEnabled });
  const form = $("#auth-form"),
    name = $(".auth-name"),
    help = $(".auth-password-help"),
    submit = form.querySelector('button[type="submit"]'),
    message = $("#auth-message");
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.onclick = () => {
      mode = button.dataset.authMode;
      document
        .querySelectorAll("[data-auth-mode]")
        .forEach((item) => item.classList.toggle("active", item === button));
      name.hidden = mode !== "register";
      name.querySelector("input").required = mode === "register";
      help.hidden = mode !== "register";
      confirmField.hidden = mode !== "register";
      form.elements.confirmPassword.required = mode === "register";
      forgot.hidden = mode !== "login";
      name.querySelector("input").minLength = 2;
      name.querySelector("input").maxLength = 100;
      form.elements.password.maxLength = 256;
      form.elements.password.autocomplete =
        mode === "register" ? "new-password" : "current-password";
      submit.textContent = mode === "register" ? "Create account" : "Sign in";
      message.textContent = "";
    };
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (mode === "register" && form.elements.password.value !== form.elements.confirmPassword.value) {
      message.textContent = "Passwords do not match";
      message.dataset.state = "error";
      form.elements.confirmPassword.focus();
      return;
    }
    submit.disabled = true;
    message.textContent = mode === "register" ? "Creating account…" : "Signing in…";
    try {
      const values = Object.fromEntries(new FormData(form)),
        result = await api(`/api/auth/${mode}`, {
          method: "POST",
          body: JSON.stringify(values),
        });
      merchantIdentity = result.user;
      updateAccountIdentity(result.user);
      csrfToken = result.csrfToken;
      document.body.classList.remove("auth-screen");
      history.replaceState({}, "", "/overview");
      await load();
    } catch (error) {
      message.textContent = error.message;
      message.dataset.state = "error";
    } finally {
      submit.disabled = false;
    }
  };
}
async function bootstrap() {
  try {
    googleAuthEnabled = Boolean(
      (await api("/api/auth/google/status")).enabled,
    );
  } catch {
    googleAuthEnabled = false;
  }
  if (location.pathname === "/reset-password") {
    const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
    history.replaceState({}, "", "/reset-password");
    document.body.classList.add("auth-screen");
    return renderRecovery({ root: content, api, esc, token, googleEnabled: googleAuthEnabled,
      back: () => { history.replaceState({}, "", "/"); renderAuthentication(); } });
  }
  try {
    const result = await api("/api/auth/me");
    merchantIdentity = result.user;
    updateAccountIdentity(result.user);
    csrfToken = result.csrfToken || "";
    document.body.classList.remove("auth-screen");
    await load();
  } catch (error) {
    if (error.status === 401) return renderAuthentication();
    throw error;
  }
}
async function load() {
  content.setAttribute("aria-busy", "true");
  content.innerHTML = `<section class="panel app-loading" aria-label="Loading store"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line"></div><div class="skeleton-grid">${Array.from({ length: 4 }, () => '<div class="skeleton skeleton-card"></div>').join("")}</div></section>`;
  try {
    await refreshStores();
    if (routeFromPath().view === "account") { render(); return; }
    if (!storeId) {
      content.innerHTML =
        '<div class="panel empty"><h2>Create your first store</h2><p>Begin the working commerce flow with isolated store data.</p><button class="primary" id="empty-store">Create store</button></div>';
      $("#empty-store").onclick = newStore;
      return;
    }
    [data, ops, templates, aiState] = await Promise.all([
      api(`/api/stores/${storeId}/dashboard`),
      api(`/api/stores/${storeId}/product-operations`),
      api("/api/page-templates"),
      api(`/api/stores/${storeId}/ai-page-status`),
    ]);
    render();
  } catch (error) {
    if (error.status === 401) return renderAuthentication();
    content.innerHTML = `<section class="panel load-error"><span aria-hidden="true">!</span><h2>We couldn’t load this store</h2><p>${esc(error.message || "Check the connection and try again.")}</p><button class="primary" id="retry-load" type="button">Try again</button></section>`;
    $("#retry-load").onclick = load;
  } finally {
    content.removeAttribute("aria-busy");
  }
}
function metric(label, value, note) {
  return `<article class="metric"><small>${label}</small><strong>${value}</strong><span>${note}</span></article>`;
}
function empty(message) {
  return `<div class="empty">${esc(message)}</div>`;
}
const pageDescriptions = {
  home: "A little clarity for your business, every day.",
  store: "Manage the complete customer-facing website for this business.",
  'online-store': 'Manage your website design, content pages and storefront preferences.',
  products: "Your products, prices and stock, all in one place.",
  pages: "Design the product pages your customers shop from.",
  reviews: "Moderate and manage product reviews.",
  orders: "Review and manage customer orders.",
  customers: "Customers created from completed orders.",
  abandoned: "Recover checkout sessions that did not become orders.",
  visitors: "Watch real customers move from product view to cart and checkout.",
  policies: "Manage operational rules and customer-facing policies.",
  settings: "Make your store work the way you do.",
};
function setPageHeader(description = pageDescriptions[view], actions = "") {
  const descriptionElement = $("#page-description"),
    actionElement = $("#page-actions");
  if (descriptionElement) descriptionElement.textContent = description || "";
  if (actionElement) actionElement.innerHTML = actions;
}
function render() {
  storePreviewResizeObserver?.disconnect();
  storePreviewResizeObserver = null;
  document.body.classList.remove("visual-builder-open");
  document.body.classList.remove("online-theme-editor-open");
  content.classList.remove('online-theme-editor', 'live-visitors-workspace');
  const route = routeFromPath();
  if (
    liveVisitorStream &&
    (route.view !== "visitors" || liveVisitorStreamStoreId !== storeId)
  ) {
    liveVisitorStream.close();
    liveVisitorStream = null;
    liveVisitorStreamStoreId = null;
  }
  if (!route.valid || route.path !== location.pathname) {
    history.replaceState({}, "", route.path);
    currentMerchantLocation = location.pathname + location.search;
  }
  view = route.view;
  if (route.productTab) productTab = route.productTab;
  if (route.settingsTab) settingsTab = route.settingsTab;
  if (route.reviewTab) reviewTab = route.reviewTab;
  if (route.policyTab) policyTab = route.policyTab;
  const names = {
    campaigns: 'UTM Sheet',
    account: "Account & Security",
    home: "Home",
    store: "Store",
    'online-store': 'Store design',
    products: "Products",
    pages: "Product Pages",
    reviews: "Reviews",
    orders: "Orders",
    customers: "Customers",
    abandoned: "Abandoned checkouts",
    visitors: "Live Website Visitors",
    policies: "Store policies",
    settings: "Settings",
  };
  $("#page-title").textContent = names[view];
  const workspaceName = $('#workspace-store-name'), workspaceLink = $('#workspace-store-link');
  if (workspaceName) workspaceName.textContent = data?.store?.name || stores.find(store => store.id === storeId)?.name || 'Your account';
  if (workspaceLink) {
    if (data?.store) workspaceLink.href = storeUrl();
    workspaceLink.hidden = !data?.storefrontPublication?.live;
  }
  content.classList.remove('route-enter');
  requestAnimationFrame(() => content.classList.add('route-enter'));
  setPageHeader();
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelector('.online-store-subnav').hidden = !['store','online-store'].includes(view);
  document.querySelectorAll('[data-route]').forEach(button => button.classList.toggle('active', button.dataset.route === `/online-store/${route.onlineTab || 'themes'}`));
  if (view === 'online-store') return onlineStoreView(route);
  if (view === 'campaigns') {
    const requestedStore = storeId;
    content.innerHTML = '<p role="status">Loading UTM sheet...</p>';
    const isActive = () => routeFromPath().view === 'campaigns' && storeId === requestedStore;
    import('/utm-sheet.js?v=1').then(module => {
      if (isActive()) module.renderUtmSheet({root:content,storeId:requestedStore,api,esc,isActive});
    }).catch(error => { if(isActive()) content.innerHTML = `<p role="alert">${esc(error.message)}</p>`; });
    return;
  }
  if (view === "account") return renderAccount({ root: content, api, esc,
    updateIdentity: updateAccountIdentity, updateCsrf: (value) => { csrfToken = value; },
    isActive: () => routeFromPath().view === "account" && Boolean(merchantIdentity),
    signOut: () => $("#logout").click() });
  if (route.screen === "product-new") return createProductEditor();
  if (route.screen === "product-edit")
    return createProductEditor(route.productId);
  if (route.screen === "page-edit") return editPageForm(route.pageId);
  if (route.screen === "order-detail")
    return orderDetailView(route.orderId);
  ({
    home: homeView,
    store: storeView,
    products: productsView,
    pages: pagesView,
    reviews: reviewsView,
    orders: ordersView,
    customers: customersView,
    abandoned: abandonedView,
    visitors: liveVisitorsView,
    policies: policiesView,
    settings: settingsView,
  })[view]();
}
let storeEditorSection = "banner";
let storePreviewResizeObserver = null;
async function onlineStoreView(route) {
  if (route.onlineTab==='themes' && route.onlineScreen==='current/edit') {
    storeView({ themeEditor: true });
    content.classList.add('online-theme-editor');
    document.body.classList.add('online-theme-editor-open');
    return;
  }
  content.innerHTML='<section class="panel" role="status">Loading Online Store…</section>';
  try {
    const module=await import('/online-store.js');
    if (location.pathname!==route.path) return;
    await module.renderOnlineStore({root:content,route,data,storeId,api,esc,storeUrl,navigate:navigateTo,toast,
      setDirty:(dirty,save)=>{productPageDirty=dirty;productPageSaveHandler=save;}});
  } catch(error) { if(location.pathname===route.path) content.innerHTML=`<section class="panel" role="alert">${esc(error.message)}</section>`; }
}
function storeMenuRow(link = {}) {
  return `<div class="store-menu-row"><div class="store-menu-row-title"><strong>Menu item</strong><div class="store-menu-row-actions"><button type="button" class="secondary" data-menu-move="up" aria-label="Move menu item up">↑</button><button type="button" class="secondary" data-menu-move="down" aria-label="Move menu item down">↓</button><button type="button" class="secondary" data-menu-remove aria-label="Remove menu item">×</button></div></div><label class="field">Link label<input data-menu-label maxlength="40" value="${esc(link.label || '')}" placeholder="e.g. Shop hair oil"></label><label class="field">Destination<input data-menu-url value="${esc(link.url || '')}" placeholder="/s/your-store, #products or https://…"></label></div>`;
}
function readStoreMenuLinks(form) {
  return [...form.querySelectorAll('.store-menu-row')].map(row => {
    const label = row.querySelector('[data-menu-label]').value.trim();
    const url = row.querySelector('[data-menu-url]').value.trim();
    if (!label || !url) throw Error('Add a label and destination for every menu item, or remove the empty item.');
    return {label, url};
  });
}
function setupStoreEditorControls(form) {
  const list = form.querySelector('#store-menu-links');
  const add = form.querySelector('#store-menu-add');
  const update = () => {
    const rows = [...list.children];
    rows.forEach((row, index) => {
      row.querySelector('strong').textContent = `Menu item ${index + 1}`;
      row.querySelector('[data-menu-move="up"]').disabled = index === 0;
      row.querySelector('[data-menu-move="down"]').disabled = index === rows.length - 1;
    });
    add.disabled = rows.length >= 8;
    form.querySelector('#store-menu-empty').hidden = rows.length > 0;
  };
  const changed = () => { update(); form.dispatchEvent(new Event('input', {bubbles:true})); };
  add.onclick = () => {
    if (list.children.length >= 8) return;
    list.insertAdjacentHTML('beforeend', storeMenuRow());
    changed(); list.lastElementChild.querySelector('input').focus();
  };
  list.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    const row = button.closest('.store-menu-row');
    if (button.hasAttribute('data-menu-remove')) { row.remove(); changed(); add.focus(); return; }
    if (button.dataset.menuMove === 'up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    if (button.dataset.menuMove === 'down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    changed(); row.querySelector('input').focus();
  };
  update();
  const file = form.elements.bannerImage;
  file.onchange = () => {
    const selected = file.files[0];
    if (!selected) return;
    form.querySelector('#store-banner-file-name').textContent = selected.name;
    const reader = new FileReader();
    reader.onload = () => {
      if (file.files[0] !== selected) return;
      const preview = form.querySelector('#store-banner-image-preview');
      preview.src = reader.result; preview.hidden = false;
      form.querySelector('#store-banner-placeholder').hidden = true;
      form.dispatchEvent(new CustomEvent('store-preview-image', { bubbles: true }));
    };
    reader.readAsDataURL(selected);
  };
}
function storeView() {
  const { themeEditor = false } = arguments[0] || {};
  const storefront = data.storefront || {},
    branding = storefront.branding || {},
    home = storefront.home || {},
    announcement = home.announcement || {},
    header = home.header || { links: [], sticky: true },
    footer = home.footer || {},
    customSections = home.customSections || [],
    themeSettings = home.themeSettings || {},
    selectedProducts = new Set(
      (home.featuredProducts || []).map((item) => Number(item.id)),
    ),
    fonts = ["Inter", "Arial", "Georgia", "Poppins"],
    fontOptions = (selected) =>
      fonts
        .map(
          (font) =>
            `<option value="${font}" ${selected === font ? "selected" : ""}>${font}</option>`,
        )
        .join(""),
    products = (data.products || [])
      .map(
        (product) =>
          `<label class="store-product-choice"><input name="featuredProductIds" type="checkbox" value="${product.id}" ${selectedProducts.has(Number(product.id)) ? "checked" : ""}><span><strong>${esc(product.name)}</strong><small>${rupees(product.pricePaise)} · ${product.stock} in stock</small></span></label>`,
      )
      .join(""),
    targetType = home.buttonTarget?.type || "product",
    targetOptions = (items, selected, label) =>
      (items || [])
        .map(
          (item) =>
            `<option value="${item.id}" ${Number(selected) === Number(item.id) ? "selected" : ""}>${esc(label(item))}</option>`,
        )
        .join(""),
    status = home.status || "draft",
    connectedDomain = (data?.domainOverview?.customDomains || data?.domains || [])[0],
    activeDomain = activeStoreDomain(),
    liveStoreAction =
      data.storefrontPublication?.live || status === "published"
        ? activeDomain
          ? `<a class="primary button-link" href="${esc(activeDomain.openUrl)}" target="_blank" rel="noopener">Open Store</a> `
          : connectedDomain
            ? `<button class="secondary" type="button" disabled title="Finish domain verification and SSL setup">Domain not ready</button> `
            : `<a class="primary button-link" href="${esc(storeUrl())}" target="_blank" rel="noopener">Open Store</a> `
        : "";

  setPageHeader(
    "One Store combines identity, homepage, products, checkout, policies, domain, and tracking.",
    `${liveStoreAction}<button class="secondary" id="show-store-admin-preview" type="button">Admin Preview</button>`,
  );
  content.innerHTML = `<div class="store-definition"><div><span class="eyebrow">CUSTOMER WEBSITE</span><h2>${esc(data.store.name)}</h2><p>Identity + Home Page + Products + Product Pages + Checkout + Thank You + Policies + Settings</p></div><span class="pill store-home-status status-${esc(status)}">${esc(status)}</span></div>
  <div class="store-editor-grid">
    <form id="store-identity-form" class="panel store-editor-panel">
      <div class="panel-head"><div><h2>Store Identity</h2><span>Shared branding used across the customer website.</span></div></div>
      <label class="field">Store Name *<input name="storeName" value="${esc(data.store.name)}" maxlength="100" required></label>
      <div class="form-columns"><label class="field">Store Logo<input name="logo" type="file" accept="image/png,image/jpeg,image/webp"><small>${storefront.logo?.dataUrl ? "A logo is connected. Choose a file to replace it." : "PNG, JPEG, or WebP. Required before publishing."}</small></label><label class="field">Favicon<input name="favicon" type="file" accept="image/png,image/jpeg,image/webp"><small>${storefront.favicon?.dataUrl ? "A favicon is connected." : "Optional browser-tab icon."}</small></label></div>
      <label class="field">Logo Alt Text<input name="logoAlt" value="${esc(storefront.logo?.alt || data.store.name)}" maxlength="240"></label>
      <div class="form-columns"><label class="field">Primary Color<input name="primaryColor" type="color" value="${esc(branding.primaryColor || "#0f5132")}"></label><label class="field">Secondary Color<input name="secondaryColor" type="color" value="${esc(branding.secondaryColor || "#f4efe5")}"></label></div>
      <div class="form-columns"><label class="field">Heading Font<select name="headingFont">${fontOptions(branding.headingFont || "Inter")}</select></label><label class="field">Body Font<select name="bodyFont">${fontOptions(branding.bodyFont || "Inter")}</select></label></div>
      <button class="primary" type="submit">Save Identity</button>
    </form>
    <form id="store-home-form" class="panel store-editor-panel">
      <div class="panel-head"><div><h2>Home Page</h2><span>Announcement, navigation, banner, featured products, and footer.</span></div></div>
      <fieldset class="store-editor-fieldset"><legend>Announcement Bar</legend><label class="toggle-row"><span><strong>Enable announcement</strong><small>Show a store-wide message above the header.</small></span><input name="announcementEnabled" type="checkbox" ${announcement.enabled ? "checked" : ""}></label><label class="field">Message<input name="announcementMessage" value="${esc(announcement.message || "")}" placeholder="Free delivery on prepaid and COD orders"></label><div class="form-columns"><label class="field">Link Text<input name="announcementLinkText" value="${esc(announcement.linkText || "")}" placeholder="Shop now"></label><label class="field">Link Destination<input name="announcementLinkUrl" value="${esc(announcement.linkUrl || "")}" placeholder="/s/${esc(data.store.slug)}#products"></label></div><div class="form-columns"><label class="field">Background<input name="announcementBackground" type="color" value="${esc(announcement.backgroundColor || "#0f5132")}"></label><label class="field">Text Color<input name="announcementTextColor" type="color" value="${esc(announcement.textColor || "#ffffff")}"></label></div></fieldset>
      <fieldset class="store-editor-fieldset"><legend>Header</legend><label class="toggle-row store-sticky-control"><span><strong>Sticky header</strong><small>Keep your menu in reach as customers scroll.</small></span><input name="headerSticky" type="checkbox" role="switch" ${header.sticky ? "checked" : ""}></label><div class="store-field-group-title"><strong>Navigation links</strong><small>Give each link a name and choose where it goes.</small></div><div id="store-menu-links">${(header.links || []).map(link => storeMenuRow(link)).join("")}</div><p class="store-menu-empty" id="store-menu-empty">Your store uses its default navigation. Add a link to create a custom menu.</p><button type="button" class="secondary store-add-link" id="store-menu-add">+ Add menu link</button><small class="store-field-hint">Up to 8 links. Use the arrows to change their order.</small></fieldset>
      <fieldset class="store-editor-fieldset"><legend>Banner</legend><label class="toggle-row store-section-visibility"><span><strong>Show banner</strong><small>Display this section on the homepage.</small></span><input name="bannerVisible" type="checkbox" role="switch" ${home.bannerVisible !== false ? "checked" : ""}></label><div class="store-banner-media"><div class="store-field-group-title"><strong>Banner image</strong><small>The first image customers see on your homepage.</small></div><div class="store-banner-image"><img id="store-banner-image-preview" src="${esc(home.banner?.dataUrl || "")}" alt="Current homepage banner" ${home.banner?.dataUrl ? "" : "hidden"}><span id="store-banner-placeholder" ${home.banner?.dataUrl ? "hidden" : ""}>Add your homepage image</span></div><label class="field store-media-upload">Choose banner image<input name="bannerImage" type="file" accept="image/png,image/jpeg,image/webp"><small id="store-banner-file-name">${home.banner?.dataUrl ? "Current banner saved · choose an image to replace it" : "PNG, JPG or WebP · required before publishing"}</small></label></div><div class="store-field-group-title"><strong>Content and action</strong><small>Keep your message short and give shoppers a clear next step.</small></div><label class="field">Heading<input name="bannerHeading" value="${esc(home.heading || "")}" placeholder="A better daily ritual"></label><label class="field">Subheading<textarea name="bannerSubheading" rows="3">${esc(home.subheading || "")}</textarea></label><div class="form-columns"><label class="field">Button text<input name="buttonText" value="${esc(home.buttonText || "")}" placeholder="Shop now"></label><label class="field">Button action<select name="buttonTargetType"><option value="product" ${targetType === "product" ? "selected" : ""}>Open product</option><option value="page" ${targetType === "page" ? "selected" : ""}>Open product page</option><option value="url" ${targetType === "url" ? "selected" : ""}>Open web address</option></select></label></div><label class="field" data-store-target="product">Product<select name="buttonProductId">${targetOptions(data.products, home.buttonTarget?.id, (item) => item.name)}</select></label><label class="field" data-store-target="page">Product page<select name="buttonPageId">${targetOptions(data.pages, home.buttonTarget?.id, (item) => item.title)}</select></label><label class="field" data-store-target="url">Web address<input name="buttonTargetUrl" value="${esc(targetType === "url" ? home.buttonTargetUrl || home.buttonTarget?.url || "" : "")}" placeholder="https://example.com or /store-path"></label></fieldset>
      <fieldset class="store-editor-fieldset"><legend>Featured Products</legend><label class="toggle-row store-section-visibility"><span><strong>Show featured products</strong><small>Display selected products on the homepage.</small></span><input name="featuredVisible" type="checkbox" role="switch" ${home.featuredVisible !== false ? "checked" : ""}></label><label class="field">Section heading<input name="sectionHeading" value="${esc(home.sectionHeading || "Featured Products")}"></label><div class="store-product-choices">${products || "<p>Create a product before configuring the homepage.</p>"}</div></fieldset>
      <fieldset class="store-editor-fieldset"><legend>Footer</legend><label class="toggle-row"><span><strong>Show Product Links</strong><small>List featured products in the footer.</small></span><input name="footerShowProducts" type="checkbox" ${footer.showProducts !== false ? "checked" : ""}></label><label class="field">Contact Information<textarea name="footerContact" rows="3" maxlength="500" placeholder="Email, phone, or support hours">${esc(footer.contact || "")}</textarea></label><p class="notice">Published policy links are added automatically.</p></fieldset>
      <fieldset class="store-editor-fieldset store-code-panel"><legend>Theme CSS</legend><p class="store-code-note">Add safe CSS to fine-tune this theme. External files and script-like rules are blocked.</p><label class="field">Custom CSS<textarea name="customCss" rows="18" spellcheck="false" placeholder=".store-home-hero {\n  min-height: 520px;\n}">${esc(home.customCss || "")}</textarea></label></fieldset>
      <fieldset class="store-editor-fieldset" data-store-section-panel="theme-settings"><legend>Theme settings</legend><div class="store-field-group-title"><strong>Layout</strong><small>These settings apply across the entire storefront.</small></div><label class="field">Page width <span data-range-output="pageWidth">${Number(themeSettings.pageWidth||1200)} px</span><input name="themePageWidth" type="range" min="900" max="1600" step="20" value="${Number(themeSettings.pageWidth||1200)}"></label><label class="field">Section spacing <span data-range-output="sectionSpacing">${Number(themeSettings.sectionSpacing||64)} px</span><input name="themeSectionSpacing" type="range" min="24" max="120" step="4" value="${Number(themeSettings.sectionSpacing||64)}"></label><label class="field">Button corners <span data-range-output="buttonRadius">${Number(themeSettings.buttonRadius??8)} px</span><input name="themeButtonRadius" type="range" min="0" max="40" value="${Number(themeSettings.buttonRadius??8)}"></label><label class="field">Card corners <span data-range-output="cardRadius">${Number(themeSettings.cardRadius??8)} px</span><input name="themeCardRadius" type="range" min="0" max="40" value="${Number(themeSettings.cardRadius??8)}"></label><label class="field">Products per row<select name="themeProductColumns"><option value="2" ${Number(themeSettings.productColumns||3)===2?'selected':''}>2</option><option value="3" ${Number(themeSettings.productColumns||3)===3?'selected':''}>3</option><option value="4" ${Number(themeSettings.productColumns||3)===4?'selected':''}>4</option></select></label><label class="toggle-row"><span><strong>Animations</strong><small>Use subtle motion when storefront content appears.</small></span><input name="themeAnimations" type="checkbox" role="switch" ${themeSettings.animations!==false?'checked':''}></label></fieldset>
      ${customSections.map(section=>themeSectionPanel(section,esc,workspaceIcon)).join('')}
      <input name="homeSectionOrder" type="hidden" value='${esc(JSON.stringify(home.sectionOrder || ["banner", "featured"]))}'>
      <div class="store-editor-actions"><button class="secondary" type="submit">Save Draft</button><button class="primary" id="publish-store-home" type="button">Publish Store</button></div>
    </form>
  </div>`;

  const settingsGrid = $(".store-editor-grid");
  const storeSections = [
    ["identity", "Branding", "Shared across your website"],
    ["announcement", "Announcement", "Shared across your website"],
    ["header", "Header & menu", "Shared across your website"],
    ["banner", "Banner", "Homepage"],
    ["featured", "Featured products", "Homepage"],
    ["footer", "Footer", "Shared across your website"],
    ["connections", "Products & pages", "Product page connections"],
    ["theme-css", "Theme CSS", "Advanced theme styles"],
    ["theme-settings", "Theme settings", "Colors, layout and motion"],
    ...customSections.map(section=>[section.id,themeSectionLabel(section.type),'Homepage section']),
  ];
  const connectedProducts = (storefront.products || []);
  const connectionRows = (data.products || []).map((product) => {
    const connected = connectedProducts.find((item) => item.id === product.id);
    const pages = (data.pages || []).filter((page) => page.productId === product.id && page.status === "published");
    return `<article class="store-connection-row"><div class="store-connection-identity">${workspaceIcon('package')}<div><strong>${esc(product.name)}</strong><small>${connected?.status === "published" ? "Published" : "Not published"}</small></div></div><label class="field">Customer page<select data-store-page-for="${product.id}" aria-label="Page for ${esc(product.name)}"><option value="">Choose a published page</option>${pages.map((page) => `<option value="${page.id}" ${page.id === connected?.pageId ? "selected" : ""}>${esc(page.title)}</option>`).join("")}</select></label><div class="store-connection-actions"><button type="button" class="primary" data-store-connect="${product.id}" ${pages.length ? "" : "disabled"}>Save page</button><button type="button" class="icon-button" data-store-open-editor="${product.id}" title="Edit page" aria-label="Edit page for ${esc(product.name)}">${workspaceIcon('paintbrush')}</button><button type="button" class="icon-button" data-store-product-data="${product.id}" title="Product details" aria-label="Product details for ${esc(product.name)}">${workspaceIcon('settings-2')}</button>${connected?.status === "published" ? `<a class="icon-button" target="_blank" rel="noopener" href="${esc(storeUrl(`/products/${encodeURIComponent(product.slug)}`))}" title="View product" aria-label="View ${esc(product.name)}">${workspaceIcon('arrow-up-right')}</a>` : ""}</div>${pages.length ? '' : '<small>No published page available.</small>'}</article>`;
  }).join("");
  const pagePreviews = (data.pages || []).map((page) => `<option value="/api/stores/${storeId}/pages/${page.id}/preview">${esc(page.title)}${page.status !== "published" ? " (draft)" : ""}</option>`).join("");
  const sectionInfo = Object.fromEntries(storeSections.map(([id, label, scope]) => [id, { label, scope }]));
  const sectionOrder = home.sectionOrder || ["banner", "featured",...customSections.map(section=>section.id)];
  const sectionRow = (id) => {
    const visible = id === "banner" ? home.bannerVisible !== false : id === 'featured' ? home.featuredVisible !== false : customSections.find(section=>section.id===id)?.visible !== false;
    return `<div class="store-section-row" data-home-section="${id}"><button class="store-section-drag" type="button" title="Move ${esc(sectionInfo[id].label)}" aria-label="Move ${esc(sectionInfo[id].label)}">${workspaceIcon('grip-vertical')}</button><button type="button" data-store-section="${id}">${esc(sectionInfo[id].label)}</button><button class="store-section-eye" type="button" data-store-visibility="${id}" aria-pressed="${visible}" title="${visible ? "Hide" : "Show"} ${esc(sectionInfo[id].label)}" aria-label="${visible ? "Hide" : "Show"} ${esc(sectionInfo[id].label)}">${workspaceIcon(visible ? 'eye' : 'eye-off')}</button><span class="store-section-move"><button type="button" data-section-move="up" aria-label="Move ${esc(sectionInfo[id].label)} up">${workspaceIcon('chevron-up')}</button><button type="button" data-section-move="down" aria-label="Move ${esc(sectionInfo[id].label)} down">${workspaceIcon('chevron-down')}</button></span></div>`;
  };
  const themeToolbar = themeEditor ? `<header class="store-editor-toolbar"><div class="store-editor-toolbar-start"><button type="button" class="icon-button" id="back-online-themes" title="Back to themes" aria-label="Back to themes">${workspaceIcon('chevron-left')}</button><div class="store-editor-title"><strong>${esc(data.store.name)}</strong><span id="store-editor-status">${status === "published" ? "Published" : "Draft saved"}</span></div></div><label class="store-page-selector"><span class="sr-only">Preview page</span><select id="store-preview-page"><option value="/api/stores/${storeId}/storefront/preview">Home page</option>${pagePreviews}</select></label><div class="store-editor-toolbar-end"><div class="store-preview-devices" role="group" aria-label="Store preview size"><button type="button" class="icon-button" data-store-preview-size="desktop" aria-pressed="true" title="Desktop preview" aria-label="Desktop preview">${workspaceIcon('monitor')}</button><button type="button" class="icon-button" data-store-preview-size="mobile" aria-pressed="false" title="Mobile preview" aria-label="Mobile preview">${workspaceIcon('smartphone')}</button></div><button type="button" class="icon-button" id="store-editor-undo" title="Undo" aria-label="Undo" disabled>${workspaceIcon('undo-2')}</button><button type="button" class="icon-button" id="store-editor-redo" title="Redo" aria-label="Redo" disabled>${workspaceIcon('redo-2')}</button><details class="store-editor-more"><summary class="icon-button" title="More actions" aria-label="More actions">${workspaceIcon('ellipsis')}</summary><div><button type="button" data-open-theme-css>${workspaceIcon('code-xml')}<span>Edit theme CSS</span></button>${liveStoreAction || `<a href="/api/stores/${storeId}/storefront/preview/open" target="_blank" rel="noopener">${workspaceIcon('eye')}<span>Open saved preview</span></a>`}</div></details><div id="store-editor-primary-actions"></div></div></header><div class="store-editor-mobile-tabs" role="tablist" aria-label="Editor panels"><button type="button" role="tab" data-editor-tab="sections" aria-selected="true">Sections</button><button type="button" role="tab" data-editor-tab="preview" aria-selected="false">Preview</button><button type="button" role="tab" data-editor-tab="settings" aria-selected="false">Settings</button></div>` : "";
  const navigation = themeEditor
    ? `<nav class="store-section-nav" aria-label="Store sections"><div class="store-section-nav-head"><strong>Home page</strong><button type="button" class="icon-button" id="store-preview-refresh" title="Refresh preview" aria-label="Refresh preview">${workspaceIcon('redo-2')}</button></div><div class="store-section-group"><span>Theme</span><button type="button" data-store-section="identity">${workspaceIcon('paintbrush')}<span>Branding</span></button><button type="button" data-store-section="theme-settings">${workspaceIcon('settings-2')}<span>Theme settings</span></button><button type="button" data-store-section="theme-css">${workspaceIcon('code-xml')}<span>Custom CSS</span></button></div><div class="store-section-group"><span>Header</span><button type="button" data-store-section="announcement">${workspaceIcon('panels-top-left')}<span>Announcement</span></button><button type="button" data-store-section="header">${workspaceIcon('menu')}<span>Header and menu</span></button></div><div class="store-section-group"><span>Template</span><div class="store-home-section-list">${sectionOrder.map(sectionRow).join("")}</div><button type="button" class="store-add-section" id="store-add-section">${workspaceIcon('plus')}<span>Add section</span></button></div><div class="store-section-group"><span>Footer</span><button type="button" data-store-section="footer">${workspaceIcon('panels-top-left')}<span>Footer</span></button></div><div class="store-section-group"><span>Connections</span><button type="button" data-store-section="connections">${workspaceIcon('package')}<span>Products and pages</span></button></div></nav>`
    : `<nav class="store-section-nav" aria-label="Store sections"><strong>Website sections</strong>${storeSections.filter(([id]) => id !== "theme-css").map(([id, label]) => `<button type="button" data-store-section="${id}">${label}</button>`).join("")}</nav>`;
  const previewToolbarMarkup = themeEditor ? "" : `<div class="store-preview-toolbar"><label class="field">Website preview<select id="store-preview-page"><option value="/api/stores/${storeId}/storefront/preview">Home page</option>${pagePreviews}</select></label><div class="store-preview-devices" role="group" aria-label="Store preview size"><button type="button" class="secondary" data-store-preview-size="desktop" aria-pressed="true">Desktop</button><button type="button" class="secondary" data-store-preview-size="mobile" aria-pressed="false">Mobile</button></div><button type="button" class="secondary" id="store-preview-refresh">Refresh preview</button></div><p class="helper-text">Preview shows your saved settings. Save your changes to update it.</p>`;
  settingsGrid.insertAdjacentHTML("beforebegin", `${themeToolbar}<section class="store-workspace" aria-label="Store website editor">${navigation}<section class="store-preview-panel">${previewToolbarMarkup}<div class="store-preview-frame" id="store-preview-frame"><iframe id="store-website-preview" title="Store website preview" src="/api/stores/${storeId}/storefront/preview"></iframe></div></section><div class="store-settings-area"><div class="store-section-heading"><button type="button" class="icon-button store-settings-back" data-editor-tab="sections" title="Back to sections" aria-label="Back to sections">${workspaceIcon('chevron-left')}</button><div><h2 id="store-section-title"></h2><p id="store-section-scope"></p></div></div><div id="store-settings-host"></div><section id="store-connections" class="panel" hidden>${connectionRows || '<p class="empty">No products yet.</p>'}</section></div></section>`);
  if (themeEditor) $("#back-online-themes").onclick = () => navigateTo('/online-store/themes');
  $("#show-store-admin-preview")?.addEventListener("click", () => {
    const preview = $("#store-preview-frame");
    preview.scrollIntoView({ behavior: "smooth", block: "center" });
    $("#store-website-preview").focus({ preventScroll: true });
  });
  $("#store-settings-host").append(settingsGrid);
  const storeFieldsets = () => [...$("#store-home-form").querySelectorAll(".store-editor-fieldset")];
  ["announcement", "header", "banner", "featured", "footer", "theme-css"].forEach((id, index) => { storeFieldsets()[index].dataset.storeSectionPanel = id; });
  const setEditorTab = (tab) => {
    const workspace = $(".store-workspace");
    if (!workspace) return;
    workspace.dataset.mobilePanel = tab;
    document.querySelectorAll("[data-editor-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.editorTab === tab)));
  };
  const highlightStorePreviewSection = (id) => {
    const preview = $("#store-website-preview")?.contentDocument;
    if (!preview?.body) return;
    let style = preview.querySelector("#commera-editor-selection-style");
    if (!style) {
      style = preview.createElement("style");
      style.id = "commera-editor-selection-style";
      style.textContent = '[data-store-editor-selected]{outline:3px solid #148a8e!important;outline-offset:-3px;position:relative}';
      preview.head.append(style);
    }
    preview.querySelectorAll("[data-store-editor-selected]").forEach((element) => element.removeAttribute("data-store-editor-selected"));
    const selected = preview.querySelector(`[data-store-editor-section="${id}"]`);
    if (selected) selected.setAttribute("data-store-editor-selected", "");
  };
  const showStoreSection = (id) => {
    const selected = sectionInfo[id] || sectionInfo.banner;
    storeEditorSection = sectionInfo[id] ? id : 'banner';
    $("#store-section-title").textContent = selected.label;
    $("#store-section-scope").textContent = selected.scope;
    $("#store-identity-form").hidden = id !== "identity";
    $("#store-home-form").hidden = ["identity", "connections"].includes(id);
    $("#store-connections").hidden = id !== "connections";
    storeFieldsets().forEach((fieldset) => { fieldset.hidden = fieldset.dataset.storeSectionPanel !== storeEditorSection; });
    document.querySelectorAll("[data-store-section]").forEach((button) => {
      button.classList.toggle("active", button.dataset.storeSection === id);
      button.setAttribute("aria-current", button.dataset.storeSection === id ? "true" : "false");
    });
    document.querySelectorAll("[data-home-section]").forEach((row) => row.classList.toggle("active", row.dataset.homeSection === id));
    if (themeEditor && innerWidth < 800) setEditorTab("settings");
    highlightStorePreviewSection(id);
  };
  document.querySelectorAll("[data-editor-tab]").forEach((button) => { button.onclick = () => setEditorTab(button.dataset.editorTab); });
  $("[data-open-theme-css]")?.addEventListener("click", () => {
    $(".store-editor-more")?.removeAttribute("open");
    showStoreSection("theme-css");
  });
  document.querySelectorAll("[data-store-section]").forEach((button) => { button.onclick = () => showStoreSection(button.dataset.storeSection); });
  showStoreSection(storeEditorSection);
  const previewFrame = $("#store-website-preview");
  const previewContainer = $('#store-preview-frame');
  if (themeEditor && innerWidth <= 800) previewContainer.classList.add('is-mobile');
  const sizeStorePreview = () => {
    const width = previewContainer.classList.contains('is-mobile') ? 390 : 1100;
    const available = previewContainer.clientWidth;
    if (!available) return;
    const scale = Math.min(1, available / width);
    previewFrame.style.width = `${width}px`;
    previewFrame.style.maxWidth = 'none';
    previewFrame.style.height = `${previewContainer.clientHeight / scale}px`;
    previewFrame.style.transform = `scale(${scale})`;
    previewFrame.style.left = `${Math.max(0, (available - width * scale) / 2)}px`;
  };
  if (typeof ResizeObserver !== 'undefined') {
    storePreviewResizeObserver = new ResizeObserver(sizeStorePreview);
    storePreviewResizeObserver.observe(previewContainer);
  }
  if (previewContainer.classList.contains('is-mobile')) {
    document.querySelectorAll("[data-store-preview-size]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.storePreviewSize === "mobile")));
  }
  sizeStorePreview();
  const syncStorePreview = () => {
    if (!$("#store-preview-page")?.value.includes("/storefront/preview")) return;
    const preview = previewFrame.contentDocument;
    if (!preview?.body) return;
    const identity = $("#store-identity-form"), form = $("#store-home-form");
    preview.body.style.setProperty("--store-primary", identity.elements.primaryColor.value);
    preview.body.style.setProperty("--store-secondary", identity.elements.secondaryColor.value);
    preview.body.style.setProperty("--store-heading-font", identity.elements.headingFont.value);
    preview.body.style.setProperty("--store-body-font", identity.elements.bodyFont.value);
    preview.body.style.setProperty("--store-page-width", `${form.elements.themePageWidth.value}px`);
    preview.body.style.setProperty("--store-section-spacing", `${form.elements.themeSectionSpacing.value}px`);
    preview.body.style.setProperty("--store-button-radius", `${form.elements.themeButtonRadius.value}px`);
    preview.body.style.setProperty("--store-card-radius", `${form.elements.themeCardRadius.value}px`);
    preview.body.style.setProperty("--store-product-columns", form.elements.themeProductColumns.value);
    preview.body.classList.toggle('store-motion-disabled',!form.elements.themeAnimations.checked);
    const storeName = identity.elements.storeName.value;
    const logoAlt = identity.elements.logoAlt.value || storeName;
    preview.title = storeName;
    preview.querySelectorAll(".store-site-brand strong,.store-home-hero-copy .eyebrow").forEach((node) => { node.textContent = storeName; });
    preview.querySelectorAll(".store-site-brand img").forEach((image) => { image.alt = logoAlt; });
    const copyright = preview.querySelector(".store-policy-footer > small");
    if (copyright) copyright.textContent = `© ${new Date().getFullYear()} ${storeName}`;

    const headerElement = preview.querySelector(".store-site-header");
    if (headerElement) {
      headerElement.classList.toggle("is-sticky", form.elements.headerSticky.checked);
      let links = [];
      try { links = readStoreMenuLinks(form); } catch {}
      if (links.length) {
        const markup = links.map((link) => `<a href="${esc(link.url)}">${esc(link.label)}</a>`).join("");
        headerElement.querySelectorAll("nav").forEach((nav) => { nav.innerHTML = markup; });
      }
    }

    let announcementElement = preview.querySelector(".store-announcement");
    if (form.elements.announcementEnabled.checked && !announcementElement && headerElement) {
      announcementElement = preview.createElement("aside");
      announcementElement.className = "store-announcement";
      announcementElement.dataset.storeEditorSection = "announcement";
      announcementElement.innerHTML = "<span></span><a></a>";
      headerElement.before(announcementElement);
    }
    if (announcementElement) {
      announcementElement.hidden = !form.elements.announcementEnabled.checked;
      announcementElement.style.setProperty("--announcement-bg", form.elements.announcementBackground.value);
      announcementElement.style.setProperty("--announcement-text", form.elements.announcementTextColor.value);
      announcementElement.querySelector("span").textContent = form.elements.announcementMessage.value;
      let link = announcementElement.querySelector("a");
      if (!link) { link = preview.createElement("a"); announcementElement.append(link); }
      link.textContent = form.elements.announcementLinkText.value;
      link.href = form.elements.announcementLinkUrl.value || "#";
      link.hidden = !form.elements.announcementLinkText.value;
    }

    const banner = preview.querySelector('[data-store-editor-section="banner"]');
    if (banner) {
      banner.hidden = !form.elements.bannerVisible.checked;
      const copy = banner.querySelector(".store-home-hero-copy");
      let heading = copy?.querySelector("h1"), subheading = copy?.querySelector("p"), button = copy?.querySelector(".hero-cta");
      if (!heading && copy) { heading = preview.createElement("h1"); copy.querySelector(".eyebrow")?.after(heading); }
      if (!subheading && copy) { subheading = preview.createElement("p"); heading?.after(subheading); }
      if (!button && copy) { button = preview.createElement("a"); button.className = "hero-cta"; copy.append(button); }
      if (heading) { heading.textContent = form.elements.bannerHeading.value; heading.hidden = !form.elements.bannerHeading.value; }
      if (subheading) { subheading.textContent = form.elements.bannerSubheading.value; subheading.hidden = !form.elements.bannerSubheading.value; }
      if (button) {
        const type = form.elements.buttonTargetType.value;
        let href = "#";
        if (type === "product") {
          const product = (data.products || []).find((item) => item.id === Number(form.elements.buttonProductId.value));
          if (product) href = `/s/${encodeURIComponent(data.store.slug)}/products/${encodeURIComponent(product.slug)}`;
        } else if (type === "page") {
          const page = (data.pages || []).find((item) => item.id === Number(form.elements.buttonPageId.value));
          if (page) href = `/s/${encodeURIComponent(data.store.slug)}/${encodeURIComponent(page.slug)}`;
        } else {
          const value = form.elements.buttonTargetUrl.value.trim();
          if (/^(https?:\/\/|\/|#)/i.test(value)) href = value;
        }
        button.textContent = form.elements.buttonText.value;
        button.href = href;
        button.hidden = !form.elements.buttonText.value;
      }
      const source = form.querySelector("#store-banner-image-preview")?.src;
      let image = banner.querySelector(".store-home-banner");
      if (source && !image) { image = preview.createElement("img"); image.className = "store-home-banner"; image.alt = form.elements.bannerHeading.value; banner.prepend(image); }
      if (source && image) image.src = source;
    }
    const featured = preview.querySelector('[data-store-editor-section="featured"]');
    if (featured) {
      featured.hidden = !form.elements.featuredVisible.checked;
      const heading = featured.querySelector("h2");
      if (heading) heading.textContent = form.elements.sectionHeading.value;
      const selected = new Set([...form.querySelectorAll('[name="featuredProductIds"]:checked')].map((input) => input.value));
      featured.querySelectorAll("[data-product-id]").forEach((card) => { card.hidden = !selected.has(card.dataset.productId); });
    }
    const footerElement = preview.querySelector('[data-store-editor-section="footer"]');
    if (footerElement) {
      const contact = footerElement.querySelector("#contact");
      let paragraph = contact?.querySelector("p");
      if (!paragraph && contact) { paragraph = preview.createElement("p"); contact.append(paragraph); }
      if (paragraph) { paragraph.textContent = form.elements.footerContact.value; paragraph.hidden = !form.elements.footerContact.value; }
      const productNav = footerElement.querySelector('nav[aria-label="Products"]');
      if (productNav) productNav.hidden = !form.elements.footerShowProducts.checked;
    }
    const contentElement = preview.querySelector(".storefront-home-content");
    if (contentElement) {
      const sections=readThemeSectionState(form),ids=new Set(sections.map(section=>section.id));
      contentElement.querySelectorAll('.theme-custom-section').forEach(section=>{if(!ids.has(section.dataset.storeEditorSection))section.remove();});
      for(const section of sections) {
        const template=preview.createElement('template');template.innerHTML=clientSectionMarkup(section,esc);
        const fresh=template.content.firstElementChild,current=contentElement.querySelector(`[data-store-editor-section="${section.id}"]`);
        if(current)current.replaceWith(fresh);else contentElement.append(fresh);
      }
      let order = ["banner", "featured"];
      try { order = JSON.parse(form.elements.homeSectionOrder.value); } catch {}
      order.forEach((id) => {
        const section = preview.querySelector(`[data-store-editor-section="${id}"]`);
        if (section) contentElement.append(section);
      });
    }
    let customStyle = preview.querySelector("#commera-theme-custom-style");
    if (!customStyle) { customStyle = preview.createElement("style"); customStyle.id = "commera-theme-custom-style"; preview.head.append(customStyle); }
    const css = form.elements.customCss.value;
    customStyle.textContent = /<\/?style\b|@import\b|(?:url|image-set)\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:/i.test(css) ? "" : css;
    highlightStorePreviewSection(storeEditorSection);
  };
  // In the editor, preview clicks select settings rather than running checkout.
  const wireStorePreview = () => {
    const preview = previewFrame.contentDocument;
    if (!preview?.body) return;
    syncStorePreview();
    preview.addEventListener("submit", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    preview.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = event.target;
      const section = target.closest?.("[data-store-editor-section]");
      if (section) showStoreSection(section.dataset.storeEditorSection);
    }, true);
    highlightStorePreviewSection(storeEditorSection);
  };
  previewFrame.addEventListener("load", wireStorePreview);
  wireStorePreview();
  $("#store-preview-page").onchange = (event) => {
    $("#store-website-preview").src = event.target.value;
    if (!event.target.value.includes("/storefront/preview")) showStoreSection("connections");
  };
  $("#store-preview-refresh").onclick = () => { $("#store-website-preview").src = $("#store-preview-page").value; };
  document.querySelectorAll("[data-store-preview-size]").forEach((button) => {
    button.onclick = () => {
      $("#store-preview-frame").classList.toggle("is-mobile", button.dataset.storePreviewSize === "mobile");
      sizeStorePreview();
      document.querySelectorAll("[data-store-preview-size]").forEach((item) => { item.setAttribute("aria-pressed", String(item === button)); });
    };
  });
  document.querySelectorAll("[data-store-connect]").forEach((button) => {
    button.onclick = async () => {
      const productId = Number(button.dataset.storeConnect);
      const pageId = Number(document.querySelector(`[data-store-page-for="${productId}"]`).value);
      if (!pageId) return toast("Choose a published product page first");
      button.disabled = true;
      try {
        await api(`/api/stores/${storeId}/storefront/products/${productId}/page`, { method: "PATCH", body: JSON.stringify({ pageId }) });
        toast("Product page connection saved");
        await load();
      } catch (error) { toast(error.message); button.disabled = false; }
    };
  });
  document.querySelectorAll("[data-store-open-editor]").forEach((button) => {
    button.onclick = () => {
      const productId = Number(button.dataset.storeOpenEditor);
      const pageId = Number(document.querySelector(`[data-store-page-for="${productId}"]`).value);
      navigateTo(pageId ? `/product-pages/${pageId}/edit` : `/products/${productId}`);
    };
  });
  document.querySelectorAll("[data-store-product-data]").forEach((button) => {
    button.onclick = () => navigateTo(`/products/${Number(button.dataset.storeProductData)}`);
  });

  const identityForm = $("#store-identity-form"),
    homeForm = $("#store-home-form"),
    asset = async (file) =>
      file
        ? { name: file.name, type: file.type, data: await fileToBase64(file) }
        : undefined;
  // Keep ordering valid even when an older cached page omitted the hidden value.
  if (!homeForm.elements.homeSectionOrder.value) {
    homeForm.elements.homeSectionOrder.value = JSON.stringify(sectionOrder);
  }
  const saveIdentity = async () => {
      const values = Object.fromEntries(new FormData(identityForm)),
        payload = {
          storeName: values.storeName,
          logoAlt: values.logoAlt,
          primaryColor: values.primaryColor,
          secondaryColor: values.secondaryColor,
          headingFont: values.headingFont,
          bodyFont: values.bodyFont,
        },
        logo = await asset(identityForm.elements.logo.files[0]),
        favicon = await asset(identityForm.elements.favicon.files[0]);
      if (logo) payload.logo = logo;
      if (favicon) payload.favicon = favicon;
      await api(`/api/stores/${storeId}/storefront/branding`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
  };
  const syncTarget = () => {
    const type = homeForm.elements.buttonTargetType.value;
    homeForm.querySelectorAll("[data-store-target]").forEach(
      (field) => (field.hidden = field.dataset.storeTarget !== type),
    );
  };
  homeForm.elements.buttonTargetType.onchange = syncTarget;
  syncTarget();
  const saveHome = async () => {
    const values = Object.fromEntries(new FormData(homeForm)),
      type = values.buttonTargetType,
      headerLinksValue = readStoreMenuLinks(homeForm),
      payload = {
        bannerHeading: values.bannerHeading,
        bannerSubheading: values.bannerSubheading,
        buttonText: values.buttonText,
        buttonTarget:
          type === "url"
            ? { type, url: values.buttonTargetUrl }
            : {
                type,
                id: Number(
                  type === "page" ? values.buttonPageId : values.buttonProductId,
                ),
              },
        sectionHeading: values.sectionHeading,
        featuredProductIds: [
          ...homeForm.querySelectorAll('[name="featuredProductIds"]:checked'),
        ].map((input) => Number(input.value)),
        announcementEnabled: homeForm.elements.announcementEnabled.checked,
        announcementMessage: values.announcementMessage,
        announcementLinkText: values.announcementLinkText,
        announcementLinkUrl: values.announcementLinkUrl,
        announcementBackground: values.announcementBackground,
        announcementTextColor: values.announcementTextColor,
        headerLinks: headerLinksValue,
        headerSticky: homeForm.elements.headerSticky.checked,
        footerContact: values.footerContact,
        footerShowProducts: homeForm.elements.footerShowProducts.checked,
        bannerVisible: homeForm.elements.bannerVisible.checked,
        featuredVisible: homeForm.elements.featuredVisible.checked,
        sectionOrder: (() => {
          try {
            const order = JSON.parse(values.homeSectionOrder || "[]");
            return order.length ? order : [...sectionOrder];
          } catch {
            return [...sectionOrder];
          }
        })(),
        customCss: values.customCss,
        customSections: await readThemeSections(homeForm,asset),
        themeSettings: {
          pageWidth:Number(values.themePageWidth),
          sectionSpacing:Number(values.themeSectionSpacing),
          buttonRadius:Number(values.themeButtonRadius),
          cardRadius:Number(values.themeCardRadius),
          productColumns:Number(values.themeProductColumns),
          animations:homeForm.elements.themeAnimations.checked,
        },
      },
      bannerImage = await asset(homeForm.elements.bannerImage.files[0]);
    if (bannerImage) payload.bannerImage = bannerImage;
    return api(`/api/stores/${storeId}/storefront/home`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  };
  let identityDirty = false, homeDirty = false, saving = false;
  const updateEditorStatus = (message) => {
    const element = $("#store-editor-status");
    if (element) element.textContent = message;
  };
  const showStoreSaveError = (error) => {
    const status = $("#store-save-error");
    status.textContent = error.message;
    status.hidden = false;
    toast(error.message);
  };
  const saveStoreDraft = async () => {
    if (saving) return false;
    saving = true;
    updateEditorStatus("Saving...");
    $("#store-save-error").hidden = true;
    try {
      if (identityDirty) await saveIdentity();
      if (homeDirty) await saveHome();
      data = await api(`/api/stores/${storeId}/dashboard`);
      identityDirty = homeDirty = productPageDirty = false;
      updateEditorStatus("Draft saved");
      const editorSave = document.querySelector('[data-store-save-all]');
      if (editorSave) editorSave.disabled = true;
      return true;
    } catch (error) { updateEditorStatus("Save failed"); showStoreSaveError(error); return false; }
    finally { saving = false; }
  };
  setupStoreEditorControls(homeForm);
  const namedControls = () => [...identityForm.querySelectorAll("input[name]:not([type=file]),select[name],textarea[name]"), ...homeForm.querySelectorAll("input[name]:not([type=file]),select[name],textarea[name]")];
  const editorSnapshot = () => ({
    controls: namedControls().map((control) => ({ value: control.value, checked: Boolean(control.checked), type: control.type })),
    menu: [...homeForm.querySelectorAll(".store-menu-row")].map((row) => ({ label: row.querySelector("[data-menu-label]").value, url: row.querySelector("[data-menu-url]").value })),
    customSections:readThemeSectionState(homeForm),
  });
  let editorHistory = [editorSnapshot()], editorHistoryIndex = 0, historyTimer = 0, restoringHistory = false;
  const updateHistoryButtons = () => {
    if (!themeEditor) return;
    $("#store-editor-undo").disabled = editorHistoryIndex <= 0;
    $("#store-editor-redo").disabled = editorHistoryIndex >= editorHistory.length - 1;
  };
  const recordEditorHistory = () => {
    if (restoringHistory) return;
    const snapshot = editorSnapshot(), serialized = JSON.stringify(snapshot);
    if (serialized === JSON.stringify(editorHistory[editorHistoryIndex])) return;
    editorHistory = editorHistory.slice(0, editorHistoryIndex + 1);
    editorHistory.push(snapshot);
    if (editorHistory.length > 40) editorHistory.shift();
    editorHistoryIndex = editorHistory.length - 1;
    updateHistoryButtons();
  };
  const scheduleEditorHistory = () => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(recordEditorHistory, 180);
  };
  const updateHomeSectionNavigation = () => {
    const list = $(".store-home-section-list");
    if (!list) return;
    let order = ["banner", "featured",...readThemeSectionState(homeForm).map(section=>section.id)];
    try { order = JSON.parse(homeForm.elements.homeSectionOrder.value); } catch {}
    order.forEach((id) => { const row = list.querySelector(`[data-home-section="${id}"]`); if (row) list.append(row); });
    [...list.children].forEach((row, index, rows) => {
      row.draggable = true;
      row.querySelector('[data-section-move="up"]').disabled = index === 0;
      row.querySelector('[data-section-move="down"]').disabled = index === rows.length - 1;
      const id = row.dataset.homeSection, checkbox = id==='banner'||id==='featured'?homeForm.elements[`${id}Visible`]:homeForm.querySelector(`[data-theme-section-id="${id}"] [data-section-field="visible"]`), eye = row.querySelector("[data-store-visibility]");
      if(!checkbox)return;
      eye.setAttribute("aria-pressed", String(checkbox.checked));
      eye.title = `${checkbox.checked ? "Hide" : "Show"} ${sectionInfo[id].label}`;
      eye.setAttribute("aria-label", eye.title);
      eye.querySelector("img").src = `/icons/${checkbox.checked ? "eye" : "eye-off"}.svg`;
      row.classList.toggle("is-hidden", !checkbox.checked);
    });
    const addSection = $("#store-add-section");
    if(addSection){addSection.disabled=readThemeSectionState(homeForm).length>=12;addSection.title=addSection.disabled?'A homepage can contain up to 12 custom sections':'Add a homepage section';}
  };
  const commitSectionOrder = () => {
    const list = $(".store-home-section-list");
    homeForm.elements.homeSectionOrder.value = JSON.stringify([...list.children].map((row) => row.dataset.homeSection));
    updateHomeSectionNavigation();
    homeForm.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const sectionList = $(".store-home-section-list");
  if (sectionList) {
    let draggedSection = null;
    sectionList.onclick = (event) => {
      const visibility = event.target.closest("[data-store-visibility]");
      if (visibility) {
        const id = visibility.dataset.storeVisibility, checkbox = id==='banner'||id==='featured'?homeForm.elements[`${id}Visible`]:homeForm.querySelector(`[data-theme-section-id="${id}"] [data-section-field="visible"]`);
        checkbox.checked = !checkbox.checked;
        updateHomeSectionNavigation();
        homeForm.dispatchEvent(new Event("input", { bubbles: true }));
        showStoreSection(id);
        if (themeEditor && innerWidth < 800) setEditorTab("sections");
        return;
      }
      const move = event.target.closest("[data-section-move]");
      if (move) {
        const row = move.closest("[data-home-section]");
        if (move.dataset.sectionMove === "up" && row.previousElementSibling) sectionList.insertBefore(row, row.previousElementSibling);
        if (move.dataset.sectionMove === "down" && row.nextElementSibling) sectionList.insertBefore(row.nextElementSibling, row);
        commitSectionOrder();
        return;
      }
      const sectionButton = event.target.closest("[data-store-section]");
      if (sectionButton) showStoreSection(sectionButton.dataset.storeSection);
    };
    sectionList.ondragstart = (event) => { draggedSection = event.target.closest("[data-home-section]"); event.dataTransfer.effectAllowed = "move"; };
    sectionList.ondragover = (event) => { event.preventDefault(); const row = event.target.closest("[data-home-section]"); if (draggedSection && row && row !== draggedSection) sectionList.insertBefore(draggedSection, row.getBoundingClientRect().top + row.offsetHeight / 2 < event.clientY ? row.nextSibling : row); };
    sectionList.ondrop = (event) => { event.preventDefault(); if (draggedSection) commitSectionOrder(); draggedSection = null; };
    sectionList.ondragend = () => { draggedSection = null; };
    updateHomeSectionNavigation();
  }
  const addThemeSection = (section,afterId='') => {
    sectionInfo[section.id]={label:themeSectionLabel(section.type),scope:'Homepage section'};
    const hiddenOrder=homeForm.elements.homeSectionOrder;
    hiddenOrder.insertAdjacentHTML('beforebegin',themeSectionPanel(section,esc,workspaceIcon));
    const rowHtml=sectionRow(section.id),afterRow=afterId&&sectionList.querySelector(`[data-home-section="${afterId}"]`);
    if(afterRow)afterRow.insertAdjacentHTML('afterend',rowHtml);else sectionList.insertAdjacentHTML('beforeend',rowHtml);
    commitSectionOrder();
    homeForm.dispatchEvent(new Event('input',{bubbles:true}));
    showStoreSection(section.id);
  };
  const openThemeSectionPicker = () => {
    modalContent.innerHTML=`<div class="theme-section-picker"><h2>Add section</h2><p>Choose the content you want to add to this page.</p><div>${themeSectionCatalog.map(item=>`<button type="button" data-add-theme-section="${item.type}">${workspaceIcon(item.icon)}<span><strong>${esc(item.label)}</strong><small>${esc(item.description)}</small></span>${workspaceIcon('plus')}</button>`).join('')}</div></div>`;
    syncModalAccessibleName();modal.showModal();
    modalContent.querySelectorAll('[data-add-theme-section]').forEach(button=>button.onclick=()=>{const section=newThemeSection(button.dataset.addThemeSection);modal.close();addThemeSection(section);});
  };
  $("#store-add-section")?.addEventListener("click", openThemeSectionPicker);

  const updateThemeBlockControls = panel => {
    const blocks=[...panel.querySelectorAll('[data-theme-block]')];
    blocks.forEach((block,index)=>{
      block.querySelector('[data-theme-block-number]').textContent=`Block ${index+1}`;
      block.querySelector('[data-theme-block-move="up"]').disabled=index===0;
      block.querySelector('[data-theme-block-move="down"]').disabled=index===blocks.length-1;
    });
  };
  homeForm.querySelectorAll('[data-theme-section-id]').forEach(updateThemeBlockControls);
  homeForm.addEventListener('click',async event=>{
    const panel=event.target.closest('[data-theme-section-id]');if(!panel)return;
    const block=event.target.closest('[data-theme-block]'),move=event.target.closest('[data-theme-block-move]');
    if(move&&block){if(move.dataset.themeBlockMove==='up'&&block.previousElementSibling)block.parentElement.insertBefore(block,block.previousElementSibling);if(move.dataset.themeBlockMove==='down'&&block.nextElementSibling)block.parentElement.insertBefore(block.nextElementSibling,block);updateThemeBlockControls(panel);homeForm.dispatchEvent(new Event('input',{bubbles:true}));return;}
    if(event.target.closest('[data-theme-block-remove]')){block?.remove();updateThemeBlockControls(panel);homeForm.dispatchEvent(new Event('input',{bubbles:true}));return;}
    if(event.target.closest('[data-theme-block-add]')){const type=panel.dataset.themeSectionType,list=panel.querySelector('[data-theme-block-list]');if(list.children.length>=8)return toast('A section can contain up to 8 blocks');const initial=type==='benefits'?{heading:'Benefit',text:'Explain why this matters.'}:type==='testimonials'?{quote:'Add a genuine customer quote.',name:'Customer name'}:{question:'Common question',answer:'Add a clear answer.'};list.insertAdjacentHTML('beforeend',themeSectionBlock(type,initial,esc,workspaceIcon));updateThemeBlockControls(panel);homeForm.dispatchEvent(new Event('input',{bubbles:true}));return;}
    if(event.target.closest('[data-section-image-remove]')){panel.dataset.themeSectionImage='null';panel.dataset.themeSectionImageRemoved='true';panel.querySelector('[data-section-image]').value='';panel.querySelector('.theme-section-image').innerHTML='<span data-section-image-placeholder>Add an image</span>';event.target.closest('[data-section-image-remove]').hidden=true;homeForm.dispatchEvent(new Event('input',{bubbles:true}));return;}
    if(event.target.closest('[data-theme-section-remove]')){const id=panel.dataset.themeSectionId;panel.remove();sectionList.querySelector(`[data-home-section="${id}"]`)?.remove();delete sectionInfo[id];commitSectionOrder();showStoreSection('banner');return;}
    if(event.target.closest('[data-theme-section-duplicate]')){const source=readThemeSectionState(homeForm).find(section=>section.id===panel.dataset.themeSectionId),copy=structuredClone(source);copy.id=`section-${crypto.randomUUID().toLowerCase()}`;copy.heading=`${copy.heading} copy`.slice(0,160);addThemeSection(copy,source.id);}
  });
  homeForm.addEventListener('change',event=>{
    const input=event.target.closest('[data-section-image]');if(!input?.files[0])return;const panel=input.closest('[data-theme-section-id]'),file=input.files[0],reader=new FileReader();reader.onload=()=>{panel.dataset.themeSectionImageRemoved='false';panel.dataset.themeSectionImage=JSON.stringify({name:file.name,type:file.type,dataUrl:reader.result});panel.querySelector('.theme-section-image').innerHTML=`<img src="${reader.result}" alt="Section image" data-section-image-preview>`;panel.querySelector('[data-section-image-remove]').hidden=false;homeForm.dispatchEvent(new CustomEvent('store-preview-image',{bubbles:true}));};reader.readAsDataURL(file);
  });
  let draggedThemeBlock=null;
  homeForm.addEventListener('dragstart',event=>{const block=event.target.closest('[data-theme-block]');if(!block)return;draggedThemeBlock=block;block.classList.add('is-dragging');event.dataTransfer.effectAllowed='move';});
  homeForm.addEventListener('dragover',event=>{const block=event.target.closest('[data-theme-block]');if(!draggedThemeBlock||!block||block===draggedThemeBlock||block.parentElement!==draggedThemeBlock.parentElement)return;event.preventDefault();block.parentElement.insertBefore(draggedThemeBlock,block.getBoundingClientRect().top+block.offsetHeight/2<event.clientY?block.nextSibling:block);});
  homeForm.addEventListener('drop',event=>{if(!draggedThemeBlock)return;event.preventDefault();const panel=draggedThemeBlock.closest('[data-theme-section-id]');draggedThemeBlock.classList.remove('is-dragging');draggedThemeBlock=null;updateThemeBlockControls(panel);homeForm.dispatchEvent(new Event('input',{bubbles:true}));});
  homeForm.addEventListener('dragend',()=>{draggedThemeBlock?.classList.remove('is-dragging');draggedThemeBlock=null;});
  const markStoreDirty = (kind) => {
    if (kind === "identity") identityDirty = true;
    else homeDirty = true;
    productPageDirty = true;
    productPageSaveHandler = saveStoreDraft;
    updateEditorStatus("Unsaved changes");
    const editorSave = document.querySelector('[data-store-save-all]');
    if (editorSave) editorSave.disabled = false;
    const ranges={pageWidth:'themePageWidth',sectionSpacing:'themeSectionSpacing',buttonRadius:'themeButtonRadius',cardRadius:'themeCardRadius'};
    for(const [output,name] of Object.entries(ranges)){const label=homeForm.querySelector(`[data-range-output="${output}"]`);if(label)label.textContent=`${homeForm.elements[name].value} px`;}
    syncTarget();
    syncStorePreview();
    scheduleEditorHistory();
  };
  identityForm.oninput = () => markStoreDirty("identity");
  homeForm.oninput = () => markStoreDirty("home");
  homeForm.addEventListener("store-preview-image", syncStorePreview);
  const restoreEditorHistory = (index) => {
    const snapshot = editorHistory[index];
    if (!snapshot) return;
    restoringHistory = true;
    homeForm.querySelectorAll('[data-theme-section-id]').forEach(panel=>panel.remove());
    sectionList.querySelectorAll('[data-home-section]:not([data-home-section="banner"]):not([data-home-section="featured"])').forEach(row=>{delete sectionInfo[row.dataset.homeSection];row.remove();});
    for(const section of snapshot.customSections||[]){sectionInfo[section.id]={label:themeSectionLabel(section.type),scope:'Homepage section'};homeForm.elements.homeSectionOrder.insertAdjacentHTML('beforebegin',themeSectionPanel(section,esc,workspaceIcon));sectionList.insertAdjacentHTML('beforeend',sectionRow(section.id));}
    homeForm.querySelectorAll('[data-theme-section-id]').forEach(updateThemeBlockControls);
    namedControls().forEach((control, controlIndex) => {
      const saved = snapshot.controls[controlIndex];
      if (!saved) return;
      if (control.type === "checkbox" || control.type === "radio") control.checked = saved.checked;
      else control.value = saved.value;
    });
    homeForm.querySelector("#store-menu-links").innerHTML = snapshot.menu.map(storeMenuRow).join("");
    setupStoreEditorControls(homeForm);
    editorHistoryIndex = index;
    identityDirty = homeDirty = productPageDirty = true;
    productPageSaveHandler = saveStoreDraft;
    updateEditorStatus("Unsaved changes");
    const editorSave = document.querySelector('[data-store-save-all]');
    if (editorSave) editorSave.disabled = false;
    syncTarget();
    updateHomeSectionNavigation();
    syncStorePreview();
    updateHistoryButtons();
    restoringHistory = false;
  };
  if (themeEditor) {
    $("#store-editor-undo").onclick = () => { clearTimeout(historyTimer); recordEditorHistory(); restoreEditorHistory(editorHistoryIndex - 1); };
    $("#store-editor-redo").onclick = () => { clearTimeout(historyTimer); restoreEditorHistory(editorHistoryIndex + 1); };
    updateHistoryButtons();
  }
  identityForm.onsubmit = homeForm.onsubmit = async (event) => {
    event.preventDefault();
    if (await saveStoreDraft()) {
      toast("Store draft saved. Publish when you are ready.");
      previewFrame.src = $("#store-preview-page").value;
    }
  };
  $("#publish-store-home").onclick = async () => {
    try {
      if (!await saveStoreDraft()) return;
      await api(`/api/stores/${storeId}/storefront/home/publish`, {
        method: "POST",
        body: "{}",
      });
      toast("Store published");
      updateEditorStatus("Published");
      previewFrame.src = $("#store-preview-page").value;
    } catch (error) {
      showStoreSaveError(error);
    }
  };
  // Keep draft and publication controls accessible from every section.
  const actionHost = themeEditor ? $("#store-editor-primary-actions") : $(".store-preview-toolbar");
  const saveDraftButton = document.createElement("button");
  saveDraftButton.type = "button";
  saveDraftButton.className = themeEditor ? "secondary store-editor-save" : "secondary";
  saveDraftButton.textContent = themeEditor ? "Save" : "Save design draft";
  saveDraftButton.dataset.storeSaveAll = '';
  saveDraftButton.disabled = themeEditor;
  saveDraftButton.onclick = async () => { if (await saveStoreDraft()) { toast("Store draft saved"); previewFrame.src = $("#store-preview-page").value; } };
  const publishButton = $("#publish-store-home");
  if (themeEditor) publishButton.textContent = "Publish";
  actionHost.append(saveDraftButton, publishButton);
  const saveError = document.createElement("p");
  saveError.id = "store-save-error";
  saveError.className = "notice domain-error";
  saveError.setAttribute("role", "alert");
  saveError.hidden = true;
  $(".store-workspace").before(saveError);
}

function homeView() {
  setPageHeader('Your sales, your customers, your next step.');
  content.innerHTML = overviewMarkup({ data, esc, money: rupees, storeUrl,
    ordersHtml: ordersTable(data.orders.slice(0, 5)) });
  content.querySelectorAll('[data-workspace-go]').forEach(button => {
    button.onclick = () => navigateTo(button.dataset.workspaceGo).catch(error => toast(error.message));
  });
  wireOrderDetailLinks(content);
}
const productTabs = [
  ["all", "All Products"],
  ["bundles", "Bundles"],
  ["discounts", "Discounts"],
  ["collections", "Collections"],
  ["inventory", "Inventory"],
  ["purchase-orders", "Purchase Orders"],
  ["transfers", "Transfers"],
  ["gift-cards", "Gift Cards"],
];
function productsView() {
  content.innerHTML = `<div class="subnav">${productTabs.map(([id, label]) => `<button data-product-tab="${id}" class="${productTab === id ? "active" : ""}">${label}</button>`).join("")}</div><div id="product-section"></div>`;
  document.querySelectorAll("[data-product-tab]").forEach(
    (button) =>
      (button.onclick = () => {
        productTab = button.dataset.productTab;
        navigateTo(
          productTab === "all" ? "/products" : `/products/${productTab}`,
        );
      }),
  );
  ({
    all: allProductsView,
    bundles: bundlesView,
    discounts: discountsView,
    collections: collectionsView,
    inventory: inventoryView,
    "purchase-orders": purchaseOrdersView,
    transfers: transfersView,
    "gift-cards": giftCardsView,
  })[productTab]();
}
function productOptions() {
  return data.products
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
    .join("");
}
function locationOptions() {
  return ops.locations
    .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`)
    .join("");
}
function allProductsView() {
  const el = $("#product-section");
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>All Products</h2><span>Manage products, stock, bundles and live product pages.</span></div><button class="primary" id="add-product">+ Add product</button></div>${data.products.length ? `<table><thead><tr><th>PRODUCT</th><th>SLUG</th><th>PRICE</th><th>TOTAL INVENTORY</th><th>STATUS</th></tr></thead><tbody>${data.products.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.slug)}</td><td>${rupees(p.pricePaise)}</td><td><span class="pill">${p.stock} in stock</span></td><td><span class="pill">${p.active ? "Active" : "Draft"}</span></td></tr>`).join("")}</tbody></table>` : empty("No products yet. Add a product to create its product page.")}</section>`;
  $("#add-product").onclick = createProductEditor;
}
function createProductEditor() {
  content.innerHTML = `<form id="product-editor" class="product-editor"><div class="product-editor-head"><div><button class="back-link" type="button" id="back-products">← Products</button><h2>Create Product</h2><p>Build the product first. Its product page is created automatically when you save.</p></div><div><button class="secondary" type="button" id="preview-product">Preview</button> <button class="primary" type="submit">Save product</button></div></div><div class="product-editor-layout"><div><section class="panel"><h3>1. Product Information</h3><label class="field">Product Title *<input name="name" required autofocus></label><label class="field">URL slug *<input name="slug" placeholder="product-slug" required></label><label class="field">Description *<textarea name="description" rows="7" placeholder="Describe the product, benefits and how to use it." required></textarea></label><p class="muted">Description supports text, headings, lists and links on the published product page.</p></section><section class="panel"><h3>2. Media</h3><div class="file-drop"><strong>Upload images, GIF or video</strong><span>Drag and drop media here after saving, from the product-page editor.</span></div><p class="muted">The first uploaded item becomes the featured product image.</p></section><section class="panel"><h3>3. Pricing</h3><div class="form-columns"><label class="field">Price (${esc(data?.store?.currency || "Currency")}) *<input name="price" type="number" min="0" step="0.01" required></label><label class="field">Compare-at Price (${esc(data?.store?.currency || "Currency")})<input name="comparePrice" type="number" min="0" step="0.01" placeholder="1299"></label></div></section><section class="panel"><h3>4. Inventory</h3><label class="field checkbox"><input name="trackQuantity" type="checkbox" checked> <span>Track quantity</span></label><div class="form-columns"><label class="field">Quantity *<input name="stock" type="number" min="0" value="0" required></label><label class="field">SKU<input name="sku" placeholder="PRODUCT-001"></label></div></section><section class="panel"><h3>5. Product Options / Variants</h3><label class="field checkbox"><input type="checkbox" id="has-variants"> <span>This product has options</span></label><div id="variant-fields" hidden><div class="form-columns"><label class="field">Option name<input name="optionName" placeholder="Size"></label><label class="field">Values<input name="optionValues" placeholder="100ml, 200ml, 300ml"></label></div><p class="muted">Save the product, then manage price, inventory, SKU and image for each variant.</p></div></section><section class="panel"><div class="panel-head"><div><h3>6. Bundles</h3><span>Create selectable COD bundles for this product.</span></div><button type="button" class="secondary" id="add-product-bundle">+ Add bundle</button></div><div id="product-bundles"></div></section><section class="panel"><h3>7. Product Page</h3><label class="choice"><input type="radio" name="pageMode" value="default" checked> <span><b>Use Default Product Page</b><small>Creates a page with product information, price, bundles, checkout, reviews and policy footer.</small></span></label><label class="choice"><input type="radio" name="pageMode" value="template"> <span><b>Choose Template</b><small>Choose and customise a template after the product is saved.</small></span></label><label class="choice"><input type="radio" name="pageMode" value="upload"> <span><b>Upload Existing Product Page</b><small>Import an existing page after the product is saved.</small></span></label><label class="field">Checkout button text<input name="ctaText" value="Buy Now" required></label><label class="field">Checkout action<select name="checkoutAction"><option value="direct">Direct Checkout</option><option value="cart">Add To Cart</option><option value="redirect">Redirect</option></select></label><label class="field" id="redirect-url" hidden>Redirect URL *<input name="redirectUrl" type="url" placeholder="https://example.com"></label></section><section class="panel"><h3>8. Reviews</h3><label class="field checkbox"><input name="reviewsEnabled" type="checkbox" checked> <span>Enable reviews</span></label><label class="field checkbox"><input name="showRating" type="checkbox" checked> <span>Show rating</span></label><label class="field checkbox"><input name="showReviewImages" type="checkbox" checked> <span>Show review images</span></label></section></div><aside class="product-editor-side"><section class="panel"><h3>Status</h3><label class="choice"><input type="radio" name="status" value="draft"> <span><b>Draft</b><small>Not visible to customers.</small></span></label><label class="choice"><input type="radio" name="status" value="active" checked> <span><b>Active</b><small>Publish the default product page immediately.</small></span></label></section><section class="panel"><h3>Available On</h3><label class="field checkbox"><input name="onlineStore" type="checkbox" checked> <span>Online Store</span></label><p class="muted">Sales-channel availability can be managed in Settings after saving.</p></section></aside></div></form>`;
  let bundleCount = 0;
  const addBundle = () => {
    bundleCount++;
    $("#product-bundles").insertAdjacentHTML(
      "beforeend",
      `<div class="bundle-row"><label class="field">Bundle name<input name="bundleName${bundleCount}" placeholder="Option 1"></label><label class="field">Quantity<input name="bundleQuantity${bundleCount}" type="number" min="2" value="2"></label><label class="field">Price (${esc(data?.store?.currency || "Currency")})<input name="bundlePrice${bundleCount}" type="number" min="0" step="0.01"></label><button class="tiny remove-product-bundle" type="button">Remove</button></div>`,
    );
    document
      .querySelectorAll(".remove-product-bundle")
      .forEach(
        (button) => (button.onclick = () => button.parentElement.remove()),
      );
  };
  $("#add-product-bundle").onclick = addBundle;
  $("#has-variants").onchange = (e) =>
    ($("#variant-fields").hidden = !e.target.checked);
  $("#back-products").onclick = () => {
    productTab = "all";
    productsView();
  };
  $("#preview-product").onclick = () =>
    toast("Save the product first, then preview its product page.");
  const checkoutAction = $("#product-editor").elements.checkoutAction;
  checkoutAction.onchange = () =>
    ($("#redirect-url").hidden = checkoutAction.value !== "redirect");
  $("#product-editor").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    if (values.checkoutAction === "redirect" && !values.redirectUrl)
      return toast("Redirect URL is required");
    try {
      const product = await api(`/api/stores/${storeId}/products`, {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          slug: values.slug,
          pricePaise: Math.round(Number(values.price) * 100),
          stock: values.trackQuantity === "on" ? Number(values.stock) : 0,
          status: values.status,
        }),
      });
      const page = await createPageRequest(
        {
          productId: product.id,
          title: values.name,
          slug: values.slug,
          body: values.description,
          status: values.status === "active" ? "published" : "draft",
          ctaText: values.ctaText,
          ctaAction: values.checkoutAction,
          directCheckout: values.checkoutAction === "direct",
          redirectUrl: values.redirectUrl,
        },
        "blank",
      );
      const bundleRows = [...document.querySelectorAll(".bundle-row")];
      await Promise.all(
        bundleRows.map((row) => {
          const fields = row.querySelectorAll("input"),
            name = fields[0].value.trim(),
            quantity = Number(fields[1].value),
            price = fields[2].value;
          if (!name || price === "") return null;
          return api(`/api/stores/${storeId}/bundles`, {
            method: "POST",
            body: JSON.stringify({
              productId: product.id,
              name,
              quantity,
              pricePaise: Math.round(Number(price) * 100),
            }),
          });
        }),
      );
      toast(
        values.status === "active"
          ? "Product and live product page created"
          : "Product saved as draft",
      );
      await load();
      if (values.status === "active")
        open(storeUrl(encodeURIComponent(page.liveSlug || page.slug)), "_blank");
    } catch (error) {
      toast(error.message);
    }
  };
}
function bundlesView(selector = '#product-section') {
  const el = $(selector);
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Product Bundles</h2><span>Create quantity bundles with a dedicated bundle price.</span></div><button class="primary" id="add-bundle" ${data.products.length ? "" : "disabled"}>+ Create bundle</button></div>${
    data.bundles.length
      ? `<table><thead><tr><th>BUNDLE</th><th>PRODUCT</th><th>QUANTITY</th><th>BUNDLE PRICE</th><th>STATUS</th></tr></thead><tbody>${data.bundles
          .map((bundle) => {
            const product = data.products.find(
              (item) => item.id === bundle.productId,
            );
            return `<tr><td><strong>${esc(bundle.name)}</strong></td><td>${esc(product?.name || "Unknown product")}</td><td>${bundle.quantity}</td><td>${rupees(bundle.pricePaise)}</td><td><span class="pill">${bundle.active ? "Active" : "Inactive"}</span></td></tr>`;
          })
          .join("")}</tbody></table>`
      : empty(
          data.products.length ? "No bundles yet." : "Create a product first.",
        )
  }</section>`;
  $("#add-bundle").onclick = () =>
    openForm(
      "Create bundle",
      `<label class="field">Product<select name="productId">${productOptions()}</select></label><label class="field">Bundle name<input name="name" placeholder="Pack of 3" required></label><label class="field">Product quantity<input name="quantity" type="number" min="2" required></label><label class="field">Bundle price (${esc(data?.store?.currency || "Currency")})<input name="price" type="number" min="0" step="0.01" required></label>`,
      "Create bundle",
      (v) =>
        api(`/api/stores/${storeId}/bundles`, {
          method: "POST",
          body: JSON.stringify({
            productId: Number(v.productId),
            name: v.name,
            quantity: Number(v.quantity),
            pricePaise: Math.round(Number(v.price) * 100),
          }),
        }),
    );
}
const settingsTabs = [
  ["cod-form", "COD Form"],
  ["domain", "Domain"],
  ["pixel", "Pixel"],
  ["checkout", "Checkout"],
  ["shipping", "Shipping and Delivery"],
  ["channels", "Sales Channels"],
  ["privacy", "Customer Privacy"],
];
function settingsView() {
  ({
    "cod-form": codFormView,
    domain: domainsView,
    pixel: pixelsView,
    checkout: checkoutSettingsView,
    shipping: shippingSettingsView,
    channels: salesChannelsView,
    privacy: privacySettingsView,
  })[settingsTab]();
  content.insertAdjacentHTML(
    "afterbegin",
    `<div class="subnav">${settingsTabs.map(([id, label]) => `<button data-settings-tab="${id}" class="${settingsTab === id ? "active" : ""}">${label}</button>`).join("")}</div>`,
  );
  document.querySelectorAll("[data-settings-tab]").forEach(
    (button) =>
      (button.onclick = () => {
        settingsTab = button.dataset.settingsTab;
        navigateTo(`/settings/${settingsTab}`);
      }),
  );
}
function codFormView() {
  const cfg = data.settings.codForm,
    requiredFieldKeys = new Set([
      "fullName",
      "phone",
      "address1",
      "pincode",
      "city",
      "state",
      "country",
    ]),
    fieldCards = Object.entries(cfg.fields)
      .map(([key, value]) => {
        const label = esc(value.label || key),
          isLocked = requiredFieldKeys.has(key),
          showChecked = isLocked ? true : Boolean(value.show),
          requiredChecked = isLocked ? true : Boolean(value.required),
          showAttr = isLocked
            ? "checked disabled"
            : showChecked
              ? "checked"
              : "",
          requiredAttr = isLocked
            ? "checked disabled"
            : requiredChecked
              ? "checked"
              : "";
        return `<article class="cod-field-card ${isLocked ? "is-locked" : ""}"><div class="cod-field-card-head"><div><h3>${label}</h3><small>${esc(key)}</small></div>${isLocked ? '<span class="status-badge is-active">Required</span>' : ""}</div><label class="field">Label<input name="field-${key}-label" value="${esc(value.label)}" required></label><label class="field">Placeholder<input name="field-${key}-placeholder" value="${esc(value.placeholder || "")}" placeholder="Add placeholder text"></label><div class="field-switches"><div class="switch-row"><span>Visible</span><label class="switch"><input type="checkbox" aria-label="Show ${esc(value.label || key)}" name="field-${key}-show" ${showAttr}><span></span></label></div><div class="switch-row"><span>Required</span><label class="switch"><input type="checkbox" aria-label="Require ${esc(value.label || key)}" name="field-${key}-required" ${requiredAttr}><span></span></label></div></div>${isLocked ? '<p class="cod-field-lock-note">This field is required for COD to work and cannot be disabled.</p>' : ""}</article>`;
      })
      .join("");
  const fieldRows = fieldCards;
  const toggle = (name, label, checked) =>
    `<div class="toggle-row"><span><strong>${label}</strong></span><label class="switch"><input type="checkbox" aria-label="${esc(label)}" name="${name}" ${checked ? "checked" : ""}><span></span></label></div>`;
  const otp = cfg.otp || {},
    otpProvider = data.otpProvider || {
      configured: false,
      status: "not_connected",
      region: "US1",
      accountSidHint: "",
      serviceSidHint: "",
      authTokenConfigured: false,
      source: "none",
    },
    bot = cfg.protection?.botProtection || {},
    fieldLabel = (text) => text.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
  setPageHeader(
    "Configure the COD form used automatically by connected product pages.",
    '<button class="secondary" type="button" id="preview-cod-form">Preview</button><button class="primary" type="submit" form="cod-settings-form">Save</button>',
  );
  content.innerHTML = `<div class="settings-section-tabs" role="tablist">${[
    ["general", "General"],
    ["fields", "Customer Fields"],
    ["addons", "Optional Extras"],
    ["otp", "OTP Verification"],
    ["summary", "Order Summary"],
    ["protection", "COD Protection"],
    ["upsells", "Upsells"],
    ["downsells", "Downsells"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" role="tab" aria-selected="${codSettingsSection === id}" tabindex="${codSettingsSection === id ? "0" : "-1"}" data-cod-section="${id}" class="${codSettingsSection === id ? "active" : ""}">${label}</button>`,
    )
    .join(
      "",
    )}</div><form id="cod-settings-form"><section class="panel cod-settings-pane" data-cod-pane="general"><div class="panel-head"><div><h2>General</h2><span>Core form content and checkout behavior.</span></div><span class="status-badge ${cfg.enabled ? "is-active" : "is-draft"}">${cfg.enabled ? "Enabled" : "Disabled"}</span></div>${toggle("enabled", "Enable COD Form", cfg.enabled)}<label class="field">Form Name<input name="formName" value="${esc(cfg.formName)}" required></label><label class="field">Heading<input name="heading" value="${esc(cfg.heading)}" required></label><label class="field">Subheading<input name="subheading" value="${esc(cfg.subheading)}"></label><label class="field">Submit Button Text<input name="submitButtonText" value="${esc(cfg.submitButtonText)}" required></label>${toggle("addressAutofill", "Address Autofill", cfg.addressAutofill)}${toggle("saveIncompleteCheckout", "Save Incomplete Checkout", cfg.saveIncompleteCheckout)}${toggle("buttonEnabled", "Checkout Button Enabled", cfg.buttonEnabled)}</section><section class="panel cod-settings-pane" data-cod-pane="fields"><div class="panel-head"><div><h2>Customer Fields</h2><span>Choose visibility and requirements. Open a row to edit its label.</span></div></div><div class="table-scroll"><table class="merchant-table field-settings-table"><thead><tr><th>FIELD</th><th>VISIBLE</th><th>REQUIRED</th><th><span class="sr-only">Edit</span></th></tr></thead><tbody>${fieldRows}</tbody></table></div></section><section class="panel cod-settings-pane" data-cod-pane="summary"><div class="panel-head"><div><h2>Order Summary</h2><span>Choose what customers see before placing an order.</span></div></div>${Object.entries(
    cfg.summary,
  )
    .map(([key, value]) =>
      toggle(`summary-${key}`, key.replace(/([A-Z])/g, " $1"), value),
    )
    .join(
      "",
    )}</section><section class="panel cod-settings-pane" data-cod-pane="otp"><div class="panel-head"><div><h2>OTP Verification</h2><span>Verify the customer's mobile number before creating a COD order.</span></div><span class="status-badge ${otp.enabled ? "is-active" : "is-draft"}">${otp.enabled ? "Enabled" : "Disabled"}</span></div>${toggle("otp-enabled", "Enable OTP verification", otp.enabled)}${toggle("otp-requiredForCod", "Require OTP for every COD order", otp.requiredForCod)}${toggle("otp-allowPhoneChange", "Allow phone number changes before verification", otp.allowPhoneChange)}<div class="form-grid"><label class="field">Verification Position<select name="otp-verificationPosition"><option value="before_order" ${otp.verificationPosition === "before_order" ? "selected" : ""}>Before final order (recommended)</option><option value="before_checkout" ${otp.verificationPosition === "before_checkout" ? "selected" : ""}>Immediately after phone number</option></select></label><label class="field">Provider<select name="otp-provider"><option value="custom" ${otp.provider === "custom" ? "selected" : ""}>Configured server provider</option><option value="twilio" ${otp.provider === "twilio" ? "selected" : ""}>Twilio Verify</option></select></label><label class="field">OTP Length<select name="otp-length"><option value="4" ${Number(otp.length) === 4 ? "selected" : ""}>4 digits</option><option value="6" ${Number(otp.length) === 6 ? "selected" : ""}>6 digits</option></select></label><label class="field">Expires after (minutes)<input name="otp-expiryMinutes" type="number" min="1" max="30" value="${Number(otp.expiryMinutes || 5)}"></label><label class="field">Resend delay (seconds)<input name="otp-resendDelaySeconds" type="number" min="10" max="300" value="${Number(otp.resendDelaySeconds || 30)}"></label><label class="field">Maximum attempts<input name="otp-maxAttempts" type="number" min="1" max="10" value="${Number(otp.maxAttempts || 5)}"></label><label class="field">Maximum resends<input name="otp-maxResends" type="number" min="0" max="10" value="${Number(otp.maxResends ?? 3)}"></label></div><div class="otp-provider-card" id="twilio-provider-config" ${otp.provider === "twilio" ? "" : "hidden"}><div class="otp-provider-head"><div><h3>Twilio Verify configuration</h3><p>Credentials are encrypted and kept on the server. The browser receives masked identifiers only.</p></div><span class="status-badge ${otpProvider.configured ? "is-active" : "is-draft"}">${otpProvider.configured ? "Connected" : "Not connected"}</span></div><div class="form-grid"><label class="field">Region<select id="twilio-region"><option value="US1" selected>US1 (United States)</option></select></label><label class="field">Account SID<input id="twilio-account-sid" autocomplete="off" spellcheck="false" placeholder="${esc(otpProvider.accountSidHint || "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")}"></label><label class="field">Auth Token<input id="twilio-auth-token" type="password" autocomplete="new-password" placeholder="${otpProvider.authTokenConfigured ? "Saved securely — leave blank to keep" : "Enter Auth Token"}"></label><label class="field">Verify Service SID <small>Optional</small><input id="twilio-service-sid" autocomplete="off" spellcheck="false" placeholder="${esc(otpProvider.serviceSidHint || "Created automatically if left blank")}"></label></div><div class="otp-provider-meta"><span>Account: <strong>${esc(otpProvider.accountSidHint || "Not saved")}</strong></span><span>Service: <strong>${esc(otpProvider.serviceSidHint || "Not created")}</strong></span><span>Source: <strong>${esc(otpProvider.source === "store" ? "This store" : otpProvider.source === "server" ? "Server configuration" : "None")}</strong></span></div><div class="inline-actions"><button class="primary" id="connect-otp-provider" type="button">${otpProvider.configured ? "Save & Reconnect" : "Save & Connect"}</button><small>Connecting validates the Twilio account and Verify service. It does not send an SMS.</small></div></div><div class="otp-test-card"><label class="field">Verified tester mobile number<input id="test-otp-phone" inputmode="numeric" autocomplete="tel" maxlength="10" pattern="[6-9][0-9]{9}" placeholder="10-digit Indian mobile number"></label><button class="secondary" id="test-otp-provider" type="button" ${otpProvider.configured ? "" : "disabled"}>Send test OTP</button><small>Twilio trial accounts can send only to verified recipients. Sending may use trial credit.</small></div></section><section class="panel cod-settings-pane" data-cod-pane="protection"><div class="panel-head"><div><h2>COD Protection</h2><span>Layered server-side checks run before any order is created.</span></div></div>${["duplicateOrders", "blackOrders", "multipleFakeOrders", "botTraffic"].map((key) => toggle(`protection-${key}`, fieldLabel(key), cfg.protection?.[key])).join("")}<div class="settings-subsection"><h3>Bot Traffic Prevention</h3>${toggle("bot-enabled", "Enable adaptive bot protection", bot.enabled)}${toggle("bot-rateLimiting", "IP and device rate limiting", bot.rateLimiting)}${toggle("bot-deviceSessionCheck", "Device and session checks", bot.deviceSessionCheck)}${toggle("bot-behaviorDetection", "Behavior detection", bot.behaviorDetection)}${toggle("bot-checkoutToken", "Require signed checkout token", bot.checkoutToken)}${toggle("bot-honeypot", "Honeypot field", bot.honeypot)}${toggle("bot-otpSuspiciousTraffic", "Require OTP for suspicious traffic", bot.otpSuspiciousTraffic)}${toggle("bot-ipReputationCheck", "IP reputation provider", bot.ipReputationCheck)}${toggle("bot-blockKnownBadIps", "Block known bad IPs", bot.blockKnownBadIps)}${toggle("bot-invisibleChallenge", "Invisible challenge", bot.invisibleChallenge)}${toggle("bot-captchaSuspiciousTraffic", "CAPTCHA for suspicious traffic", bot.captchaSuspiciousTraffic)}<div class="form-grid"><label class="field">High-risk action<select name="bot-highRiskAction">${["allow", "challenge", "require_otp", "block"].map((value) => `<option value="${value}" ${bot.highRiskAction === value ? "selected" : ""}>${fieldLabel(value.replace("_", " "))}</option>`).join("")}</select></label><label class="field">Critical-risk action<select name="bot-criticalRiskAction">${["challenge", "require_otp", "block"].map((value) => `<option value="${value}" ${bot.criticalRiskAction === value ? "selected" : ""}>${fieldLabel(value.replace("_", " "))}</option>`).join("")}</select></label><label class="field">IP attempt limit<input name="bot-ipCheckoutLimit" type="number" min="1" value="${Number(bot.ipCheckoutLimit || 10)}"></label><label class="field">IP window (minutes)<input name="bot-ipWindowMinutes" type="number" min="1" value="${Number(bot.ipWindowMinutes || 10)}"></label><label class="field">Device attempt limit<input name="bot-deviceAttemptLimit" type="number" min="1" value="${Number(bot.deviceAttemptLimit || 5)}"></label><label class="field">Device window (minutes)<input name="bot-deviceWindowMinutes" type="number" min="1" value="${Number(bot.deviceWindowMinutes || 30)}"></label></div></div></section></form><div class="cod-settings-pane" data-cod-pane="upsells" id="cod-upsells"></div><div class="cod-settings-pane" data-cod-pane="downsells" id="cod-downsells"></div>`;
  
  const fieldsPane = document.querySelector('[data-cod-pane="fields"]');
  if (fieldsPane) {
    fieldsPane.innerHTML = `<div class="panel-head"><div><h2>Customer Fields</h2><span>Build your checkout form one field at a time.</span></div></div><div class="cod-field-builder">${fieldCards}</div>`;
  }
  const attempts = data.codProtection?.botAttempts || [],
    protectionPane = document.querySelector('[data-cod-pane="protection"]');
  protectionPane?.insertAdjacentHTML(
    "beforeend",
    `<div class="settings-subsection"><div class="panel-head"><div><h3>Recent Checkout Attempts</h3><span>Blocked attempts stay here for analysis and never enter Orders or Abandoned Checkouts.</span></div></div>${attempts.length ? `<div class="table-scroll"><table class="merchant-table"><thead><tr><th>TIME</th><th>PHONE</th><th>RISK</th><th>ACTION</th><th>SIGNALS</th></tr></thead><tbody>${attempts.slice(0, 20).map((attempt) => `<tr><td>${new Date(attempt.createdAt + "Z").toLocaleString("en-IN")}</td><td>${attempt.phone ? `••••••${esc(attempt.phone.slice(-4))}` : "—"}</td><td><strong>${esc(attempt.riskLevel)} · ${Number(attempt.riskScore)}/100</strong></td><td><span class="status-badge ${attempt.blocked ? "is-disapproved" : "is-active"}">${esc(attempt.action.replaceAll("_", " "))}</span></td><td>${attempt.signals.length ? attempt.signals.map((signal) => esc(signal.code.replaceAll("_", " "))).join(" · ") : "No risk signals"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="notice">No checkout attempts have been scored yet.</p>'}</div>`,
  );
  const form = $("#cod-settings-form"),
    save = async (patch) => {
      await api(`/api/stores/${storeId}/settings/cod-form`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast("COD Form settings saved");
      await load();
    };
  const codEditor = mountCodFormEditor({ form, config: cfg, esc, products:data.products });
  form.querySelector('[data-cod-pane="general"]').insertAdjacentHTML('beforeend', `<label class="field">Maximum post-purchase offers<select name="postPurchaseLimit">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===(cfg.postPurchaseLimit||1)?'selected':''}>${n}</option>`).join('')}</select></label>`);
  form.querySelector('[data-cod-pane="general"]').insertAdjacentHTML('beforeend', `<label class="field">Form display<select name="displayMode">${[['page','Checkout page'],['popup','Popup on product page'],['embedded','Embedded in product page']].map(([value,label])=>`<option value="${value}" ${value===(cfg.displayMode||'page')?'selected':''}>${label}</option>`).join('')}</select></label>`);
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const fields = {};
      for (const key of Object.keys(cfg.fields))
        fields[key] = {
          show: form.elements[`field-${key}-show`].checked,
          required: form.elements[`field-${key}-required`].checked,
          label: form.elements[`field-${key}-label`].value,
          placeholder: form.elements[`field-${key}-placeholder`].value,
        };
      const summary = {};
      for (const key of Object.keys(cfg.summary))
        summary[key] = form.elements[`summary-${key}`].checked;
      const protection = {};
      for (const key of ["duplicateOrders", "blackOrders", "multipleFakeOrders", "botTraffic"])
        protection[key] = form.elements[`protection-${key}`].checked;
      protection.botProtection = {
        enabled: form.elements["bot-enabled"].checked,
        rateLimiting: form.elements["bot-rateLimiting"].checked,
        deviceSessionCheck: form.elements["bot-deviceSessionCheck"].checked,
        behaviorDetection: form.elements["bot-behaviorDetection"].checked,
        checkoutToken: form.elements["bot-checkoutToken"].checked,
        honeypot: form.elements["bot-honeypot"].checked,
        otpSuspiciousTraffic: form.elements["bot-otpSuspiciousTraffic"].checked,
        ipReputationCheck: form.elements["bot-ipReputationCheck"].checked,
        blockKnownBadIps: form.elements["bot-blockKnownBadIps"].checked,
        invisibleChallenge: form.elements["bot-invisibleChallenge"].checked,
        captchaSuspiciousTraffic: form.elements["bot-captchaSuspiciousTraffic"].checked,
        highRiskAction: form.elements["bot-highRiskAction"].value,
        criticalRiskAction: form.elements["bot-criticalRiskAction"].value,
        ipCheckoutLimit: Number(form.elements["bot-ipCheckoutLimit"].value),
        ipWindowMinutes: Number(form.elements["bot-ipWindowMinutes"].value),
        deviceAttemptLimit: Number(form.elements["bot-deviceAttemptLimit"].value),
        deviceWindowMinutes: Number(form.elements["bot-deviceWindowMinutes"].value),
      };
      const otpSettings = {
        enabled: form.elements["otp-enabled"].checked,
        requiredForCod: form.elements["otp-requiredForCod"].checked,
        allowPhoneChange: form.elements["otp-allowPhoneChange"].checked,
        provider: form.elements["otp-provider"].value,
        length: Number(form.elements["otp-length"].value),
        expiryMinutes: Number(form.elements["otp-expiryMinutes"].value),
        resendDelaySeconds: Number(form.elements["otp-resendDelaySeconds"].value),
        maxAttempts: Number(form.elements["otp-maxAttempts"].value),
        maxResends: Number(form.elements["otp-maxResends"].value),
        verificationPosition: form.elements["otp-verificationPosition"].value,
      };
      await save({
        enabled: form.elements.enabled.checked,
        formName: form.elements.formName.value,
        heading: form.elements.heading.value,
        subheading: form.elements.subheading.value,
        submitButtonText: form.elements.submitButtonText.value,
        addressAutofill: form.elements.addressAutofill.checked,
        saveIncompleteCheckout: form.elements.saveIncompleteCheckout.checked,
        buttonEnabled: form.elements.buttonEnabled.checked,
        displayMode: form.elements.displayMode.value,
        postPurchaseLimit: Number(form.elements.postPurchaseLimit.value),
        ...codEditor.read(),
        fields,
        otp: otpSettings,
        summary,
        protection,
      });
    } catch (error) {
      toast(error.message);
    }
  };
  $("#preview-cod-form").onclick = () => {
    const page =
      data.pages.find((item) => item.status === "published") || data.pages[0];
    if (!page) return toast("Create a product page first");
    open(`/api/stores/${storeId}/pages/${page.id}/preview`, "_blank");
  };
  const providerSelect = form.elements["otp-provider"],
    twilioConfiguration = $("#twilio-provider-config"),
    syncProviderConfiguration = () => {
      twilioConfiguration.hidden = providerSelect.value !== "twilio";
    };
  providerSelect.onchange = syncProviderConfiguration;
  syncProviderConfiguration();
  $("#connect-otp-provider").onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Connecting…";
    try {
      await api(`/api/stores/${storeId}/otp/provider`, {
        method: "POST",
        body: JSON.stringify({
          provider: "twilio",
          region: $("#twilio-region").value,
          accountSid: $("#twilio-account-sid").value,
          authToken: $("#twilio-auth-token").value,
          serviceSid: $("#twilio-service-sid").value,
        }),
      });
      toast("Twilio Verify connected");
      await load();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      button.textContent = otpProvider.configured
        ? "Save & Reconnect"
        : "Save & Connect";
    }
  };
  $("#test-otp-provider").onclick = async () => {
    const phone = $("#test-otp-phone").value.trim();
    if (!/^[6-9][0-9]{9}$/.test(phone))
      return toast("Enter a valid 10-digit Indian mobile number");
    try {
      const result = await api(`/api/stores/${storeId}/otp/test`, {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      toast(`Test OTP sent to ${result.maskedPhone}`);
    } catch (error) {
      toast(error.message);
    }
  };
  upsellsView("#cod-upsells");
  downsellsView("#cod-downsells");
  const tabs = content.querySelector('.settings-section-tabs');
  tabs.insertAdjacentHTML('beforeend','<button type="button" role="tab" data-cod-section="quantity" aria-selected="false">Quantity offers</button><button type="button" role="tab" data-cod-section="sheets" aria-selected="false">Google Sheets</button><button type="button" role="tab" data-cod-section="shipping" aria-selected="false">Shipping</button>');
  content.insertAdjacentHTML('beforeend', '<div class="cod-settings-pane" data-cod-pane="quantity" id="cod-quantity-offers"></div><div class="cod-settings-pane" data-cod-pane="sheets"><h2>Google Sheets</h2><a class="button-link primary" href="/campaigns">Open UTM Sheet</a></div><div class="cod-settings-pane" data-cod-pane="shipping"><h2>Shipping rates</h2><a class="button-link primary" href="/settings/shipping">Manage shipping rates</a></div>');
  bundlesView('#cod-quantity-offers');
  const showCodSection = (section) => {
    codSettingsSection = section;
    document.querySelectorAll("[data-cod-section]").forEach((button) => {
      const active = button.dataset.codSection === section;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll("[data-cod-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.codPane !== section;
    });
  };
  document
    .querySelectorAll("[data-cod-section]")
    .forEach(
      (button) =>
        (button.onclick = () => showCodSection(button.dataset.codSection)),
    );
  showCodSection(codSettingsSection);
}

function exitOffersView(selector = "#cod-exit-offers") {
  const el = $(selector);
  if (!el) return;
  const offers = data.exitOffers || [],
    totals = offers.reduce(
      (result, item) => ({
        shown: result.shown + Number(item.shown || 0),
        claimed: result.claimed + Number(item.claimed || 0),
        converted: result.converted + Number(item.converted || 0),
        revenue:
          result.revenue + Number(item.recoveredRevenuePaise || 0),
      }),
      { shown: 0, claimed: 0, converted: 0, revenue: 0 },
    ),
    discountLabel = (item) =>
      item.discountType === "percent"
        ? `${item.discountValue}% off`
        : `${rupees(item.discountValue)} off`,
    targetLabel = (item) =>
      item.targetType === "specific_product"
        ? item.targetProductName || "Selected product"
        : item.targetType === "specific_page"
          ? item.targetPageTitle || "Selected page"
          : "All products",
    actions = (item) =>
      `<details class="row-menu"><summary aria-label="More actions for ${esc(item.name)}">⋯</summary><div><button type="button" data-exit-action="edit" data-id="${item.id}">Edit</button><button type="button" data-exit-action="duplicate" data-id="${item.id}">Duplicate</button><button type="button" data-exit-action="toggle" data-id="${item.id}">${item.status === "active" ? "Disable" : "Enable"}</button><button type="button" data-exit-action="analytics" data-id="${item.id}">View analytics</button><button class="danger-text" type="button" data-exit-action="delete" data-id="${item.id}">Delete</button></div></details>`;
  el.innerHTML = `<section class="upsell-admin exit-offers-admin"><div class="panel upsell-hero"><div><span class="eyebrow">COD FORM · PRE-PURCHASE RECOVERY</span><h2>Exit Offers</h2><p>Rescue high-intent visitors before they leave a product page or checkout.</p></div><button class="primary" id="add-exit-offer" type="button">+ Create Exit Offer</button></div><div class="upsell-metrics">${metric("Shown", totals.shown, "Frequency capped by session")}${metric("Claimed", totals.claimed, `${totals.shown ? Math.round((totals.claimed / totals.shown) * 1000) / 10 : 0}% claim rate`)}${metric("Recovered orders", totals.converted, "Orders completed after claim")}${metric("Recovered revenue", rupees(totals.revenue), "Completed checkout value")}</div><section class="panel upsell-offers-panel">${offers.length ? `<div class="table-scroll upsell-desktop-list"><table><thead><tr><th>OFFER</th><th>DISCOUNT</th><th>TARGET</th><th>SHOWN</th><th>CLAIM RATE</th><th>STATUS</th><th></th></tr></thead><tbody>${offers.map((item) => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.headline)}</small></td><td><strong>${esc(discountLabel(item))}</strong><small>${esc(item.combinationRule.replaceAll("_", " "))}</small></td><td>${esc(targetLabel(item))}<small>${item.showProductPage ? "Product page" : ""}${item.showProductPage && item.showCheckout ? " + " : ""}${item.showCheckout ? "Checkout" : ""}</small></td><td>${item.shown}</td><td>${item.claimRate}%<small>${item.claimed}/${item.shown} claimed</small></td><td><span class="pill upsell-status-${item.status}">${esc(item.status)}</span></td><td>${actions(item)}</td></tr>`).join("")}</tbody></table></div><div class="upsell-mobile-list">${offers.map((item) => `<article class="upsell-mobile-card"><header><div><strong>${esc(item.name)}</strong><span class="pill upsell-status-${item.status}">${esc(item.status)}</span></div></header><div class="upsell-card-details"><p><span>Discount</span><strong>${esc(discountLabel(item))}</strong></p><p><span>Target</span><strong>${esc(targetLabel(item))}</strong></p><p><span>Claim rate</span><strong>${item.claimRate}%</strong></p></div><dl><div><dt>Shown</dt><dd>${item.shown}</dd></div><div><dt>Claimed</dt><dd>${item.claimed}</dd></div><div><dt>Recovered</dt><dd>${item.converted}</dd></div></dl><footer class="upsell-card-actions"><button class="secondary" type="button" data-exit-action="edit" data-id="${item.id}">Edit</button><button class="secondary" type="button" data-exit-action="analytics" data-id="${item.id}">Analytics</button>${actions(item)}</footer></article>`).join("")}</div>` : empty("No exit offers yet. Create a session-safe recovery offer for product pages or checkout.")}</section></section>`;
  $("#add-exit-offer").onclick = () => openExitOfferEditor();
  el.querySelectorAll("[data-exit-action]").forEach((button) => {
    button.onclick = async () => {
      const item = offers.find(
        (candidate) => candidate.id === Number(button.dataset.id),
      );
      if (!item) return;
      closeFloatingMenu();
      const action = button.dataset.exitAction;
      if (action === "edit") return openExitOfferEditor(item);
      if (action === "analytics") {
        modalContent.innerHTML = `<div class="upsell-analytics-detail"><span class="eyebrow">EXIT OFFER PERFORMANCE</span><h2>${esc(item.name)}</h2><div class="upsell-metrics">${metric("Shown", item.shown, "Offer views")}${metric("Claimed", item.claimed, `${item.claimRate}% claim rate`)}${metric("Recovered orders", item.recoveredOrders, `${item.conversionRate}% after claim`)}${metric("Recovered revenue", rupees(item.recoveredRevenuePaise), "Completed order value")}</div><button class="secondary" id="close-exit-analytics" type="button">Close</button></div>`;
        $("#close-exit-analytics").onclick = () => modal.close();
        return modal.showModal();
      }
      try {
        if (action === "delete") {
          if (!confirm(`Delete ${item.name}?`)) return;
          await api(`/api/stores/${storeId}/exit-offers/${item.id}`, {
            method: "DELETE",
          });
          toast("Exit offer deleted");
        } else if (action === "duplicate") {
          await api(
            `/api/stores/${storeId}/exit-offers/${item.id}/duplicate`,
            { method: "POST", body: "{}" },
          );
          toast("Draft copy created");
        } else if (action === "toggle") {
          await api(`/api/stores/${storeId}/exit-offers/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: item.status === "active" ? "disabled" : "active",
            }),
          });
          toast(item.status === "active" ? "Exit offer disabled" : "Exit offer enabled");
        }
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
  });
}

function openExitOfferEditor(existing = null) {
  const selected = (value, expected) =>
      String(value) === String(expected) ? "selected" : "",
    checked = (value) => (value ? "checked" : ""),
    targetType = existing?.targetType || "all_products",
    discountType = existing?.discountType || "percent",
    discountValue = existing
      ? discountType === "fixed"
        ? Number(existing.discountValue) / 100
        : Number(existing.discountValue)
      : 10;
  openForm(
    existing ? "Edit Exit Offer" : "Create Exit Offer",
    `<div class="exit-offer-editor"><p class="muted">The server validates eligibility and calculates the discount. Customers can always reject and continue leaving.</p><div class="form-columns"><label class="field">Offer name<input name="name" value="${esc(existing?.name || "Checkout rescue offer")}" maxlength="100" required></label><label class="field">Status<select name="status"><option value="active" ${selected(existing?.status || "active", "active")}>Active</option><option value="draft" ${selected(existing?.status, "draft")}>Draft</option><option value="disabled" ${selected(existing?.status, "disabled")}>Disabled</option></select></label></div><div class="form-columns"><label class="field">Discount type<select name="discountType" id="exit-discount-type"><option value="percent" ${selected(discountType, "percent")}>Percentage</option><option value="fixed" ${selected(discountType, "fixed")}>Fixed amount</option></select></label><label class="field"><span id="exit-discount-label">${discountType === "fixed" ? `Discount (${esc(data.store.currency)})` : "Discount (%)"}</span><input name="discountValue" id="exit-discount-value" type="number" min="1" ${discountType === "fixed" ? 'step="0.01"' : 'max="100" step="1"'} value="${discountValue}" required></label></div><label class="field">Headline<input name="headline" value="${esc(existing?.headline || "Wait — here is a special offer")}" maxlength="140" required></label><label class="field">Message <small>Optional</small><textarea name="message" maxlength="300">${esc(existing?.message || "Complete your order now and save.")}</textarea></label><div class="form-columns"><label class="field">Claim button text<input name="buttonText" value="${esc(existing?.buttonText || "Claim offer")}" maxlength="60" required></label><label class="field">Reject link text<input name="rejectText" value="${esc(existing?.rejectText || "No thanks, continue")}" maxlength="60" required></label></div><fieldset class="exit-offer-editor-group"><legend>Trigger</legend><p>Back button → leave confirmation → Exit Offer. Moving the cursor or waiting does not open an offer.</p><small>Customers can stay without seeing an offer, or reject the offer and continue back.</small></fieldset><div class="form-columns"><label class="field">Target<select name="targetType" id="exit-target-type"><option value="all_products" ${selected(targetType, "all_products")}>All products</option><option value="specific_product" ${selected(targetType, "specific_product")}>Specific product</option><option value="specific_page" ${selected(targetType, "specific_page")}>Specific product page</option></select></label><label class="field" data-exit-target="product">Product<select name="targetProductId"><option value="">Choose product</option>${data.products.map((item) => `<option value="${item.id}" ${selected(existing?.targetProductId, item.id)}>${esc(item.name)}</option>`).join("")}</select></label><label class="field" data-exit-target="page">Product page<select name="targetPageId"><option value="">Choose page</option>${data.pages.map((item) => `<option value="${item.id}" ${selected(existing?.targetPageId, item.id)}>${esc(item.title)}</option>`).join("")}</select></label></div><fieldset class="exit-offer-editor-group"><legend>Placement and frequency</legend><label><input name="showProductPage" type="checkbox" ${checked(existing?.showProductPage ?? true)}> Product page</label><label><input name="showCheckout" type="checkbox" ${checked(existing?.showCheckout ?? true)}> Checkout</label><label class="field">Maximum shows per session<input name="maxShowsPerSession" type="number" min="1" max="5" value="${Number(existing?.maxShowsPerSession || 1)}"></label><small>Dismissal lasts for the current browser session.</small></fieldset><label class="field">Coupon combination rule<select name="combinationRule"><option value="better_discount" ${selected(existing?.combinationRule || "better_discount", "better_discount")}>Use whichever discount is better (recommended)</option><option value="replace_coupon" ${selected(existing?.combinationRule, "replace_coupon")}>Replace the coupon</option><option value="no_coupon" ${selected(existing?.combinationRule, "no_coupon")}>Allow only when no coupon is applied</option><option value="allow_combination" ${selected(existing?.combinationRule, "allow_combination")}>Combine with coupon</option></select></label></div>`,
    existing ? "Save Exit Offer" : "Create Exit Offer",
    (values) =>
      api(
        existing
          ? `/api/stores/${storeId}/exit-offers/${existing.id}`
          : `/api/stores/${storeId}/exit-offers`,
        {
          method: existing ? "PATCH" : "POST",
          body: JSON.stringify({
            ...values,
            discountValue:
              values.discountType === "fixed"
                ? Math.round(Number(values.discountValue) * 100)
                : Number(values.discountValue),
            triggerExitIntent: false,
            triggerMouseLeave: false,
            triggerBack: true,
            triggerInactivity: false,
            inactivitySeconds: Number(existing?.inactivitySeconds || 30),
            targetProductId: values.targetProductId
              ? Number(values.targetProductId)
              : null,
            targetPageId: values.targetPageId
              ? Number(values.targetPageId)
              : null,
            showProductPage: values.showProductPage === "on",
            showCheckout: values.showCheckout === "on",
            maxShowsPerSession: Number(values.maxShowsPerSession),
          }),
        },
      ),
  );
  const form = $("#modal-form"),
    target = $("#exit-target-type"),
    discount = $("#exit-discount-type"),
    maxShows = form.elements.maxShowsPerSession,
    syncTarget = () => {
      form.querySelector('[data-exit-target="product"]').hidden =
        target.value !== "specific_product";
      form.querySelector('[data-exit-target="page"]').hidden =
        target.value !== "specific_page";
    },
    syncDiscount = () => {
      const fixed = discount.value === "fixed",
        value = $("#exit-discount-value");
      $("#exit-discount-label").textContent = fixed
        ? `Discount (${data.store.currency})`
        : "Discount (%)";
      value.step = fixed ? "0.01" : "1";
      if (fixed) value.removeAttribute("max");
      else value.max = "100";
    };
  target.onchange = syncTarget;
  discount.onchange = syncDiscount;
  maxShows.value = "1";
  maxShows.min = "1";
  maxShows.max = "1";
  maxShows.readOnly = true;
  syncTarget();
  syncDiscount();
}

function upsellsView(selector = "#product-section") {
  const el = $(selector),
    upsells = data.upsells || [],
    exitOfferContainerId = "cod-upsells-exit-offers",
    shown = upsells.reduce((sum, item) => sum + Number(item.shown || 0), 0),
    acceptedCount = upsells.reduce((sum, item) => sum + Number(item.acceptedCount || 0), 0),
    rejectedCount = upsells.reduce((sum, item) => sum + Number(item.rejectedCount || 0), 0),
    revenue = upsells.reduce((sum, item) => sum + Number(item.upsellRevenuePaise || 0), 0),
    beforeTotal = upsells.reduce((sum, item) => sum + Number(item.aovBeforePaise || 0) * Number(item.acceptedCount || 0), 0),
    afterTotal = upsells.reduce((sum, item) => sum + Number(item.aovAfterPaise || 0) * Number(item.acceptedCount || 0), 0),
    aovLift = acceptedCount ? Math.round((afterTotal - beforeTotal) / acceptedCount) : 0,
    filtered = upsells.filter((item) => upsellStatusFilter === "all" || item.status === upsellStatusFilter),
    triggerLabel = (item) =>
      item.triggerType === "any_product"
        ? "Any product"
        : item.triggerType === "specific_collection"
          ? `Collection: ${item.triggerCollectionName || "Selected collection"}`
          : `Product: ${item.productName}`,
    rowActions = (item, compact = false) => `<details class="row-menu"><summary aria-label="More actions for ${esc(item.name)}">⋯</summary><div>${compact ? "" : `<button type="button" data-upsell-action="edit" data-id="${item.id}">Edit</button>`}<button type="button" data-upsell-action="duplicate" data-id="${item.id}">Duplicate</button><button type="button" data-upsell-action="toggle" data-id="${item.id}">${item.status === "active" ? "Disable" : "Enable"}</button>${compact ? "" : `<button type="button" data-upsell-action="analytics" data-id="${item.id}">View analytics</button>`}<button class="danger-text" type="button" data-upsell-action="delete" data-id="${item.id}">Delete</button></div></details>`;
  el.innerHTML = `<section class="upsell-admin"><div class="panel upsell-hero"><div><span class="eyebrow">COD FORM · POST-PURCHASE</span><h2>COD Upsells</h2><p>Increase order value after the main COD order is safely created.</p></div><button class="primary" id="add-upsell" ${data.products.length > 1 ? "" : "disabled"}>+ Create Upsell</button></div><div class="upsell-metrics">${metric("Shown", shown, "Unique offer views")}${metric("Accepted", acceptedCount, `${shown ? Math.round((acceptedCount / shown) * 1000) / 10 : 0}% take rate`)}${metric("Rejected", rejectedCount, "Original orders stay confirmed")}${metric("Upsell revenue", rupees(revenue), `AOV lift ${rupees(aovLift)}`)}</div><section class="panel upsell-offers-panel"><div class="upsell-toolbar"><div class="upsell-status-tabs" role="tablist" aria-label="Upsell status">${[["all", "All"], ["active", "Active"], ["draft", "Draft"], ["disabled", "Disabled"]].map(([id, label]) => `<button type="button" role="tab" aria-selected="${upsellStatusFilter === id}" class="${upsellStatusFilter === id ? "active" : ""}" data-upsell-filter="${id}">${label}<span>${id === "all" ? upsells.length : upsells.filter((item) => item.status === id).length}</span></button>`).join("")}</div></div>${filtered.length ? `<div class="table-scroll upsell-desktop-list"><table><thead><tr><th>UPSELL NAME</th><th>TRIGGER</th><th>OFFER PRODUCT</th><th>PRICE</th><th>TAKE RATE</th><th>STATUS</th><th></th></tr></thead><tbody>${filtered.map((item) => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.headline)}</small></td><td>${esc(triggerLabel(item))}</td><td><strong>${esc(item.upsellProductName)}</strong><small>Qty ${item.quantity} · ${item.upsellProductStock} in stock</small></td><td>${rupees(item.pricePaise)}</td><td>${item.takeRate}%<small>${item.acceptedCount}/${item.shown} accepted</small></td><td><span class="pill upsell-status-${item.status}">${esc(item.status)}</span></td><td>${rowActions(item)}</td></tr>`).join("")}</tbody></table></div><div class="upsell-mobile-list">${filtered.map((item) => `<article class="upsell-mobile-card"><header><div><strong>${esc(item.name)}</strong><span class="pill upsell-status-${item.status}">${esc(item.status)}</span></div></header><div class="upsell-card-details"><p><span>Trigger</span><strong>${esc(triggerLabel(item))}</strong></p><p><span>Offer product</span><strong>${esc(item.upsellProductName)}</strong></p><p><span>Offer price</span><strong>${rupees(item.pricePaise)}</strong></p></div><dl><div><dt>Shown</dt><dd>${item.shown}</dd></div><div><dt>Accepted</dt><dd>${item.acceptedCount}</dd></div><div><dt>Take rate</dt><dd>${item.takeRate}%</dd></div></dl><footer class="upsell-card-actions"><button class="secondary" type="button" data-upsell-action="edit" data-id="${item.id}">Edit</button><button class="secondary" type="button" data-upsell-action="analytics" data-id="${item.id}">Analytics</button>${rowActions(item, true)}</footer></article>`).join("")}</div>` : empty(upsells.length ? `No ${upsellStatusFilter} upsells.` : data.products.length > 1 ? "No COD upsells yet. Create your first post-purchase offer." : "Create at least two products first.")}</section></section><section class="panel" id="${exitOfferContainerId}"></section>`;
  const addUpsellButton = $("#add-upsell");
  if (data.products.length === 1) {
    addUpsellButton.disabled = false;
    addUpsellButton.title = "Offer another unit of your existing product";
    if (!upsells.length)
      el.querySelector(".empty").textContent =
        "Create an offer for another unit at a special price, or add a second product to offer an add-on.";
  }
  addUpsellButton.onclick = () => {
    if (data.products.length === 1)
      toast("One-product mode: offer another unit at a special price.");
    openUpsellWizard();
  };
  el.querySelectorAll("[data-upsell-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      upsellStatusFilter = button.dataset.upsellFilter;
      upsellsView(selector);
    }),
  );
  el.querySelectorAll("[data-upsell-action]").forEach((button) =>
    button.addEventListener("click", async () => {
      const item = upsells.find((candidate) => candidate.id === Number(button.dataset.id));
      if (!item) return;
      closeFloatingMenu();
      try {
        if (button.dataset.upsellAction === "edit") return openUpsellWizard(item);
        if (button.dataset.upsellAction === "analytics") return openUpsellAnalytics(item);
        if (button.dataset.upsellAction === "delete") {
          if (!confirm(`Delete ${item.name}?`)) return;
          await api(`/api/stores/${storeId}/upsells/${item.id}`, { method: "DELETE" });
          toast("Upsell deleted");
        } else if (button.dataset.upsellAction === "duplicate") {
          await api(`/api/stores/${storeId}/upsells/${item.id}/duplicate`, { method: "POST", body: "{}" });
          toast("Draft copy created");
        } else if (button.dataset.upsellAction === "toggle") {
          await api(`/api/stores/${storeId}/upsells/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: item.status === "active" ? "disabled" : "active" }),
          });
          toast(item.status === "active" ? "Upsell disabled" : "Upsell enabled");
        }
        await load();
      } catch (error) {
        toast(error.message);
      }
    }),
  );

  exitOffersView(`#${exitOfferContainerId}`);
}

function openUpsellAnalytics(item) {
  modal.classList.add("upsell-analytics-dialog");
  modal.addEventListener(
    "close",
    () => modal.classList.remove("upsell-analytics-dialog"),
    { once: true },
  );
  modalContent.innerHTML = `<div class="upsell-analytics-detail"><span class="eyebrow">UPSELL PERFORMANCE</span><h2>${esc(item.name)}</h2><div class="upsell-metrics">${metric("Shown", item.shown, "Offer views")}${metric("Accepted", item.acceptedCount, `${item.takeRate}% take rate`)}${metric("Rejected", item.rejectedCount, "Declined offers")}${metric("Revenue", rupees(item.upsellRevenuePaise), "Added order value")}</div><dl><div><dt>AOV before upsell</dt><dd>${rupees(item.aovBeforePaise)}</dd></div><div><dt>AOV after upsell</dt><dd>${rupees(item.aovAfterPaise)}</dd></div><div><dt>AOV lift</dt><dd>${rupees(Number(item.aovAfterPaise) - Number(item.aovBeforePaise))}</dd></div></dl><button class="secondary" id="close-upsell-analytics" type="button">Close</button></div>`;
  $("#close-upsell-analytics").onclick = () => modal.close();
  modal.showModal();
}

function openUpsellWizard(existing = null) {
  const firstProduct = data.products[0],
    singleProduct = data.products.length === 1,
    secondProduct = data.products.find((item) => item.id !== firstProduct?.id) || firstProduct,
    stepNames = ["Trigger", "Offer", "Design", "Behavior", "Review"],
    state = {
      name: existing?.name || "",
      status: existing?.status || "draft",
      triggerType: existing?.triggerType || (singleProduct ? "any_product" : "specific_product"),
      productId: existing?.productId || firstProduct?.id || "",
      triggerCollectionId: existing?.triggerCollectionId || "",
      triggerBundleId: existing?.triggerBundleId || "",
      minimumOrder: existing?.minimumOrderPaise == null ? "" : Number(existing.minimumOrderPaise) / 100,
      maximumOrder: existing?.maximumOrderPaise == null ? "" : Number(existing.maximumOrderPaise) / 100,
      upsellProductId: existing?.upsellProductId || secondProduct?.id || "",
      quantity: existing?.quantity || 1,
      price: existing ? Number(existing.pricePaise) / 100 : secondProduct ? Number(secondProduct.pricePaise) / 100 : "",
      headline: existing?.headline || "Add this to your order",
      subheadline: existing?.subheadline || "A special one-click offer before you go",
      description: existing?.description || "",
      useProductMedia: existing ? Boolean(existing.useProductMedia) : true,
      acceptButtonText: existing?.acceptButtonText || "Add To My Order",
      rejectButtonText: existing?.rejectButtonText || "No thanks, continue",
      allowExistingProduct: existing ? Boolean(existing.allowExistingProduct) : singleProduct,
    };
  let step = 1;
  const capture = () => {
      const form = $("#modal-form"), values = Object.fromEntries(new FormData(form));
      Object.assign(state, values, {
        useProductMedia: Boolean(form.elements.useProductMedia?.checked ?? state.useProductMedia),
        allowExistingProduct: Boolean(form.elements.allowExistingProduct?.checked ?? state.allowExistingProduct),
      });
    },
    options = (items, selected, label) => items.map((item) => `<option value="${item.id}" ${Number(selected) === Number(item.id) ? "selected" : ""}>${esc(label(item))}</option>`).join(""),
    selectedProduct = () => data.products.find((item) => item.id === Number(state.upsellProductId)) || secondProduct || firstProduct,
    renderStep = () => {
      const product = selectedProduct(), regular = Number(product?.pricePaise || 0) * Number(state.quantity || 1), offer = Math.round(Number(state.price || 0) * 100) * Number(state.quantity || 1), savings = Math.max(0, regular - offer), currentStepName = stepNames[step - 1];
      modalContent.innerHTML = `<div class="upsell-wizard"><header><div><span class="eyebrow">${existing ? "EDIT UPSELL" : "CREATE UPSELL"}</span><h2>${existing ? esc(existing.name) : "New COD Upsell"}</h2></div><span class="upsell-step-count">Step ${step} of 5</span></header><nav class="upsell-wizard-steps" aria-label="Upsell setup progress"><div class="upsell-mobile-progress"><strong>${currentStepName}</strong><span>Step ${step} of 5</span></div><div class="upsell-step-track">${stepNames.map((label, index) => `<span class="${step === index + 1 ? "active" : step > index + 1 ? "done" : ""}" ${step === index + 1 ? 'aria-current="step"' : ""}><b>${index + 1}</b>${label}</span>`).join("")}</div></nav><section class="upsell-wizard-body">${step === 1 ? `<h3>Choose when this offer appears</h3><label class="field">Internal upsell name<input name="name" value="${esc(state.name)}" placeholder="Hair care add-on" required></label><label class="field">Trigger type<select name="triggerType" id="upsell-trigger-type"><option value="any_product" ${state.triggerType === "any_product" ? "selected" : ""}>Any product</option><option value="specific_product" ${state.triggerType === "specific_product" ? "selected" : ""}>Specific product</option><option value="specific_collection" ${state.triggerType === "specific_collection" ? "selected" : ""}>Specific collection</option></select></label><label class="field" data-trigger-field="product">Trigger product<select name="productId">${options(data.products, state.productId, (item) => item.name)}</select></label><label class="field" data-trigger-field="collection">Trigger collection<select name="triggerCollectionId"><option value="">Choose collection</option>${options(ops.collections || [], state.triggerCollectionId, (item) => item.name)}</select></label><label class="field">Trigger bundle (optional)<select name="triggerBundleId"><option value="">Any bundle</option>${options(data.bundles || [], state.triggerBundleId, (item) => item.name)}</select></label><div class="form-columns"><label class="field">Minimum order value<input name="minimumOrder" type="number" min="0" step="0.01" value="${esc(state.minimumOrder)}"></label><label class="field">Maximum order value<input name="maximumOrder" type="number" min="0" step="0.01" value="${esc(state.maximumOrder)}"></label></div>` : step === 2 ? `<h3>Build the one-click offer</h3><label class="field">Offer product<select name="upsellProductId">${options(data.products, state.upsellProductId, (item) => `${item.name} · ${item.stock} in stock`)}</select></label><div class="form-columns"><label class="field">Quantity<input name="quantity" type="number" min="1" max="100" value="${esc(state.quantity)}" required></label><label class="field">Offer price per item (${esc(data.store.currency)})<input name="price" type="number" min="0" step="0.01" value="${esc(state.price)}" required></label></div><div class="upsell-savings"><span>Regular total <strong>${rupees(regular)}</strong></span><span>Offer total <strong>${rupees(offer)}</strong></span><span>Customer saves <strong>${rupees(savings)}</strong></span></div><label class="toggle-row"><span><strong>Allow when product is already in the order</strong><small>Normally disabled to prevent accidental duplicates.</small></span><input name="allowExistingProduct" type="checkbox" ${state.allowExistingProduct ? "checked" : ""}></label>` : step === 3 ? `<h3>Design the offer</h3><div class="upsell-design-grid"><div><label class="field">Headline<input name="headline" value="${esc(state.headline)}" required></label><label class="field">Subheadline<input name="subheadline" value="${esc(state.subheadline)}"></label><label class="field">Description<textarea name="description">${esc(state.description)}</textarea></label><label class="toggle-row"><span><strong>Use connected product media</strong><small>Shows the product's main storefront image.</small></span><input name="useProductMedia" type="checkbox" ${state.useProductMedia ? "checked" : ""}></label><label class="field">Accept button text<input name="acceptButtonText" value="${esc(state.acceptButtonText)}" required></label><label class="field">Reject link text<input name="rejectButtonText" value="${esc(state.rejectButtonText)}" required></label></div><aside class="upsell-live-preview"><span>Live preview</span><div><small>POST-PURCHASE OFFER</small><h4>${esc(state.headline)}</h4><p>${esc(state.subheadline)}</p><strong>${esc(product?.name || "Offer product")}</strong><b>${rupees(offer)}</b><button type="button">${esc(state.acceptButtonText)}</button><u>${esc(state.rejectButtonText)}</u></div></aside></div>` : step === 4 ? `<h3>Choose what happens next</h3><div class="upsell-behavior-card"><span>Customer accepts</span><strong>Add item to the same order → Thank You page</strong><small>Price, quantity, inventory, total, and order timeline update atomically.</small></div><div class="upsell-behavior-card"><span>Customer rejects</span><strong>Keep the original order → Thank You page</strong><small>Rejecting never cancels or changes the confirmed COD order.</small></div><p class="notice">Downsell routing can be added later. This release always finishes on the confirmed Thank You page.</p>` : `<h3>Review and activate</h3><div class="upsell-review-grid"><dl><div><dt>Name</dt><dd>${esc(state.name)}</dd></div><div><dt>Trigger</dt><dd>${esc(state.triggerType.replaceAll("_", " "))}</dd></div><div><dt>Offer</dt><dd>${esc(product?.name || "")} × ${esc(state.quantity)}</dd></div><div><dt>Offer total</dt><dd>${rupees(offer)}</dd></div><div><dt>Customer flow</dt><dd>Existing order → offer → Thank You</dd></div></dl><label class="field">Save status<select name="status"><option value="active" ${state.status === "active" ? "selected" : ""}>Active</option><option value="draft" ${state.status === "draft" ? "selected" : ""}>Draft</option><option value="disabled" ${state.status === "disabled" ? "selected" : ""}>Disabled</option></select></label><ul><li>Main COD order is created before this offer is shown.</li><li>Offer values are enforced by the server.</li><li>Accepted offers update the same order once.</li></ul></div>`}</section><footer><button class="secondary" id="upsell-back" type="button" ${step === 1 ? "disabled" : ""}>Back</button><button class="primary" id="upsell-next" type="${step === 5 ? "submit" : "button"}">${step === 5 ? existing ? "Save Upsell" : "Create Upsell" : "Continue"}</button></footer></div>`;
      const form = $("#modal-form");
      form.onsubmit = async (event) => {
        event.preventDefault();
        capture();
        try {
          const payload = {
            ...state,
            productId: Number(state.productId),
            upsellProductId: Number(state.upsellProductId),
            triggerCollectionId: state.triggerCollectionId ? Number(state.triggerCollectionId) : null,
            triggerBundleId: state.triggerBundleId ? Number(state.triggerBundleId) : null,
            quantity: Number(state.quantity),
            pricePaise: Math.round(Number(state.price) * 100),
            minimumOrderPaise: state.minimumOrder === "" ? null : Math.round(Number(state.minimumOrder) * 100),
            maximumOrderPaise: state.maximumOrder === "" ? null : Math.round(Number(state.maximumOrder) * 100),
          };
          await api(existing ? `/api/stores/${storeId}/upsells/${existing.id}` : `/api/stores/${storeId}/upsells`, { method: existing ? "PATCH" : "POST", body: JSON.stringify(payload) });
          modal.close();
          toast(existing ? "Upsell updated" : "Upsell created");
          await load();
        } catch (error) { toast(error.message); }
      };
      $("#upsell-back").onclick = () => { capture(); step -= 1; renderStep(); };
      if (step < 5) $("#upsell-next").onclick = () => {
        if (!form.reportValidity()) return;
        capture();
        if (step === 1 && state.triggerType === "specific_collection" && !state.triggerCollectionId) return toast("Choose a trigger collection");
        step += 1;
        renderStep();
      };
      const syncTrigger = () => {
        const type = $("#upsell-trigger-type")?.value || state.triggerType;
        modalContent.querySelector('[data-trigger-field="product"]')?.toggleAttribute("hidden", type !== "specific_product");
        modalContent.querySelector('[data-trigger-field="collection"]')?.toggleAttribute("hidden", type !== "specific_collection");
      };
      $("#upsell-trigger-type")?.addEventListener("change", syncTrigger);
      syncTrigger();
    };
  modal.classList.add("upsell-wizard-dialog");
  modal.addEventListener(
    "close",
    () => modal.classList.remove("upsell-wizard-dialog"),
    { once: true },
  );
  renderStep();
  modal.showModal();
}
function downsellsView(selector = "#product-section") {
  const el = $(selector),
    downsells = data.downsells || [];
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>COD Downsells</h2><span>Offer a lower-priced alternative to recover COD orders.</span></div><button class="primary" id="add-downsell" ${data.products.length > 1 ? "" : "disabled"}>+ Create downsell</button></div>${downsells.length ? `<table><thead><tr><th>MAIN PRODUCT</th><th>DOWNSELL OFFER</th><th>ALTERNATIVE PRODUCT</th><th>OFFER PRICE</th><th>STOCK</th><th>STATUS</th></tr></thead><tbody>${downsells.map((downsell) => `<tr><td>${esc(downsell.productName)}</td><td><strong>${esc(downsell.title)}</strong></td><td>${esc(downsell.downsellProductName)}</td><td>${rupees(downsell.pricePaise)}</td><td>${downsell.downsellProductStock}</td><td><span class="pill">${downsell.active ? "Active" : "Inactive"}</span></td></tr>`).join("")}</tbody></table>` : empty(data.products.length > 1 ? "No COD downsells yet." : "Create at least two products first.")}</section>`;
  $("#add-downsell").onclick = () =>
    openForm(
      "Create downsell",
      `<label class="field">Main product<select name="productId">${productOptions()}</select></label><label class="field">Lower-priced alternative<select name="downsellProductId">${productOptions()}</select></label><label class="field">Offer headline<input name="title" placeholder="Prefer a smaller starter size?" required></label><label class="field">Downsell price (${esc(data?.store?.currency || "Currency")})<input name="price" type="number" min="0" step="0.01" required></label>`,
      "Create downsell",
      (v) =>
        api(`/api/stores/${storeId}/downsells`, {
          method: "POST",
          body: JSON.stringify({
            productId: Number(v.productId),
            downsellProductId: Number(v.downsellProductId),
            title: v.title,
            pricePaise: Math.round(Number(v.price) * 100),
          }),
        }),
    );
}
function discountsView() {
  const el = $("#product-section");
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Discount Coupon Codes</h2><span>Create codes customers can apply during checkout.</span></div><button class="primary" id="add-coupon">+ Create coupon code</button></div>${data.coupons.length ? `<table><thead><tr><th>CODE</th><th>DISCOUNT</th><th>MINIMUM ORDER</th><th>USES</th><th>EXPIRY</th><th>STATUS</th></tr></thead><tbody>${data.coupons.map((coupon) => `<tr><td><strong>${esc(coupon.code)}</strong></td><td>${coupon.discountType === "percent" ? `${coupon.value}%` : rupees(coupon.value)}</td><td>${rupees(coupon.minimumOrderPaise)}</td><td>${coupon.usedCount}${coupon.usageLimit ? ` / ${coupon.usageLimit}` : " / ∞"}</td><td>${coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleString("en-IN") : "No expiry"}</td><td><span class="pill">${coupon.active ? "Active" : "Inactive"}</span></td></tr>`).join("")}</tbody></table>` : empty("No coupon codes yet.")}</section>`;
  $("#add-coupon").onclick = () =>
    openForm(
      "Create coupon code",
      `<label class="field">Coupon code<input name="code" placeholder="SAVE10" required></label><label class="field">Discount type<select name="discountType"><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></label><label class="field">Discount value<input name="value" type="number" min="1" step="0.01" required></label><label class="field">Minimum order (${esc(data?.store?.currency || "Currency")})<input name="minimumOrder" type="number" min="0" step="0.01" value="0"></label><label class="field">Usage limit (optional)<input name="usageLimit" type="number" min="1"></label><label class="field">Expiry (optional)<input name="expiresAt" type="datetime-local"></label>`,
      "Create coupon code",
      (v) =>
        api(`/api/stores/${storeId}/coupons`, {
          method: "POST",
          body: JSON.stringify({
            code: v.code,
            discountType: v.discountType,
            value:
              v.discountType === "fixed"
                ? Math.round(Number(v.value) * 100)
                : Number(v.value),
            minimumOrderPaise: Math.round(Number(v.minimumOrder || 0) * 100),
            usageLimit: v.usageLimit ? Number(v.usageLimit) : null,
            expiresAt: v.expiresAt || null,
          }),
        }),
    );
}
function collectionsView() {
  const el = $("#product-section");
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Collections</h2><span>Real product grouping scoped to this store.</span></div><button class="primary" id="add-collection">+ Create collection</button></div>${ops.collections.length ? ops.collections.map((c) => `<article class="collection-card"><div><strong>${esc(c.name)}</strong><small>/${esc(c.slug)}</small><p>${esc(c.description)}</p></div><div>${c.products.length ? c.products.map((p) => `<span class="pill">${esc(p.name)} <button class="tiny remove-collection-product" data-collection="${c.id}" data-product="${p.id}">×</button></span>`).join(" ") : '<span class="muted">No products</span>'}</div>${data.products.length ? `<button class="secondary add-collection-product" data-id="${c.id}">Add product</button>` : ""}</article>`).join("") : empty("No collections yet.")}</section>`;
  $("#add-collection").onclick = () =>
    openForm(
      "Create collection",
      `<label class="field">Name<input name="name" required></label><label class="field">URL slug<input name="slug" required></label><label class="field">Description<textarea name="description"></textarea></label>`,
      "Create collection",
      (v) =>
        api(`/api/stores/${storeId}/collections`, {
          method: "POST",
          body: JSON.stringify(v),
        }),
    );
  document
    .querySelectorAll(".add-collection-product")
    .forEach(
      (button) =>
        (button.onclick = () =>
          openForm(
            "Add product to collection",
            `<label class="field">Product<select name="productId">${productOptions()}</select></label>`,
            "Add product",
            (v) =>
              api(
                `/api/stores/${storeId}/collections/${button.dataset.id}/products/${v.productId}`,
                { method: "POST" },
              ),
          )),
    );
  document.querySelectorAll(".remove-collection-product").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/collections/${button.dataset.collection}/products/${button.dataset.product}`,
            { method: "DELETE" },
          );
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
function inventoryView() {
  const el = $("#product-section"),
    inventoryRows = ops.inventory
      .map(
        (item) =>
          `<tr><td><strong>${esc(item.productName)}</strong></td><td>${esc(item.locationName)}</td><td><span class="pill">${item.quantity}</span></td></tr>`,
      )
      .join(""),
    inventoryCards = ops.inventory
      .map(
        (item) =>
          `<article class="data-mobile-card inventory-mobile-card"><header><div><small>Product</small><strong>${esc(item.productName)}</strong></div><span class="pill" aria-label="${item.quantity} available">${item.quantity} available</span></header><dl><div><dt>Location</dt><dd>${esc(item.locationName)}</dd></div><div><dt>Available</dt><dd><strong>${item.quantity}</strong></dd></div></dl></article>`,
      )
      .join(""),
    movementRows = ops.movements
      .slice(0, 30)
      .map(
        (movement) =>
          `<tr><td>${new Date(movement.createdAt + "Z").toLocaleString("en-IN")}</td><td>${esc(movement.productName)}</td><td>${esc(movement.locationName)}</td><td class="${movement.delta < 0 ? "danger" : ""}">${movement.delta > 0 ? "+" : ""}${movement.delta}</td><td>${esc(movement.reason.replaceAll("_", " "))}</td></tr>`,
      )
      .join(""),
    movementCards = ops.movements
      .slice(0, 30)
      .map(
        (movement) =>
          `<article class="data-mobile-card inventory-movement-mobile-card"><header><div><small>Product</small><strong>${esc(movement.productName)}</strong></div><strong class="mobile-card-change ${movement.delta < 0 ? "danger" : ""}">${movement.delta > 0 ? "+" : ""}${movement.delta}</strong></header><dl><div><dt>Location</dt><dd>${esc(movement.locationName)}</dd></div><div><dt>Reason</dt><dd class="mobile-card-readable">${esc(movement.reason.replaceAll("_", " "))}</dd></div><div class="mobile-card-wide"><dt>Time</dt><dd>${new Date(movement.createdAt + "Z").toLocaleString("en-IN")}</dd></div></dl></article>`,
      )
      .join("");
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Inventory by location</h2><span>Orders, purchase receipts, and transfers produce real movements.</span></div><button class="primary" id="add-location">+ Add location</button></div>${ops.inventory.length ? `<div class="table-scroll data-desktop-list"><table><thead><tr><th>PRODUCT</th><th>LOCATION</th><th>AVAILABLE</th></tr></thead><tbody>${inventoryRows}</tbody></table></div><div class="data-mobile-list" aria-label="Inventory by location">${inventoryCards}</div>` : empty("Add a product to begin inventory tracking.")}</section><section class="panel"><div class="panel-head"><h2>Inventory movement history</h2></div>${
    ops.movements.length
      ? `<div class="table-scroll data-desktop-list"><table><thead><tr><th>TIME</th><th>PRODUCT</th><th>LOCATION</th><th>CHANGE</th><th>REASON</th></tr></thead><tbody>${movementRows}</tbody></table></div><div class="data-mobile-list" aria-label="Inventory movement history">${movementCards}</div>`
      : empty("No inventory movements yet.")
  }</section>`;
  $("#add-location").onclick = () =>
    openForm(
      "Add inventory location",
      `<label class="field">Location name<input name="name" required></label>`,
      "Create location",
      (v) =>
        api(`/api/stores/${storeId}/locations`, {
          method: "POST",
          body: JSON.stringify(v),
        }),
    );
}
function purchaseOrdersView() {
  const el = $("#product-section"),
    purchaseOrderRows = ops.purchaseOrders
      .map(
        (po) =>
          `<tr><td><strong>${esc(po.poNumber)}</strong></td><td>${esc(po.vendor)}</td><td>${po.itemCount}</td><td>${rupees(po.totalCostPaise)}</td><td><span class="pill mobile-card-readable">${esc(po.status.replaceAll("_", " "))}</span></td><td>${po.status === "ordered" ? `<button class="secondary receive-po" data-id="${po.id}">Receive stock</button>` : "Inventory updated"}</td></tr>`,
      )
      .join(""),
    purchaseOrderCards = ops.purchaseOrders
      .map(
        (po) =>
          `<article class="data-mobile-card purchase-order-mobile-card"><header><div><small>Purchase order</small><strong>${esc(po.poNumber)}</strong><span>${esc(po.vendor)}</span></div><span class="pill mobile-card-readable">${esc(po.status.replaceAll("_", " "))}</span></header><dl><div><dt>Items</dt><dd>${po.itemCount}</dd></div><div><dt>Cost</dt><dd><strong>${rupees(po.totalCostPaise)}</strong></dd></div></dl><footer>${po.status === "ordered" ? `<button class="secondary receive-po" data-id="${po.id}" type="button">Receive stock</button>` : '<span class="mobile-card-complete">Inventory updated</span>'}</footer></article>`,
      )
      .join("");
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Purchase Orders</h2><span>Receiving a PO increases actual stock.</span></div><button class="primary" id="add-po" ${data.products.length ? "" : "disabled"}>+ Create PO</button></div>${ops.purchaseOrders.length ? `<div class="table-scroll data-desktop-list"><table><thead><tr><th>PO</th><th>VENDOR</th><th>ITEMS</th><th>COST</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${purchaseOrderRows}</tbody></table></div><div class="data-mobile-list" aria-label="Purchase orders">${purchaseOrderCards}</div>` : empty("No purchase orders yet.")}</section>`;
  $("#add-po").onclick = () =>
    openForm(
      "Create purchase order",
      `<label class="field">Vendor<input name="vendor" required></label><label class="field">Product<select name="productId">${productOptions()}</select></label><label class="field">Quantity<input name="quantity" type="number" min="1" required></label><label class="field">Unit cost (${esc(data?.store?.currency || "Currency")})<input name="unitCost" type="number" min="0" step="0.01" required></label>`,
      "Create PO",
      (v) =>
        api(`/api/stores/${storeId}/purchase-orders`, {
          method: "POST",
          body: JSON.stringify({
            vendor: v.vendor,
            items: [
              {
                productId: Number(v.productId),
                quantity: Number(v.quantity),
                unitCostPaise: Math.round(Number(v.unitCost) * 100),
              },
            ],
          }),
        }),
    );
  document.querySelectorAll(".receive-po").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/purchase-orders/${button.dataset.id}/receive`,
            { method: "POST" },
          );
          toast("Stock received and inventory updated");
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
function transfersView() {
  const el = $("#product-section"),
    transferRows = ops.transfers
      .map(
        (transfer) =>
          `<tr><td><strong>${esc(transfer.transferNumber)}</strong></td><td>${esc(transfer.sourceName)}</td><td>${esc(transfer.destinationName)}</td><td>${transfer.units}</td><td><span class="pill mobile-card-readable">${esc(transfer.status.replaceAll("_", " "))}</span></td><td>${transfer.status === "in_transit" ? `<button class="secondary receive-transfer" data-id="${transfer.id}">Receive transfer</button>` : "Received"}</td></tr>`,
      )
      .join(""),
    transferCards = ops.transfers
      .map(
        (transfer) =>
          `<article class="data-mobile-card transfer-mobile-card"><header><div><small>Transfer</small><strong>${esc(transfer.transferNumber)}</strong></div><span class="pill mobile-card-readable">${esc(transfer.status.replaceAll("_", " "))}</span></header><div class="transfer-mobile-route"><div><small>From</small><strong>${esc(transfer.sourceName)}</strong></div><span aria-hidden="true">→</span><div><small>To</small><strong>${esc(transfer.destinationName)}</strong></div></div><dl><div><dt>Units</dt><dd><strong>${transfer.units}</strong></dd></div></dl><footer>${transfer.status === "in_transit" ? `<button class="secondary receive-transfer" data-id="${transfer.id}" type="button">Receive transfer</button>` : '<span class="mobile-card-complete">Received</span>'}</footer></article>`,
      )
      .join("");
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Transfers</h2><span>Move tracked stock between business locations.</span></div><button class="primary" id="add-transfer" ${data.products.length && ops.locations.length > 1 ? "" : "disabled"}>+ Create transfer</button></div>${ops.locations.length < 2 ? '<p class="notice">Create a second location in Inventory before making a transfer.</p>' : ""}${ops.transfers.length ? `<div class="table-scroll data-desktop-list"><table><thead><tr><th>TRANSFER</th><th>FROM</th><th>TO</th><th>UNITS</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${transferRows}</tbody></table></div><div class="data-mobile-list" aria-label="Inventory transfers">${transferCards}</div>` : empty("No transfers yet.")}</section>`;
  $("#add-transfer").onclick = () =>
    openForm(
      "Create transfer",
      `<label class="field">Source<select name="sourceLocationId">${locationOptions()}</select></label><label class="field">Destination<select name="destinationLocationId">${locationOptions()}</select></label><label class="field">Product<select name="productId">${productOptions()}</select></label><label class="field">Quantity<input name="quantity" type="number" min="1" required></label>`,
      "Start transfer",
      (v) =>
        api(`/api/stores/${storeId}/transfers`, {
          method: "POST",
          body: JSON.stringify({
            sourceLocationId: Number(v.sourceLocationId),
            destinationLocationId: Number(v.destinationLocationId),
            items: [
              { productId: Number(v.productId), quantity: Number(v.quantity) },
            ],
          }),
        }),
    );
  document.querySelectorAll(".receive-transfer").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/transfers/${button.dataset.id}/receive`,
            { method: "POST" },
          );
          toast("Transfer received at destination");
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
function giftCardsView() {
  const el = $("#product-section");
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Gift Cards</h2><span>Issue and manage persistent store credit codes.</span></div><button class="primary" id="issue-card">+ Issue gift card</button></div>${ops.giftCards.length ? `<table><thead><tr><th>CODE</th><th>INITIAL</th><th>BALANCE</th><th>STATUS</th><th>NOTE</th><th>ACTION</th></tr></thead><tbody>${ops.giftCards.map((c) => `<tr><td><strong>${esc(c.code)}</strong></td><td>${rupees(c.initialBalancePaise)}</td><td>${rupees(c.balancePaise)}</td><td><span class="pill">${esc(c.status)}</span></td><td>${esc(c.note)}</td><td>${c.status === "active" ? `<button class="secondary disable-card" data-id="${c.id}">Disable</button>` : "—"}</td></tr>`).join("")}</tbody></table>` : empty("No gift cards issued.")}</section>`;
  $("#issue-card").onclick = () =>
    openForm(
      "Issue gift card",
      `<label class="field">Code (optional)<input name="code" placeholder="Auto-generate if empty"></label><label class="field">Initial balance (${esc(data?.store?.currency || "Currency")})<input name="balance" type="number" min="1" step="0.01" required></label><label class="field">Internal note<textarea name="note"></textarea></label>`,
      "Issue card",
      (v) =>
        api(`/api/stores/${storeId}/gift-cards`, {
          method: "POST",
          body: JSON.stringify({
            code: v.code,
            initialBalancePaise: Math.round(Number(v.balance) * 100),
            note: v.note,
          }),
        }),
    );
  document.querySelectorAll(".disable-card").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/gift-cards/${button.dataset.id}/disable`,
            { method: "POST" },
          );
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
function pagesView() {
  const projectOptions = data.projects
    .map(
      (p) =>
        `<option value="${p.id}">${esc(p.name)} — ${esc(p.productName)}</option>`,
    )
    .join("");
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Projects</h2><span>One store can run multiple product funnels.</span></div><button class="primary" id="add-project" ${data.products.length ? "" : "disabled"}>+ New project</button></div>${data.projects.length ? `<div class="project-grid">${data.projects.map((p) => `<article class="project-card"><span class="pill">${p.pageCount} page${p.pageCount === 1 ? "" : "s"}</span><h3>${esc(p.name)}</h3><p>${esc(p.productName)}</p><small>/${esc(p.slug)}</small></article>`).join("")}</div>` : empty(data.products.length ? "No projects yet. Create one for a product." : "Create a product first.")}</section>
  <section class="panel"><div class="panel-head"><div><h2>Product Page Creation</h2><span>Every option creates an editable, previewable, publishable product page.</span></div></div><div class="method-grid"><button class="method-card" data-method="upload" ${data.products.length ? "" : "disabled"}><b>01</b><strong>Upload / Import Pre-Built Page</strong><span>Upload and safely process an HTML page file</span></button><button class="method-card" data-method="blank" ${data.products.length ? "" : "disabled"}><b>02</b><strong>Create New Page</strong><span>Start with editable product-page sections</span></button><button class="method-card" data-method="ai" ${data.products.length && aiState.available ? "" : "disabled"}><b>03</b><strong>Create With AI</strong><span>${aiState.available ? `${esc(aiState.provider)} · ${esc(aiState.model)}` : "Requires explicit provider authorization"}</span></button></div><p class="notice">Upload → Process → Preview → Connect Product → Configure CTA/COD → Save → Publish.</p>${!aiState.available ? '<p class="notice">Create With AI remains unavailable until you explicitly authorize a provider, model, call count, settings, and estimated cost.</p>' : ""}</section>
  <section class="panel"><div class="panel-head"><h2>High-Quality Templates</h2><span>${templates.length} responsive designs</span></div><div class="template-grid">${templates.map((t) => `<article class="template-card" style="--preview-bg:${t.designTokens.background};--preview-text:${t.designTokens.text};--preview-accent:${t.designTokens.accent}"><div class="template-preview"><i></i><strong>A better routine.</strong><span></span><button></button></div><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p><small>${esc(t.preview)}</small></article>`).join("")}</div></section>
  <section class="panel"><div class="panel-head"><div><h2>Pages</h2><span>Draft, edit, preview and publish.</span></div></div>${
    data.pages.length
      ? `<table><thead><tr><th>PAGE</th><th>PROJECT</th><th>PRODUCT</th><th>METHOD</th><th>REVIEWS</th><th>URGENCY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${data.pages
          .map((p) => {
            const options = (() => {
              try {
                const pageContent = JSON.parse(p.contentJson || "{}");
                return {
                  proof:
                    pageContent.socialProofType === "fake"
                      ? "Fake social"
                      : "Real social",
                  urgency: pageContent.urgency?.enabled
                    ? pageContent.urgency.text || "Enabled"
                    : "None",
                };
              } catch {
                return { proof: "Real social", urgency: "None" };
              }
            })();
            return `<tr><td><strong>${esc(p.title)}</strong><br><small>/${esc(p.slug)}</small></td><td>${esc(p.projectName || "Legacy page")}</td><td>${esc(p.productName)}</td><td><span class="pill">${esc(p.creationMethod || "blank")}</span></td><td>${esc(options.proof)}</td><td>${esc(options.urgency)}</td><td><span class="pill">${esc(p.status)}</span></td><td><button class="secondary edit-page" data-id="${p.id}">Edit</button> <a class="link" target="_blank" href="/api/stores/${storeId}/pages/${p.id}/preview">Preview ↗</a> ${p.status === "draft" ? `<button class="secondary publish" data-id="${p.id}">Publish</button>` : `<a class="link" target="_blank" href="${esc(storeUrl(encodeURIComponent(p.slug)))}">Open live ↗</a>`}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : empty("No product pages yet.")
  }</section>`;

  $("#add-project").onclick = () =>
    openForm(
      "Create project",
      `<label class="field">Project name<input name="name" required></label><label class="field">URL slug<input name="slug" required></label><label class="field">Product<select name="productId">${productOptions()}</select></label>`,
      "Create project",
      (v) =>
        api(`/api/stores/${storeId}/projects`, {
          method: "POST",
          body: JSON.stringify({ ...v, productId: Number(v.productId) }),
        }),
    );
  document
    .querySelectorAll("[data-method]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          createPageForm(button.dataset.method, projectOptions)),
    );
  document.querySelectorAll(".publish").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/pages/${button.dataset.id}/publish`,
            { method: "POST" },
          );
          toast("Page is now live");
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document
    .querySelectorAll(".edit-page")
    .forEach(
      (button) =>
        (button.onclick = () => editPageForm(Number(button.dataset.id))),
    );
}

function createPageForm(method) {
  if (method === "upload") return uploadPageWizard();
  const common = `<label class="field">Page Name<input name="title" required></label><label class="field">Connected Product<select name="productId" required>${productOptions()}</select></label><label class="field">Status<select name="status" required><option value="draft">Draft</option><option value="published">Published</option></select></label><label class="field">URL slug<input name="slug" required></label><label class="field">Urgency creation<select name="urgencyType"><option value="none">No urgency</option><option value="limited-stock">Limited stock</option><option value="limited-time">Limited time</option><option value="high-demand">High demand</option></select></label><label class="field">Urgency message<input name="urgencyText" placeholder="Limited stock available"></label><label class="field">Announcement Bar message (optional)<input name="announcementText" placeholder="Add an announcement"></label>`;
  if (method === "ai")
    return openForm(
      "Create With AI",
      `${common}<label class="field">Product and offer brief<textarea name="brief" required></textarea></label><p class="notice">The explicitly authorized provider generates editable sections, not a static screenshot.</p>`,
      "Create With AI",
      (v) => createPageRequest(v, "ai"),
    );
  return openForm(
    "Create New Page",
    `${common}<label class="field">Opening story<textarea name="body" required></textarea></label>`,
    "Save",
    (v) => createPageRequest(v, "blank"),
  );
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("Unable to read Page File"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}
function importedPreviewDocument(html) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>.reveal,.reveal-scale,[data-aos],.wow{opacity:1!important;visibility:visible!important;transform:none!important}</style></head><body>${html || ""}</body></html>`;
}
function showImportedPreview(area, result) {
  area.hidden = false;
  let warning = area.querySelector(".import-warning");
  if (!warning) {
    warning = document.createElement("p");
    warning.className = "import-warning";
    warning.setAttribute("role", "alert");
    area.prepend(warning);
  }
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  warning.hidden = warnings.length === 0;
  warning.textContent = warnings.join(" ");
  area.querySelector("iframe").srcdoc = importedPreviewDocument(
    result.previewHtml,
  );
}
function uploadPageWizard() {
  modalContent.innerHTML = `<h2>Upload / Import Pre-Built Page</h2><div class="quick-flow"><div class="step"><b>01</b>Upload</div><div class="step"><b>02</b>Process</div><div class="step"><b>03</b>Preview</div><div class="step"><b>04</b>Connect Product</div><div class="step"><b>05</b>Configure CTA/COD</div><div class="step"><b>06</b>Save</div><div class="step"><b>07</b>Publish</div></div><label class="field">Page Name<input name="title" required></label><label class="field">Page File / Supported Import<input name="file" type="file" accept=".html,.htm,text/html" required></label><button class="secondary" id="process-page-file" type="button">Process & Preview</button><div id="import-preview" hidden><iframe title="Preview" sandbox style="width:100%;min-height:260px"></iframe><label class="field">Connected Product<select name="productId" required>${productOptions()}</select></label><label class="field">Status<select name="status" required><option value="draft">Draft</option><option value="published">Published</option></select></label><label class="field">URL slug<input name="slug" required></label><label class="field">CTA text<input name="ctaText" value="Order with COD" required></label><label class="field checkbox"><input name="codEnabled" type="checkbox" checked> <span>Configure CTA/COD — enable working COD checkout</span></label><button class="primary" type="submit">Save</button></div><p class="notice">Supported Import: .html and .htm, maximum 500 KB. Scripts, forms, iframes, event handlers, and unsafe links are removed.</p>`;
  const form = $("#modal-form");
  let processed = null;
  $("#process-page-file").onclick = async () => {
    try {
      const file = form.elements.file.files[0];
      if (!file) throw Error("Page File / Supported Import is required");
      const fileContentBase64 = await fileToBase64(file);
      processed = {
        fileName: file.name,
        mimeType: file.type || "text/html",
        fileContentBase64,
      };
      const result = await api(`/api/stores/${storeId}/page-imports/preview`, {
        method: "POST",
        body: JSON.stringify(processed),
      });
      const area = $("#import-preview");
      showImportedPreview(area, result);
      toast("Page processed — Preview ready");
    } catch (error) {
      toast(error.message);
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      if (!processed) throw Error("Process and Preview the Page File first");
      const values = Object.fromEntries(new FormData(form));
      await createPageRequest(
        { ...values, ...processed, codEnabled: values.codEnabled === "on" },
        "upload",
      );
      modal.close();
      toast(
        values.status === "published"
          ? "Saved and published"
          : "Saved as draft",
      );
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  modal.showModal();
}
function createPageRequest(values, creationMethod) {
  const payload = {
    creationMethod,
    productId: Number(values.productId),
    title: values.title,
    pageName: values.title,
    slug: values.slug,
    status: values.status || "draft",
    body: values.body,
    templateKey: values.templateKey,
    html: values.html,
    fileName: values.fileName,
    mimeType: values.mimeType,
    fileContentBase64: values.fileContentBase64,
    brief: values.brief,
    redirectUrl: values.redirectUrl,
    ctaText: values.ctaText,
    ctaAction: values.ctaAction,
    codEnabled: values.codEnabled,
    socialProofType: values.socialProofType,
    urgencyType: values.urgencyType,
    urgencyText: values.urgencyText,
    announcementText: values.announcementText,
  };
  return api(`/api/stores/${storeId}/pages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function editPageForm() {}
function orderStatusLabel(value) {
  return String(value || "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
function orderDisplayDate(value) {
  if (!value) return "—";
  const text = String(value),
    date = new Date(
      /(?:Z|[+-]\d\d:?\d\d)$/.test(text)
        ? text
        : `${text.replace(" ", "T")}Z`,
    );
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}
function orderChannelLabel(channel) {
  return channel === "product_page" ? "Online Store" : orderStatusLabel(channel);
}
function orderDetailMenu(order) {
  return `<details class="row-menu order-row-menu"><summary aria-label="Actions for order ${esc(order.orderNumber)}">⋯</summary><div class="order-menu-detail"><button class="order-open-detail" data-order-id="${order.id}" type="button">View order</button><button data-order-action="archive" data-order-id="${order.id}" type="button">${order.archived ? "Restore" : "Archive"}</button><button data-order-action="tags" data-order-id="${order.id}" type="button">Add tags</button>${order.fulfillmentStatus !== "cancelled" ? `<button data-order-action="fulfillment" data-order-id="${order.id}" type="button">Update fulfillment</button><button data-order-action="delivery" data-order-id="${order.id}" type="button">Update delivery</button>` : ""}${order.fulfillmentStatus === "unfulfilled" && order.paymentStatus !== "paid" ? `<button class="danger-text" data-order-action="cancel" data-order-id="${order.id}" type="button">Cancel order</button>` : ""}</div></details>`;
}
function wireOrderDetailLinks(root = document) {
  root.querySelectorAll(".order-open-detail").forEach(
    (button) =>
      (button.onclick = () =>
        navigateTo(`/orders/${Number(button.dataset.orderId)}`)),
  );
}
function orderRowData(order) {
  return `data-order-row data-order-id="${order.id}" data-search="${esc(`${order.orderNumber} ${order.customerName} ${order.customerPhone} ${(order.tags || []).join(" ")}`.toLowerCase())}" data-status="${esc(order.fulfillmentStatus)}" data-payment="${esc(order.paymentStatus)}" data-delivery="${esc(order.deliveryStatus)}"`;
}
const orderColumnLabels={date:"Date",customer:"Customer",channel:"Channel",total:"Total",paymentStatus:"Payment status",fulfillmentStatus:"Fulfillment status",items:"Items",deliveryStatus:"Delivery status",deliveryMethod:"Delivery method",tags:"Tags",destination:"Destination",returnStatus:"Return status"};
function orderCell(order,key){const cells={date:`<time datetime="${esc(order.createdAt||"")}">${orderDisplayDate(order.createdAt)}</time>`,customer:`<strong>${esc(order.customerName)}</strong><small>${esc(order.customerPhone)}</small>`,channel:esc(orderChannelLabel(order.channel)),total:`<strong>${rupees(order.totalPaise)}</strong>`,paymentStatus:`<span class="status-badge is-${esc(order.paymentStatus)}">${esc(orderStatusLabel(order.paymentStatus))}</span>`,fulfillmentStatus:`<span class="status-badge is-${esc(order.fulfillmentStatus)}">${esc(orderStatusLabel(order.fulfillmentStatus))}</span>`,items:`${Number(order.itemCount||0)}<small>${esc(order.itemSummary||"")}</small>`,deliveryStatus:`<span class="order-delivery-label">${esc(orderStatusLabel(order.deliveryStatus))}</span>`,deliveryMethod:esc(order.deliveryMethod||order.shippingMethod||"—"),tags:(order.tags||[]).length?(order.tags||[]).map((tag)=>`<span class="pill">${esc(tag)}</span>`).join(" "):"—",destination:esc([order.customerCity,order.customerState,order.customerCountry].filter(Boolean).join(", ")||"—"),returnStatus:esc(orderStatusLabel(order.returnStatus||"—"))};return cells[key]||"—";}
function ordersTable(orders, { selectable = false, preferences = null } = {}) {
  const columns=selectable?(preferences?.columnOrder||Object.keys(orderColumnLabels)).filter((key)=>(preferences?.visibleColumns||Object.keys(orderColumnLabels)).includes(key)):["date","customer","channel","total","paymentStatus","fulfillmentStatus","deliveryStatus"];
  return orders.length
    ? `<table class="merchant-table orders-table ${selectable ? "orders-table-selectable" : "orders-table-summary"}"><thead><tr>${selectable ? '<th><input id="select-all-orders" type="checkbox" aria-label="Select all orders"></th>' : ""}<th>ORDER</th>${columns.map((key)=>`<th>${esc(orderColumnLabels[key])}</th>`).join("")}<th><span class="sr-only">Actions</span></th></tr></thead><tbody>${orders.map((order) => `<tr ${orderRowData(order)}>${selectable ? `<td class="order-select-cell"><input class="order-checkbox" type="checkbox" value="${order.id}" aria-label="Select order ${esc(order.orderNumber)}"></td>` : ""}<td data-label="Order" class="order-number-cell"><button class="order-number-link order-open-detail" data-order-id="${order.id}" type="button" title="Open order ${esc(order.orderNumber)}" aria-label="Open order ${esc(order.orderNumber)}"><strong>${esc(order.orderNumber)}</strong>${workspaceIcon('chevron-right')}</button>${order.archived?'<small>Archived</small>':""}</td>${columns.map((key)=>`<td data-label="${esc(orderColumnLabels[key])}" class="order-${esc(key)}-cell">${orderCell(order,key)}</td>`).join("")}<td data-label="Actions" class="row-menu-cell">${orderDetailMenu(order)}</td></tr>`).join("")}</tbody></table>`
    : empty("No completed orders yet.");
}
function orderMobileCard(order) {
  return `<article class="order-card" ${orderRowData(order)}><header><label class="order-card-select"><input class="order-checkbox order-card-checkbox" type="checkbox" value="${order.id}" aria-label="Select order ${esc(order.orderNumber)}"><span class="sr-only">Select order</span></label><div><button class="order-number-link order-open-detail" data-order-id="${order.id}" type="button" title="Open order ${esc(order.orderNumber)}" aria-label="Open order ${esc(order.orderNumber)}"><strong>${esc(order.orderNumber)}</strong>${workspaceIcon('chevron-right')}</button><span>${orderDisplayDate(order.createdAt)}</span></div><strong class="order-card-total">${rupees(order.totalPaise)}</strong></header><section class="order-card-customer"><strong>${esc(order.customerName)}</strong><a href="tel:${esc(order.customerPhone)}">${esc(order.customerPhone)}</a><span>${esc(orderChannelLabel(order.channel))}</span></section><dl><div><dt>Payment</dt><dd><span class="status-badge is-${esc(order.paymentStatus)}">${esc(orderStatusLabel(order.paymentStatus))}</span></dd></div><div><dt>Fulfillment</dt><dd><span class="status-badge is-${esc(order.fulfillmentStatus)}">${esc(orderStatusLabel(order.fulfillmentStatus))}</span></dd></div><div><dt>Delivery</dt><dd>${esc(orderStatusLabel(order.deliveryStatus))}</dd></div><div><dt>Delivery method</dt><dd>${esc(orderStatusLabel(order.deliveryMethod || "standard"))}</dd></div><div><dt>Phone verification</dt><dd><span class="status-badge ${order.phoneVerificationStatus === "VERIFIED" ? "is-active" : "is-draft"}">${esc(orderStatusLabel(order.phoneVerificationStatus || "NOT_REQUIRED"))}</span></dd></div></dl><footer><span>${(order.tags || []).length ? (order.tags || []).map(esc).join(" · ") : "No tags"}</span>${orderDetailMenu(order)}</footer></article>`;
}
const reviewStatusTabs = [
  ["all", "All"],
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["disapproved", "Disapproved"],
];
function navigateReviewTab(tab) {
  reviewTab = tab;
  navigateTo(tab === "all" ? "/reviews" : `/reviews/${tab}`);
}
function reviewStatusTabsHtml(all) {
  const counts = {
    all: all.length,
    pending: all.filter((review) => review.status === "pending").length,
    approved: all.filter((review) => review.status === "approved").length,
    disapproved: all.filter((review) => review.status === "disapproved").length,
  };
  return `<div class="review-status-tabs" role="tablist" aria-label="Review status">${reviewStatusTabs.map(([status, label]) => {
    const active = reviewTab === status || reviewTab === `consumer-${status}`;
    return `<button type="button" role="tab" aria-selected="${active}" tabindex="${active ? "0" : "-1"}" data-review-status="${status}" class="${active ? "active" : ""}">${label} <strong>${counts[status]}</strong></button>`;
  }).join("")}</div>`;
}
function reviewSourceLabel(source) {
  return source === "consumer"
    ? "Consumer"
    : source === "bulk"
      ? "Bulk Import"
      : "Manual";
}
function reviewDisplayDate(review) {
  const value = review.reviewDate || review.createdAt;
  if (!value) return "—";
  const text = String(value),
    date = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? `${text}T00:00:00Z`
        : /(?:Z|[+-]\d\d:?\d\d)$/.test(text)
          ? text
          : `${text.replace(" ", "T")}Z`,
    );
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}
function reviewCustomerName(review) {
  return String(review.customerName || "").trim() || "Anonymous customer";
}
function reviewCustomerInitials(name) {
  const words = String(name || "").match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return "C";
  return `${words[0][0]}${words.length > 1 ? words.at(-1)[0] : ""}`
    .toLocaleUpperCase()
    .slice(0, 2);
}
function reviewTextIsReadable(value) {
  const text = String(value || "").trim(),
    lettersAndNumbers = text.match(/[\p{L}\p{N}]/gu) || [];
  return (
    lettersAndNumbers.length >= 2 || /\p{Extended_Pictographic}/u.test(text)
  );
}
function reviewCustomerIdentity(review, { includeProduct = false } = {}) {
  const name = reviewCustomerName(review),
    contact =
      review.authorEmail || review.customerEmail || review.customerPhone || "";
  return `<div class="review-customer-identity"><span class="review-customer-avatar" aria-hidden="true">${esc(reviewCustomerInitials(name))}</span><div class="review-customer-meta"><button class="link review-detail review-customer-name" data-id="${review.id}" type="button">${esc(name)}</button>${contact ? `<small>${esc(contact)}</small>` : ""}${includeProduct ? `<strong class="review-card-product">${esc(review.productName)}</strong>` : ""}</div></div>`;
}
function reviewPreviewData(review, maximumLength) {
  const rawTitle = String(review.title || "").replace(/\s+/gu, " ").trim(),
    rawCopy = String(review.text || "").replace(/\s+/gu, " ").trim(),
    title = reviewTextIsReadable(rawTitle) ? rawTitle : "",
    copy = reviewTextIsReadable(rawCopy) ? rawCopy : "",
    preview =
      copy.length > maximumLength
        ? `${copy.slice(0, maximumLength - 1)}…`
        : copy,
    hasMedia = Boolean((review.images || []).length),
    needsEditing = Boolean(
      (rawTitle && !title) || (rawCopy && !copy) || (!rawCopy && !hasMedia),
    );
  return {
    title,
    preview,
    emptyLabel: hasMedia
      ? "Photo review"
      : rawCopy
        ? "No readable review text"
        : "No written review",
    needsEditing,
  };
}
function reviewPreviewHtml(review, maximumLength) {
  const preview = reviewPreviewData(review, maximumLength);
  return `${preview.title ? `<strong class="review-copy-title">${esc(preview.title)}</strong>` : ""}<span class="review-copy-text ${preview.preview ? "" : "is-placeholder"}">${preview.preview ? esc(preview.preview) : esc(preview.emptyLabel)}</span>${reviewMediaPreview(review)}${preview.needsEditing ? '<small class="review-quality-note">Needs editing</small>' : ""}`;
}
function reviewDateHtml(review) {
  const value = review.reviewDate || review.createdAt || "";
  return `<time datetime="${esc(value)}">${reviewDisplayDate(review)}</time>${review.reviewDateInvalid ? '<small class="review-date-note">Date added</small>' : ""}`;
}
function reviewMediaPreview(review) {
  const images = review.images || [];
  if (!images.length) return "";
  const image = images[0],
    source = typeof image === "string" ? image : image?.dataUrl,
    remaining = images.length - 1;
  return `<span class="review-media-preview">${source ? `<img src="${esc(source)}" alt="Review image from ${esc(reviewCustomerName(review))}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="review-image-unavailable" hidden>Image unavailable</span>` : '<span class="review-image-unavailable">Image unavailable</span>'}${remaining ? `<b>+${remaining}</b>` : ""}</span>`;
}
function reviewRowActions(review) {
  const moderation =
      review.source === "manual"
        ? ""
        : `${review.status !== "approved" ? `<button type="button" class="review-action-status" data-id="${review.id}" data-status="approved">Approve</button>` : ""}${review.status !== "disapproved" ? `<button type="button" class="review-action-status" data-id="${review.id}" data-status="disapproved">Disapprove</button>` : ""}`,
    edit =
      review.source === "manual"
        ? `<button type="button" class="review-action-edit" data-id="${review.id}">Edit</button>`
        : "";
  return `<details class="row-menu review-row-menu"><summary aria-label="Actions for review by ${esc(reviewCustomerName(review))}">⋯</summary><div><button type="button" class="review-detail" data-id="${review.id}">View</button>${edit}${moderation}<button type="button" class="review-action-delete danger-text" data-id="${review.id}">Delete</button></div></details>`;
}
function reviewTableRow(review) {
  const moderatable = review.source !== "manual",
    preview = reviewPreviewData(review, 108);
  return `<tr data-review-row="${review.id}" class="${preview.needsEditing ? "review-needs-attention" : ""}"><td data-label="" class="review-select-cell"><input class="review-select" type="checkbox" value="${review.id}" aria-label="${moderatable ? `Select review by ${esc(reviewCustomerName(review))}` : `Manual review by ${esc(reviewCustomerName(review))} cannot be bulk moderated`}" ${moderatable ? "" : 'disabled title="Manual reviews are already approved and cannot be bulk moderated"'}></td><td data-label="Customer" class="review-customer-cell">${reviewCustomerIdentity(review)}</td><td data-label="Product" class="review-product-cell"><strong class="review-product-name">${esc(review.productName)}</strong></td><td data-label="Rating" class="review-rating-cell"><span class="review-rating" aria-label="${Number(review.rating)} out of 5 stars">${ratingStars(review.rating)}</span></td><td data-label="Review" class="review-copy-cell"><button class="link review-detail review-copy" data-id="${review.id}" type="button">${reviewPreviewHtml(review, 108)}</button></td><td data-label="Source" class="review-source-cell"><span class="source-badge">${reviewSourceLabel(review.source)}</span></td><td data-label="Date" class="review-date-cell">${reviewDateHtml(review)}</td><td data-label="Status" class="review-status-cell"><span class="status-badge is-${esc(review.status)}">${esc(orderStatusLabel(review.status))}</span></td><td data-label="Actions" class="row-menu-cell review-actions-cell">${reviewRowActions(review)}</td></tr>`;
}
function reviewMobileCard(review) {
  const moderatable = review.source !== "manual",
    preview = reviewPreviewData(review, 176);
  return `<article class="review-card ${preview.needsEditing ? "review-needs-attention" : ""}" data-review-card="${review.id}"><div class="review-card-select"><label><input class="review-select review-card-checkbox" type="checkbox" value="${review.id}" aria-label="${moderatable ? `Select review by ${esc(reviewCustomerName(review))}` : `Manual review by ${esc(reviewCustomerName(review))} cannot be bulk moderated`}" ${moderatable ? "" : 'disabled title="Manual reviews are already approved and cannot be bulk moderated"'}><span>${moderatable ? "Select" : "Manual review"}</span></label></div><header>${reviewCustomerIdentity(review, { includeProduct: true })}<span class="status-badge is-${esc(review.status)}">${esc(orderStatusLabel(review.status))}</span></header><span class="review-rating" aria-label="${Number(review.rating)} out of 5 stars">${ratingStars(review.rating)}</span><button class="link review-detail review-card-copy" data-id="${review.id}" type="button">${reviewPreviewHtml(review, 176)}</button><footer><span>${reviewSourceLabel(review.source)} <i aria-hidden="true">·</i> ${reviewDateHtml(review)}</span>${reviewRowActions(review)}</footer></article>`;
}
function showReviewMobileFilters() {
  modalContent.innerHTML = `<div class="review-filter-modal"><h2>Filter Reviews</h2><p class="muted">Narrow reviews by product, source, or rating.</p><label class="field">Product<select name="reviewProduct"><option value="all">All products</option>${data.products.map((product) => `<option value="${product.id}" ${reviewProduct === String(product.id) ? "selected" : ""}>${esc(product.name)}</option>`).join("")}</select></label><label class="field">Source<select name="reviewSource"><option value="all">All sources</option><option value="consumer" ${reviewSource === "consumer" ? "selected" : ""}>Consumer</option><option value="manual" ${reviewSource === "manual" ? "selected" : ""}>Manual</option><option value="bulk" ${reviewSource === "bulk" ? "selected" : ""}>Bulk Import</option></select></label><label class="field">Rating<select name="reviewRating"><option value="all">All ratings</option>${[5, 4, 3, 2, 1].map((rating) => `<option value="${rating}" ${reviewRating === String(rating) ? "selected" : ""}>${rating} Stars</option>`).join("")}</select></label><div class="modal-actions"><button class="secondary" id="reset-review-filters" type="button">Reset</button><button class="primary" type="submit">Apply Filters</button></div></div>`;
  const form = $("#modal-form");
  form.onsubmit = (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    reviewProduct = values.reviewProduct;
    reviewSource = values.reviewSource;
    reviewRating = values.reviewRating;
    modal.close();
    reviewsView();
  };
  $("#reset-review-filters").onclick = () => {
    reviewProduct = "all";
    reviewSource = "all";
    reviewRating = "all";
    modal.close();
    reviewsView();
  };
  modal.showModal();
}
const reviewFilePayload = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type,
        data: String(reader.result).split(",")[1],
      });
    reader.onerror = () => reject(Error("Could not read review image"));
    reader.readAsDataURL(file);
  });
function reviewsView() {
  if (reviewTab === "manual-add") return manualReviewForm();
  if (reviewTab === "bulk-upload") return bulkReviewUploadView();
  const all = data.reviews || [],
    status = reviewTab.startsWith("consumer-")
      ? reviewTab.split("-")[1]
      : reviewTab,
    query = reviewSearch.trim().toLowerCase(),
    reviews = all.filter(
      (review) =>
        (status === "all" || review.status === status) &&
        (reviewProduct === "all" ||
          String(review.productId) === reviewProduct) &&
        (reviewSource === "all" || review.source === reviewSource) &&
        (reviewRating === "all" || String(review.rating) === reviewRating) &&
        (!query ||
          [
            review.customerName,
            review.productName,
            review.title,
            review.text,
            reviewSourceLabel(review.source),
            review.status,
          ].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(query),
          )),
    ),
    hasActiveFilters = Boolean(
      query ||
        reviewProduct !== "all" ||
        reviewSource !== "all" ||
        reviewRating !== "all",
    ),
    emptyCopy = hasActiveFilters
      ? [
          "No reviews match these filters",
          "Try changing the search, product, source, or rating filter.",
        ]
      : status === "approved"
        ? [
            "No approved reviews yet",
            "Approved reviews will appear here after you approve consumer reviews.",
          ]
        : status === "pending"
          ? [
              "No pending reviews yet",
              "New consumer reviews waiting for moderation will appear here.",
            ]
          : status === "disapproved"
            ? [
                "No disapproved reviews yet",
                "Reviews you reject during moderation will appear here.",
              ]
            : [
                "No reviews yet",
                "Reviews will appear here after customers submit them or you import them.",
              ];
  setPageHeader(
    "Moderate consumer reviews and manage manual or imported reviews.",
    '<button class="secondary" id="manual-review-action">Add Review</button><button class="primary" id="bulk-review-action">Bulk Upload</button>',
  );
  const mobileFilterCount = [reviewProduct, reviewSource, reviewRating].filter(
    (value) => value !== "all",
  ).length;
  content.innerHTML = `<section class="reviews-shell">${reviewStatusTabsHtml(all)}<div class="review-filters review-desktop-filters"><input id="review-search" type="search" aria-label="Search reviews" placeholder="Search reviews..." value="${esc(reviewSearch)}"><select id="review-product-filter" aria-label="Filter reviews by product"><option value="all">Product: All</option>${data.products.map((product) => `<option value="${product.id}" ${reviewProduct === String(product.id) ? "selected" : ""}>${esc(product.name)}</option>`).join("")}</select><select id="review-source-filter" aria-label="Filter reviews by source"><option value="all">Source: All</option><option value="consumer" ${reviewSource === "consumer" ? "selected" : ""}>Consumer</option><option value="manual" ${reviewSource === "manual" ? "selected" : ""}>Manual</option><option value="bulk" ${reviewSource === "bulk" ? "selected" : ""}>Bulk Import</option></select><select id="review-rating-filter" aria-label="Filter reviews by rating"><option value="all">Rating: All</option>${[5, 4, 3, 2, 1].map((rating) => `<option value="${rating}" ${reviewRating === String(rating) ? "selected" : ""}>${rating} Stars</option>`).join("")}</select></div><div class="review-mobile-tools"><input id="review-mobile-search" type="search" aria-label="Search reviews" placeholder="Search reviews..." value="${esc(reviewSearch)}"><div><button class="secondary" id="review-filter-button" type="button">Filters${mobileFilterCount ? ` (${mobileFilterCount})` : ""}</button>${reviews.some((review) => review.source !== "manual") ? '<button class="secondary" id="review-select-mode" type="button" aria-pressed="false">Select</button>' : ""}</div></div><div class="review-selection-bar" hidden><span id="review-selection-count">0 reviews selected</span><button class="secondary" id="bulk-review-approve">Approve</button><button class="secondary" id="bulk-review-disapprove">Disapprove</button></div>${reviews.length ? `<div class="review-desktop-results table-scroll"><table class="merchant-table reviews-table"><thead><tr><th><input id="select-all-reviews" type="checkbox" aria-label="Select all reviews"></th><th>CUSTOMER</th><th>PRODUCT</th><th>RATING</th><th>REVIEW</th><th>SOURCE</th><th>DATE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${reviews.map(reviewTableRow).join("")}</tbody></table></div><div class="review-mobile-list">${reviews.map(reviewMobileCard).join("")}</div>` : `<div class="review-empty"><h3>${emptyCopy[0]}</h3><p>${emptyCopy[1]}</p></div>`}</section>`;
  $("#manual-review-action").onclick = () => {
    navigateReviewTab("manual-add");
  };
  $("#bulk-review-action").onclick = () => {
    navigateReviewTab("bulk-upload");
  };
  document.querySelectorAll("[data-review-status]").forEach(
    (button) =>
      (button.onclick = () => {
        navigateReviewTab(button.dataset.reviewStatus);
      }),
  );
  const bindReviewSearch = (selector) => {
    const input = $(selector);
    if (!input) return;
    input.oninput = (event) => {
      const cursor = event.target.selectionStart,
        value = event.target.value;
      reviewSearch = value;
      reviewsView();
      requestAnimationFrame(() => {
        const replacement = $(selector);
        if (!replacement) return;
        replacement.focus();
        replacement.setSelectionRange(cursor, cursor);
      });
    };
  };
  bindReviewSearch("#review-search");
  bindReviewSearch("#review-mobile-search");
  $("#review-product-filter").onchange = (event) => {
    reviewProduct = event.target.value;
    reviewsView();
  };
  $("#review-source-filter").onchange = (event) => {
    reviewSource = event.target.value;
    reviewsView();
  };
  $("#review-rating-filter").onchange = (event) => {
    reviewRating = event.target.value;
    reviewsView();
  };
  const filterButton = $("#review-filter-button");
  if (filterButton) filterButton.onclick = showReviewMobileFilters;
  const mobileList = $(".review-mobile-list"),
    selectMode = $("#review-select-mode");
  if (selectMode && mobileList)
    selectMode.onclick = () => {
      const selecting = mobileList.classList.toggle("is-selecting");
      selectMode.setAttribute("aria-pressed", String(selecting));
      selectMode.textContent = selecting ? "Done" : "Select";
      if (!selecting)
        mobileList
          .querySelectorAll(".review-card-checkbox")
          .forEach((box) => (box.checked = false));
      syncReviewSelection?.();
    };
  document
    .querySelectorAll(".review-detail")
    .forEach(
      (button) =>
        (button.onclick = () => showReviewDetail(Number(button.dataset.id))),
    );
  document.querySelectorAll(".review-action-edit").forEach(
    (button) =>
      (button.onclick = () => {
        reviewEditing = all.find(
          (review) => review.id === Number(button.dataset.id),
        );
        if (reviewEditing) navigateReviewTab("manual-add");
      }),
  );
  document.querySelectorAll(".review-action-status").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/reviews/${button.dataset.id}/status`,
            {
              method: "PATCH",
              body: JSON.stringify({ status: button.dataset.status }),
            },
          );
          toast(
            button.dataset.status === "approved"
              ? "Review approved"
              : "Review disapproved",
          );
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  document.querySelectorAll(".review-action-delete").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("Delete this review? This cannot be undone.")) return;
        try {
          await api(`/api/stores/${storeId}/reviews/${button.dataset.id}`, {
            method: "DELETE",
          });
          toast("Review deleted");
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  let syncReviewSelection;
  const selectAll = $("#select-all-reviews"),
    boxes = [...document.querySelectorAll(".review-select")],
    bar = $(".review-selection-bar"),
    count = $("#review-selection-count"),
    sync = () => {
      const selected = [...new Set(boxes.filter((box) => box.checked).map((box) => box.value))];
      if (bar) bar.hidden = !selected.length;
      if (count)
        count.textContent = `${selected.length} review${selected.length === 1 ? "" : "s"} selected`;
      if (selectAll) {
        const enabled = boxes.filter((box) => !box.disabled);
        selectAll.disabled = enabled.length === 0;
        selectAll.checked =
          enabled.length > 0 && enabled.every((box) => box.checked);
        selectAll.indeterminate = selected.length > 0 && !selectAll.checked;
      }
    };
  syncReviewSelection = sync;
  if (selectAll)
    selectAll.onchange = () => {
      boxes
        .filter((box) => !box.disabled)
        .forEach((box) => (box.checked = selectAll.checked));
      sync();
    };
  boxes.forEach((box) => (box.onchange = sync));
  sync();
  const bulk = async (status) => {
    const reviewIds = [
      ...new Set(
        boxes
          .filter((box) => box.checked)
          .map((box) => Number(box.value)),
      ),
    ];
    try {
      await api(`/api/stores/${storeId}/reviews/bulk-status`, {
        method: "PATCH",
        body: JSON.stringify({ reviewIds, status }),
      });
      toast(status === "approved" ? "Reviews approved" : "Reviews disapproved");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  $("#bulk-review-approve").onclick = () => bulk("approved");
  $("#bulk-review-disapprove").onclick = () => bulk("disapproved");
  sync();
}
function showReviewDetail(id) {
  const review = (data.reviews || []).find((item) => item.id === id);
  if (!review) return;
  const contact = review.authorEmail || review.customerEmail || review.customerPhone,
    moderation =
      review.source === "manual"
        ? ""
        : `${review.status !== "approved" ? '<button class="primary detail-status" type="button" data-status="approved">Approve</button>' : ""}${review.status !== "disapproved" ? '<button class="secondary detail-status" type="button" data-status="disapproved">Disapprove</button>' : ""}`,
    media = (review.images || [])
      .map(
        (image) =>
          `<a href="${esc(image.dataUrl)}" target="_blank" rel="noopener"><img src="${esc(image.dataUrl)}" alt="Review image from ${esc(review.customerName)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="review-image-unavailable" hidden>Image unavailable</span></a>`,
      )
      .join("");
  modalContent.innerHTML = `<h2>Review Detail</h2><p><strong>Product:</strong> ${esc(review.productName)}</p><p><strong>Customer Name:</strong> ${esc(review.customerName)}</p>${contact ? `<p><strong>Contact:</strong> ${esc(contact)}</p>` : ""}<p><strong>Rating:</strong> ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p><p><strong>Review Title:</strong> ${esc(review.title) || "—"}</p><p><strong>Review Text:</strong> ${esc(review.text) || "Media review"}</p><p><strong>Source:</strong> ${reviewSourceLabel(review.source)}</p><p><strong>Submitted Date:</strong> ${reviewDisplayDate(review)}</p><p><strong>Current Status:</strong> ${esc(review.status)}</p>${review.source === "bulk" ? `<p><strong>Featured Review:</strong> ${review.featured ? "ON" : "OFF"}</p><button class="secondary" id="toggle-featured-review" type="button">${review.featured ? "Unfeature Review" : "Feature Review"}</button>` : ""}${media ? `<div class="image-preview review-detail-images">${media}</div>` : ""}<div class="review-detail-actions">${review.source === "manual" ? '<button class="primary" id="edit-manual-review" type="button">Edit</button>' : moderation}<button class="secondary danger-text" id="delete-review" type="button">Delete</button></div>`;
  $("#modal-form").onsubmit = (event) => event.preventDefault();
  modal.showModal();
  document.querySelectorAll(".detail-status").forEach(
    (button) =>
      (button.onclick = () =>
        api(`/api/stores/${storeId}/reviews/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.status }),
        })
          .then(async () => {
            modal.close();
            await load();
          })
          .catch((error) => toast(error.message))),
  );
  if (review.source === "bulk")
    $("#toggle-featured-review").onclick = () =>
      api(`/api/stores/${storeId}/reviews/${id}/imported`, {
        method: "PATCH",
        body: JSON.stringify({ featured: !review.featured }),
      })
        .then(async () => {
          modal.close();
          await load();
        })
        .catch((error) => toast(error.message));
  if (review.source === "manual") {
    $("#edit-manual-review").onclick = () => {
      modal.close();
      reviewEditing = review;
      navigateReviewTab("manual-add");
    };
  }
  $("#delete-review").onclick = async () => {
    if (!confirm("Delete this review? This cannot be undone.")) return;
    try {
      await api(`/api/stores/${storeId}/reviews/${id}`, { method: "DELETE" });
      modal.close();
      reviewEditing = null;
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
}
function bulkReviewUploadView() {
  const imports = data.reviewImports || [],
    preview = reviewImportPreview,
    result = reviewImportResult,
    resultHtml = result
      ? `<section class="panel import-result"><h2>Import Complete</h2><p>${result.totalRows} rows processed</p><div class="metrics">${metric("Imported", result.imported, "Reviews created")}${metric("Skipped", result.skipped, "Rows with errors")}${metric("Failed", result.failed, "Unexpected failures")}</div><button class="primary" id="view-imported-reviews">View Imported Reviews</button> <a class="secondary button-link" href="/api/stores/${storeId}/review-imports/${result.id}/errors.csv">Download Error Report</a></section>`
      : "",
    previewHtml = preview
      ? `<section class="panel"><div class="panel-head"><div><h2>Preview</h2><span>${preview.totalRows} Reviews Found</span></div></div><div class="metrics">${metric("Valid", preview.validRows, "Ready")}${metric("Warnings", preview.warningRows, "Importable with warnings")}${metric("Errors", preview.errorRows, "Blocking errors")}</div><table><thead><tr><th>ROW</th><th>PRODUCT</th><th>AUTHOR</th><th>RATING</th><th>REVIEW</th><th>IMAGES</th><th>STATUS</th></tr></thead><tbody>${preview.rows.map((item) => `<tr><td>${item.rowNumber}</td><td>${esc(item.product)}</td><td>${esc(item.author)}</td><td>${item.rating ? "★".repeat(item.rating) + "☆".repeat(5 - item.rating) : "—"}</td><td>${esc(item.review || "Media review")}</td><td>${item.images}</td><td><span class="pill">${item.status === "ready" ? "Ready" : item.status === "warning" ? "Warning" : esc(item.errors[0] || "Error")}</span>${item.warnings.length ? `<small>${esc(item.warnings.join("; "))}</small>` : ""}</td></tr>`).join("")}</tbody></table><fieldset><legend>Review Status After Import</legend><label class="field checkbox"><input type="radio" name="review-import-mode" value="use_csv" checked> <span>Use CSV &quot;publish&quot; value</span></label><label class="field checkbox"><input type="radio" name="review-import-mode" value="all_pending"> <span>Import All as Pending</span></label><label class="field checkbox"><input type="radio" name="review-import-mode" value="all_approved"> <span>Import All as Approved</span></label></fieldset><label class="field checkbox"><input id="review-import-authenticity" type="checkbox"> <span>I confirm these are genuine reviews I have permission or the right to republish.</span></label><button class="secondary" id="cancel-review-import">Cancel</button> <button class="primary" id="import-valid-reviews" ${preview.validRows + preview.warningRows ? "" : "disabled"}>Import Valid Reviews</button> <button class="primary" id="import-all-reviews" ${preview.errorRows ? "disabled" : ""}>Import All</button></section>`
      : "",
    importRows = imports
      .map(
        (item) =>
          `<tr><td>${esc(item.fileName)}</td><td>${esc(item.createdAt)}</td><td>${item.totalRows}</td><td>${item.importedCount}</td><td>${item.failedCount}</td><td>${esc(item.importedBy)}</td><td><button class="secondary import-detail" data-id="${item.id}">Open</button></td></tr>`,
      )
      .join(""),
    importCards = imports
      .map(
        (item) =>
          `<article class="data-mobile-card review-import-mobile-card"><header><div><small>File</small><strong>${esc(item.fileName)}</strong><span>${esc(item.createdAt)}</span></div><button class="secondary import-detail" data-id="${item.id}" type="button">Open</button></header><dl><div><dt>Total rows</dt><dd>${item.totalRows}</dd></div><div><dt>Imported</dt><dd><strong>${item.importedCount}</strong></dd></div><div><dt>Failed</dt><dd class="${item.failedCount ? "danger" : ""}">${item.failedCount}</dd></div><div><dt>Imported by</dt><dd>${esc(item.importedBy)}</dd></div></dl></article>`,
      )
      .join("");
  $("#page-title").textContent = "Bulk Import Reviews";
  setPageHeader(
    "Upload a CSV, validate every row, then import genuine reviews.",
    `<button class="secondary" id="back-to-reviews">← Reviews</button><a class="secondary button-link" href="/api/stores/${storeId}/review-imports/template">Download Template</a>`,
  );
  content.innerHTML = `<section class="panel import-upload-card"><div id="review-csv-drop" class="file-drop"><strong>Drop CSV here</strong><span>or choose a file from your computer</span><label class="primary">Choose CSV File<input id="review-csv-file" type="file" accept=".csv,text/csv" hidden></label><small id="review-csv-name">${esc(reviewImportFile?.name || "CSV only")}</small></div><div class="center-actions"><button class="primary" id="validate-review-csv" ${reviewImportFile ? "" : "disabled"}>Validate CSV</button></div></section>${resultHtml}${previewHtml}<section class="panel"><div class="panel-head"><div><h2>Import History</h2><span>Open an import to view every created review.</span></div></div>${imports.length ? `<div class="table-scroll data-desktop-list"><table class="merchant-table"><thead><tr><th>FILE NAME</th><th>UPLOAD DATE</th><th>TOTAL ROWS</th><th>IMPORTED</th><th>FAILED</th><th>IMPORTED BY</th><th>ACTION</th></tr></thead><tbody>${importRows}</tbody></table></div><div class="data-mobile-list" aria-label="Review import history">${importCards}</div>` : empty("No review imports yet.")}</section>`;
  $("#back-to-reviews").onclick = () => navigateReviewTab("all");
  const input = $("#review-csv-file"),
    drop = $("#review-csv-drop"),
    setFile = (file) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".csv"))
        return toast("Choose a CSV file");
      reviewImportFile = file;
      reviewImportPreview = null;
      reviewImportResult = null;
      bulkReviewUploadView();
    };
  input.onchange = () => setFile(input.files[0]);
  drop.ondragover = (event) => {
    event.preventDefault();
    drop.classList.add("dragging");
  };
  drop.ondragleave = () => drop.classList.remove("dragging");
  drop.ondrop = (event) => {
    event.preventDefault();
    drop.classList.remove("dragging");
    setFile(event.dataTransfer.files[0]);
  };
  $("#validate-review-csv").onclick = async () => {
    try {
      const csv = await reviewImportFile.text();
      reviewImportPreview = await api(
        `/api/stores/${storeId}/review-imports/validate`,
        {
          method: "POST",
          body: JSON.stringify({ fileName: reviewImportFile.name, csv }),
        },
      );
      reviewImportResult = null;
      bulkReviewUploadView();
    } catch (error) {
      toast(error.message);
    }
  };
  if (preview) {
    $("#cancel-review-import").onclick = () => {
      reviewImportPreview = null;
      reviewImportFile = null;
      bulkReviewUploadView();
    };
    const runImport = async (importValidOnly) => {
      if (!$("#review-import-authenticity").checked)
        return toast("Confirm that the imported reviews are genuine");
      const mode = document.querySelector(
        '[name="review-import-mode"]:checked',
      ).value;
      try {
        reviewImportResult = await api(
          `/api/stores/${storeId}/review-imports/${preview.id}/import`,
          {
            method: "POST",
            body: JSON.stringify({
              mode,
              importValidOnly,
              authenticityConfirmed: true,
            }),
          },
        );
        reviewImportPreview = null;
        reviewImportFile = null;
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
    $("#import-valid-reviews").onclick = () => runImport(true);
    $("#import-all-reviews").onclick = () => runImport(false);
  }
  if (result)
    $("#view-imported-reviews").onclick = () => {
      reviewImportResult = null;
      navigateReviewTab("all");
    };
  document
    .querySelectorAll(".import-detail")
    .forEach(
      (button) =>
        (button.onclick = () =>
          showReviewImportDetail(Number(button.dataset.id))),
    );
}
async function showReviewImportDetail(id) {
  try {
    const item = await api(`/api/stores/${storeId}/review-imports/${id}`);
    const createdReviewRows = item.createdReviews
        .map(
          (review) =>
            `<tr><td>${esc(review.productName)}</td><td>${esc(review.customerName)}</td><td>${"★".repeat(review.rating)}</td><td>${esc(review.status)}</td></tr>`,
        )
        .join(""),
      createdReviewCards = item.createdReviews
        .map(
          (review) =>
            `<article class="data-mobile-card review-import-detail-mobile-card"><header><div><small>Customer</small><strong>${esc(review.customerName)}</strong><span>${esc(review.productName)}</span></div><span class="pill">${esc(review.status)}</span></header><div class="mobile-card-rating" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(Math.max(0, 5 - review.rating))}</div></article>`,
        )
        .join("");
    modalContent.innerHTML = `<h2>Import History Detail</h2><p><strong>File Name:</strong> ${esc(item.fileName)}</p><p><strong>Upload Date:</strong> ${esc(item.createdAt)}</p><p><strong>Total Rows:</strong> ${item.totalRows}</p><p><strong>Imported:</strong> ${item.importedCount}</p><p><strong>Failed:</strong> ${item.failedCount}</p><p><strong>Imported By:</strong> ${esc(item.importedBy)}</p><a class="secondary button-link" href="/api/stores/${storeId}/review-imports/${id}/errors.csv">Download Error Report</a><h3>Reviews created by this upload</h3>${item.createdReviews.length ? `<div class="table-scroll data-desktop-list"><table><thead><tr><th>PRODUCT</th><th>CUSTOMER</th><th>RATING</th><th>STATUS</th></tr></thead><tbody>${createdReviewRows}</tbody></table></div><div class="data-mobile-list" aria-label="Reviews created by this upload">${createdReviewCards}</div>` : empty("No reviews were created.")}`;
    $("#modal-form").onsubmit = (event) => event.preventDefault();
    modal.showModal();
  } catch (error) {
    toast(error.message);
  }
}
function manualReviewForm() {
  const review = reviewEditing,
    existing = [...(review?.images || [])],
    today = new Date().toISOString().slice(0, 10);
  $("#page-title").textContent = review ? "Edit Review" : "Add Review";
  setPageHeader(
    "Use only authentic customer feedback from a legitimate source.",
    `<button class="secondary" id="back-to-review-list">Cancel</button><button class="primary" type="submit" form="manual-review-form">${review ? "Save Changes" : "Save Review"}</button>`,
  );
  content.innerHTML = `<form id="manual-review-form" class="compact-form"><section class="panel form-section"><label class="field">Product<select name="productId" required>${data.products.map((product) => `<option value="${product.id}" ${review?.productId === product.id ? "selected" : ""}>${esc(product.name)}</option>`).join("")}</select></label><label class="field">Customer Name<input name="customerName" value="${esc(review?.customerName || "")}" minlength="2" maxlength="120" required><small>Use the customer's real name.</small></label><label class="field">Rating<select name="rating" required>${[5, 4, 3, 2, 1].map((rating) => `<option value="${rating}" ${review?.rating === rating ? "selected" : ""}>${"★".repeat(rating)} · ${rating} Stars</option>`).join("")}</select></label><label class="field">Review Title<input name="title" value="${esc(review?.title || "")}" maxlength="160"><small>Optional. Use a short, readable summary.</small></label><label class="field">Review Text<textarea name="text" minlength="2" maxlength="5000" required>${esc(review?.text || "")}</textarea><small>Punctuation-only feedback cannot be saved.</small></label><label class="field">Review Date<input name="reviewDate" type="date" max="${today}" value="${esc(review?.reviewDate || "")}"></label><label class="field">Status<select name="status"><option value="approved" ${review?.status === "approved" ? "selected" : ""}>Approved</option><option value="draft" ${!review || review.status === "draft" ? "selected" : ""}>Draft</option></select></label><label class="field">Upload Images<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div><strong>Preview</strong><div id="manual-image-preview" class="image-preview"></div></div><label class="toggle-row"><span><strong>Authenticity confirmation</strong><small>I confirm this is authentic customer feedback and not an invented customer experience.</small></span><input name="authenticityConfirmed" type="checkbox" required></label></section></form>`;
  $("#back-to-review-list").onclick = () => {
    reviewEditing = null;
    navigateReviewTab("all");
  };
  const form = $("#manual-review-form"),
    preview = $("#manual-image-preview"),
    fileInput = form.elements.images;
  let retained = [...existing];
  const draw = (files) => {
    preview.innerHTML = "";
    retained.forEach((image) => {
      const card = document.createElement("span");
      card.innerHTML = `<img src="${image.dataUrl}" alt="Review image"><button type="button">Remove</button>`;
      card.querySelector("button").onclick = () => {
        retained = retained.filter((item) => item.id !== image.id);
        draw(files);
      };
      preview.appendChild(card);
    });
    for (const file of files) {
      const image = document.createElement("img");
      image.src = URL.createObjectURL(file);
      image.alt = "Replacement review image";
      preview.appendChild(image);
    }
  };
  draw([]);
  fileInput.onchange = () => draw([...fileInput.files]);
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const files = [...fileInput.files];
      if (retained.length + files.length > 5)
        throw Error("A review can have at most 5 images");
      const values = Object.fromEntries(new FormData(form));
      if (!String(values.customerName || "").match(/\p{L}/u))
        throw Error("Customer Name must contain at least one letter");
      if (values.title && !reviewTextIsReadable(values.title))
        throw Error("Review Title must contain readable text or an emoji");
      if (!reviewTextIsReadable(values.text))
        throw Error("Review Text must contain readable feedback or an emoji");
      const newImages = await Promise.all(files.map(reviewFilePayload)),
        images = [
          ...retained.map((image) => ({
            name: image.name,
            type: image.type,
            data: image.dataUrl.split(",")[1],
          })),
          ...newImages,
        ],
        payload = {
          ...values,
          productId: Number(values.productId),
          rating: Number(values.rating),
          authenticityConfirmed: form.elements.authenticityConfirmed.checked,
          images,
        },
        path = review
          ? `/api/stores/${storeId}/reviews/${review.id}`
          : `/api/stores/${storeId}/reviews`;
      await api(path, {
        method: review ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      toast("Manual review saved");
      reviewEditing = null;
      reviewTab = "all";
      history.replaceState({}, "", "/reviews");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
}

function orderEventLabel(event) {
  const labels = {
    order_placed: "Order placed",
    payment_status: "Payment updated",
    shipment_status: "Shipment updated",
    order_cancelled: "Order cancelled",
    order_created: "Order created",
    inventory_updated: "Inventory updated",
    fulfillment_status: "Fulfillment updated",
    delivery_status: "Delivery updated",
    archive_status: "Archive updated",
    upsell_shown: "Post-purchase offer shown",
    upsell_accepted: "Upsell accepted",
    upsell_rejected: "Upsell declined",
    order_total_updated: "Order total updated",
  };
  return labels[event.eventType] || orderStatusLabel(event.eventType);
}
function orderDetailView(orderId) {
  setPageHeader("Loading complete order information…");
  content.innerHTML = '<section class="panel order-detail-loading">Loading order…</section>';
  api(`/api/stores/${storeId}/orders/${orderId}`)
    .then((order) => {
      const route = routeFromPath();
      if (route.screen !== "order-detail" || route.orderId !== orderId) return;
      renderOrderDetail(order);
    })
    .catch((error) => {
      content.innerHTML = `<section class="panel empty"><h2>Order unavailable</h2><p>${esc(error.message)}</p><button class="secondary" id="back-to-orders" type="button">Back to orders</button></section>`;
      $("#back-to-orders").onclick = () => navigateTo("/orders");
    });
}
function renderOrderDetail(order) {
  const shipment = order.shipment,
    activePartners = (data.delivery?.partners || []).filter(
      (partner) => partner.active,
    ),
    canCancel =
      order.fulfillmentStatus === "unfulfilled" &&
      !shipment &&
      order.paymentStatus !== "paid",
    paymentActions =
      order.paymentStatus === "pending"
        ? '<button class="primary" id="mark-order-paid" type="button">Mark paid</button>'
        : order.paymentStatus === "paid"
          ? '<button class="secondary" id="mark-order-unpaid" type="button">Mark unpaid</button><button class="secondary" id="mark-order-refunded" type="button">Mark refunded</button>'
          : "",
    dispatchAction =
      !shipment && order.fulfillmentStatus === "unfulfilled"
        ? `<button class="secondary" id="dispatch-detail-order" type="button" ${activePartners.length ? "" : "disabled"}>Dispatch order</button>`
        : "",
    cancelAction = canCancel
      ? '<button class="danger" id="cancel-detail-order" type="button">Cancel order</button>'
      : "";
  $("#page-title").textContent = `Order ${order.orderNumber}`;
  setPageHeader(
    `${orderDisplayDate(order.createdAt)} · ${order.customerName}`,
    '<button class="secondary" id="back-to-orders" type="button">← All orders</button>',
  );
  content.innerHTML = `<div class="order-detail-shell"><section class="panel order-detail-summary"><div class="order-detail-heading"><div><span class="eyebrow">${esc(orderChannelLabel(order.channel))}</span><h2>${esc(order.orderNumber)}</h2><p>Placed ${orderDisplayDate(order.createdAt)}</p></div><strong>${rupees(order.totalPaise)}</strong></div><div class="order-detail-statuses"><span><small>Payment</small><b class="status-badge is-${esc(order.paymentStatus)}">${esc(orderStatusLabel(order.paymentStatus))}</b></span><span><small>Fulfillment</small><b class="status-badge is-${esc(order.fulfillmentStatus)}">${esc(orderStatusLabel(order.fulfillmentStatus))}</b></span><span><small>Delivery</small><b>${esc(orderStatusLabel(order.deliveryStatus))}</b></span><span><small>Phone verification</small><b>${esc(orderStatusLabel(order.phoneVerificationStatus || "NOT_REQUIRED"))}</b></span></div><div class="order-detail-actions">${paymentActions}${dispatchAction}${cancelAction}</div>${!activePartners.length && !shipment && order.fulfillmentStatus === "unfulfilled" ? '<p class="notice">Connect and enable a delivery partner in Settings → Shipping before dispatch.</p>' : ""}</section><div class="order-detail-grid"><main><section class="panel"><div class="panel-head"><div><h2>Items</h2><span>${order.items.reduce((sum, item) => sum + Number(item.quantity), 0)} item(s)</span></div></div><div class="order-line-items">${order.items.map((item) => `<article><div><strong>${esc(item.name)}</strong><span>${item.quantity} × ${rupees(item.unitPricePaise)}</span></div><strong>${rupees(item.lineTotalPaise)}</strong></article>`).join("")}</div><dl class="order-totals"><div><dt>Subtotal</dt><dd>${rupees(order.subtotalPaise || order.items.reduce((sum, item) => sum + Number(item.lineTotalPaise), 0))}</dd></div><div><dt>Discount${order.couponCode ? ` · ${esc(order.couponCode)}` : ""}</dt><dd>− ${rupees(order.discountPaise || 0)}</dd></div><div><dt>Shipping${order.shippingMethod ? ` · ${esc(order.shippingMethod)}` : ""}</dt><dd>${rupees(order.shippingPaise || 0)}</dd></div><div class="order-total-row"><dt>Total</dt><dd>${rupees(order.totalPaise)}</dd></div></dl></section><section class="panel"><div class="panel-head"><div><h2>Timeline</h2><span>Auditable order changes</span></div></div><ol class="order-timeline">${order.events.length ? order.events.map((event) => `<li><i></i><div><strong>${esc(orderEventLabel(event))}</strong><span>${event.oldStatus && event.newStatus ? `${esc(orderStatusLabel(event.oldStatus))} → ${esc(orderStatusLabel(event.newStatus))}` : esc(orderStatusLabel(event.newStatus))}</span>${event.note ? `<p>${esc(event.note)}</p>` : ""}<time>${orderDisplayDate(event.createdAt)}</time></div></li>`).join("") : `<li><i></i><div><strong>Order placed</strong><time>${orderDisplayDate(order.createdAt)}</time></div></li>`}</ol></section></main><aside><section class="panel"><h2>Customer</h2><dl class="order-facts"><div><dt>Name</dt><dd>${esc(order.customerName)}</dd></div><div><dt>Phone</dt><dd><a href="tel:${esc(order.customerPhone)}">${esc(order.customerPhone)}</a></dd></div>${order.customerAlternatePhone ? `<div><dt>Alternate phone</dt><dd>${esc(order.customerAlternatePhone)}</dd></div>` : ""}${order.customerEmail ? `<div><dt>Email</dt><dd>${esc(order.customerEmail)}</dd></div>` : ""}</dl></section><section class="panel"><h2>Delivery address</h2><address>${esc(order.customerAddress)}${order.customerAddressLine2 ? `<br>${esc(order.customerAddressLine2)}` : ""}${order.customerLandmark ? `<br>Near ${esc(order.customerLandmark)}` : ""}<br>${esc(order.customerCity)}, ${esc(order.customerState)} ${esc(order.customerPincode)}<br>${esc(order.customerCountry || "India")}</address></section><section class="panel"><h2>Shipment</h2>${shipment ? `<dl class="order-facts"><div><dt>Partner</dt><dd>${esc(shipment.partnerName)}</dd></div><div><dt>AWB / tracking</dt><dd>${esc(shipment.trackingNumber)}</dd></div><div><dt>Status</dt><dd>${esc(orderStatusLabel(shipment.status))}</dd></div></dl>${shipment.trackingUrl ? `<a class="secondary button-link" href="${esc(shipment.trackingUrl)}" target="_blank" rel="noopener">Track shipment</a>` : ""}` : '<p class="muted">Not dispatched yet.</p>'}</section><section class="panel"><h2>Risk and metadata</h2><dl class="order-facts"><div><dt>Bot risk</dt><dd>${esc(orderStatusLabel(order.botRiskLevel || "low"))} · ${Number(order.botRiskScore || 0)}/100</dd></div><div><dt>Payment method</dt><dd>${esc(orderStatusLabel(order.paymentMethod || "cod"))}</dd></div><div><dt>Tags</dt><dd>${(order.tags || []).length ? order.tags.map(esc).join(" · ") : "None"}</dd></div></dl></section></aside></div></div>`;
  const nestedOrderMain = content.querySelector(".order-detail-grid > main");
  if (order.customFields?.length) content.querySelector('.order-detail-grid > aside')?.insertAdjacentHTML('beforeend', `<section class="panel"><h2>Additional details</h2><dl class="order-facts">${order.customFields.map(field=>`<div><dt>${esc(field.label)}</dt><dd>${esc(typeof field.value==='boolean'?(field.value?'Yes':'No'):field.value)}</dd></div>`).join('')}</dl></section>`);
  if (nestedOrderMain) {
    const orderPrimary = document.createElement("div");
    orderPrimary.className = "order-detail-primary";
    orderPrimary.append(...nestedOrderMain.childNodes);
    nestedOrderMain.replaceWith(orderPrimary);
  }
  $("#back-to-orders").onclick = () => navigateTo("/orders");
  const updatePayment = async (status, message) => {
    try {
      const updated = await api(
        `/api/stores/${storeId}/orders/${order.id}/payment-status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      toast(message);
      data.orders = data.orders.map((item) =>
        item.id === updated.id ? { ...item, ...updated } : item,
      );
      renderOrderDetail(updated);
    } catch (error) {
      toast(error.message);
    }
  };
  if ($("#mark-order-paid"))
    $("#mark-order-paid").onclick = () => updatePayment("paid", "Order marked paid");
  if ($("#mark-order-unpaid"))
    $("#mark-order-unpaid").onclick = () =>
      updatePayment("pending", "Order marked unpaid");
  if ($("#mark-order-refunded"))
    $("#mark-order-refunded").onclick = () => {
      if (confirm("Confirm that the refund was completed outside Commera2?"))
        updatePayment("refunded", "Order marked refunded");
    };
  if ($("#cancel-detail-order"))
    $("#cancel-detail-order").onclick = () =>
      openForm(
        `Cancel ${order.orderNumber}`,
        '<p class="notice">Inventory will be restored exactly once. This action cannot be reversed.</p><label class="field">Reason (optional)<textarea name="reason" maxlength="240" rows="3"></textarea></label>',
        "Cancel order",
        (values) =>
          api(`/api/stores/${storeId}/orders/${order.id}/cancel`, {
            method: "POST",
            body: JSON.stringify(values),
          }),
      );
  if ($("#dispatch-detail-order"))
    $("#dispatch-detail-order").onclick = () =>
      openForm(
        `Dispatch ${order.orderNumber}`,
        `<label class="field">Delivery partner<select name="partnerId">${activePartners.map((partner) => `<option value="${partner.id}">${esc(partner.name)}</option>`).join("")}</select></label><label class="field">Tracking/AWB number (optional for connected adapters)<input name="trackingNumber"></label>`,
        "Dispatch order",
        (values) =>
          api(`/api/stores/${storeId}/orders/${order.id}/shipments`, {
            method: "POST",
            body: JSON.stringify({
              partnerId: Number(values.partnerId),
              trackingNumber: values.trackingNumber,
            }),
          }),
      );
}
function showOrderMobileFilters() {
  const options = (key, selected) =>
    [...new Set(data.orders.map((order) => order[key]).filter(Boolean))]
      .map(
        (value) =>
          `<option value="${esc(value)}" ${selected === value ? "selected" : ""}>${esc(orderStatusLabel(value))}</option>`,
      )
      .join("");
  modalContent.innerHTML = `<div class="order-filter-modal"><h2>Filter Orders</h2><p class="muted">Narrow orders by fulfillment, payment, or delivery status.</p><label class="field">Fulfillment<select name="orderStatus"><option value="all">All statuses</option>${options("fulfillmentStatus", orderStatus)}</select></label><label class="field">Payment<select name="orderPayment"><option value="all">All payment states</option>${options("paymentStatus", orderPayment)}</select></label><label class="field">Delivery<select name="orderDelivery"><option value="all">All delivery states</option>${options("deliveryStatus", orderDelivery)}</select></label><div class="modal-actions"><button class="secondary" id="reset-order-filters" type="button">Reset</button><button class="primary" type="submit">Apply Filters</button></div></div>`;
  const form = $("#modal-form");
  form.onsubmit = (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    orderStatus = values.orderStatus;
    orderPayment = values.orderPayment;
    orderDelivery = values.orderDelivery;
    modal.close();
    refreshOrdersWorkspace();
  };
  $("#reset-order-filters").onclick = () => {
    orderStatus = "all";
    orderPayment = "all";
    orderDelivery = "all";
    modal.close();
    refreshOrdersWorkspace();
  };
  modal.showModal();
}
function legacyOrdersView() {
  setPageHeader(
    `${data.orders.length} order${data.orders.length === 1 ? "" : "s"} · newest first`,
  );
  const options = (key) =>
    [...new Set(data.orders.map((order) => order[key]).filter(Boolean))]
      .map(
        (value) =>
          `<option value="${esc(value)}">${esc(orderStatusLabel(value))}</option>`,
      )
      .join("");
  const activeFilterCount = [orderStatus, orderPayment, orderDelivery].filter(
    (value) => value !== "all",
  ).length;
  content.innerHTML = `<section class="panel list-panel orders-shell"><div class="table-toolbar order-filters order-desktop-filters"><label class="search-field"><span aria-hidden="true">⌕</span><input id="order-search" type="search" aria-label="Search orders" placeholder="Search orders..." value="${esc(orderSearch)}"></label><select id="order-status-filter" aria-label="Filter orders by fulfillment status"><option value="all">Status: All</option>${options("fulfillmentStatus")}</select><select id="order-payment-filter" aria-label="Filter orders by payment status"><option value="all">Payment: All</option>${options("paymentStatus")}</select><select id="order-delivery-filter" aria-label="Filter orders by delivery status"><option value="all">Delivery: All</option>${options("deliveryStatus")}</select></div><div class="order-mobile-tools"><label class="search-field"><span aria-hidden="true">⌕</span><input id="order-mobile-search" type="search" aria-label="Search orders" placeholder="Search orders..." value="${esc(orderSearch)}"></label><button class="secondary" id="order-filter-button" type="button">Filters${activeFilterCount ? ` (${activeFilterCount})` : ""}</button></div><div class="order-toolbar" hidden><strong id="selected-orders-count">0 selected</strong><input id="bulk-order-tags" placeholder="Add tags: VIP, Priority" aria-label="Tags to add to selected orders"><button class="secondary" id="apply-order-tags" disabled>Add Tags</button></div>${data.orders.length ? `<div class="order-desktop-results table-scroll">${ordersTable(data.orders, { selectable: true })}</div><div class="order-mobile-list">${data.orders.map(orderMobileCard).join("")}</div><div class="order-filter-empty" hidden><h3>No matching orders</h3><p>Try changing the search or filters.</p></div>` : empty("No completed orders yet.")}</section>`;
  const checkboxes = [...document.querySelectorAll(".order-checkbox")],
    selectAll = $("#select-all-orders"),
    apply = $("#apply-order-tags"),
    tagInput = $("#bulk-order-tags"),
    count = $("#selected-orders-count");
  const sync = () => {
    const selected = [
      ...new Set(
        checkboxes.filter((box) => box.checked).map((box) => box.value),
      ),
    ];
    count.textContent = `${selected.length} selected`;
    apply.disabled = !selected.length || !tagInput.value.trim();
    $(".order-toolbar").hidden = !selected.length;
    if (selectAll) {
      const visibleTableBoxes = checkboxes.filter(
          (box) =>
            box.closest(".order-desktop-results") &&
            !box.closest("[data-order-row]").hidden,
        ),
        selectedVisible = visibleTableBoxes.filter((box) => box.checked);
      selectAll.checked =
        visibleTableBoxes.length > 0 &&
        selectedVisible.length === visibleTableBoxes.length;
      selectAll.indeterminate =
        selectedVisible.length > 0 &&
        selectedVisible.length < visibleTableBoxes.length;
    }
  };
  if (selectAll)
    selectAll.onchange = () => {
      const visibleIds = new Set(
        checkboxes
          .filter(
            (box) =>
              box.closest(".order-desktop-results") &&
              !box.closest("[data-order-row]").hidden,
          )
          .map((box) => box.value),
      );
      checkboxes
        .filter((box) => visibleIds.has(box.value))
        .forEach((box) => (box.checked = selectAll.checked));
      sync();
    };
  checkboxes.forEach(
    (box) =>
      (box.onchange = () => {
        checkboxes
          .filter((match) => match !== box && match.value === box.value)
          .forEach((match) => (match.checked = box.checked));
        sync();
      }),
  );
  tagInput.oninput = sync;
  const filterRows = () => {
    const desktopSearch = $("#order-search"),
      mobileSearch = $("#order-mobile-search"),
      activeSearch = document.activeElement === mobileSearch ? mobileSearch : desktopSearch;
    orderSearch = (activeSearch?.value || orderSearch).trim().toLowerCase();
    if (desktopSearch) desktopSearch.value = orderSearch;
    if (mobileSearch) mobileSearch.value = orderSearch;
    orderStatus = $("#order-status-filter").value;
    orderPayment = $("#order-payment-filter").value;
    orderDelivery = $("#order-delivery-filter").value;
    let visible = 0;
    document.querySelectorAll("[data-order-row]").forEach((row) => {
      row.hidden = Boolean(
        (orderSearch && !row.dataset.search.includes(orderSearch)) ||
        (orderStatus !== "all" && row.dataset.status !== orderStatus) ||
        (orderPayment !== "all" && row.dataset.payment !== orderPayment) ||
        (orderDelivery !== "all" && row.dataset.delivery !== orderDelivery),
      );
      if (!row.hidden && row.classList.contains("order-card")) visible += 1;
    });
    const noMatches = $(".order-filter-empty");
    if (noMatches) noMatches.hidden = visible > 0;
    document
      .querySelectorAll(".order-desktop-results, .order-mobile-list")
      .forEach((container) => container.classList.toggle("has-no-results", visible === 0));
    sync();
  };
  $("#order-status-filter").value = orderStatus;
  $("#order-payment-filter").value = orderPayment;
  $("#order-delivery-filter").value = orderDelivery;
  [
    $("#order-search"),
    $("#order-mobile-search"),
    $("#order-status-filter"),
    $("#order-payment-filter"),
    $("#order-delivery-filter"),
  ].forEach((control) => (control.oninput = filterRows));
  $("#order-filter-button").onclick = showOrderMobileFilters;
  filterRows();
  wireOrderDetailLinks(content);
  apply.onclick = async () => {
    const orderIds = [
        ...new Set(
          checkboxes
            .filter((box) => box.checked)
            .map((box) => Number(box.value)),
        ),
      ],
      tags = tagInput
        .value.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    try {
      await api(`/api/stores/${storeId}/orders/tags`, {
        method: "PATCH",
        body: JSON.stringify({ orderIds, tags }),
      });
      toast("Order tags updated");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
}
function orderRangeLabel(range){return({today:"Today",yesterday:"Yesterday",last7:"Last 7 days",last30:"Last 30 days",custom:"Custom range"})[range]||"Today";}
function fulfillmentDuration(seconds){if(seconds==null)return "—";const hours=seconds/3600;return hours<1?`${Math.round(seconds/60)} min`:hours<24?`${hours.toFixed(1)} hr`:`${(hours/24).toFixed(1)} days`;}
async function refreshOrdersWorkspace(){const params=new URLSearchParams({range:orderRange,start:orderRangeStart,end:orderRangeEnd,search:orderSearch,paymentStatus:orderPayment,fulfillmentStatus:orderStatus,deliveryStatus:orderDelivery});data.ordersWorkspace=await api(`/api/stores/${storeId}/orders/workspace?${params}`);data.orders=data.ordersWorkspace.orders;ordersView();}
function openOrderCustomRange(){const today=new Date().toISOString().slice(0,10);modalContent.innerHTML=`<h2>Custom date range</h2><div class="form-columns"><label class="field">Start date<input name="start" type="date" max="${today}" value="${esc(orderRangeStart||today)}" required></label><label class="field">End date<input name="end" type="date" max="${today}" value="${esc(orderRangeEnd||today)}" required></label></div><button class="primary" type="submit">Apply range</button>`;const form=$("#modal-form");form.onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(form));if(values.start>values.end)return toast("Start date must be before end date");orderRange="custom";orderRangeStart=values.start;orderRangeEnd=values.end;modal.close();await refreshOrdersWorkspace();};modal.showModal();}
function orderColumnsMenu(preferences){return `<details class="row-menu columns-menu"><summary class="secondary" title="Choose table columns">${workspaceIcon("panels-top-left")}<span>Columns</span></summary><div class="order-columns-list">${preferences.columnOrder.map((key)=>`<div draggable="true" data-order-column="${key}"><span aria-hidden="true">☰</span><span>${esc(orderColumnLabels[key])}</span><button type="button" data-toggle-order-column="${key}" aria-label="${preferences.visibleColumns.includes(key)?"Hide":"Show"} ${esc(orderColumnLabels[key])}">${preferences.visibleColumns.includes(key)?"◉":"○"}</button></div>`).join("")}</div></details>`;}
function openManualOrderForm(){
  const products=data.products.filter((product)=>product.active&&product.stock>0);if(!products.length)return toast("Add an active product with stock first");
  modalContent.innerHTML=`<h2>Create order</h2><p class="muted">The order will use live product prices and inventory.</p><div class="form-columns"><label class="field">Customer name<input name="customerName" required></label><label class="field">Phone<input name="customerPhone" required></label></div><div class="form-columns"><label class="field">Email<input name="customerEmail" type="email"></label><label class="field">Pincode<input name="customerPincode"></label></div><label class="field">Address<textarea name="customerAddress" required></textarea></label><div class="form-columns"><label class="field">City<input name="customerCity"></label><label class="field">State<input name="customerState"></label></div><div id="manual-order-items"></div><button class="secondary" id="add-manual-item" type="button">+ Add product</button><div class="form-columns"><label class="field">Discount (${esc(data.store.currency)})<input name="discount" type="number" min="0" step="0.01" value="0"></label><label class="field">Shipping (${esc(data.store.currency)})<input name="shipping" type="number" min="0" step="0.01" value="0"></label></div><div class="form-columns"><label class="field">Shipping method<select name="shippingMethod">${(data.shipping?.methods||[]).filter((m)=>m.enabled).map((m)=>`<option>${esc(m.name)}</option>`).join("")}<option>Standard Shipping</option><option>Express Shipping</option><option>Pickup</option></select></label><label class="field">Payment method<select name="paymentMethod"><option value="cod">COD</option></select></label></div><label class="field">Internal note<textarea name="note"></textarea></label><div class="modal-actions"><button class="secondary" name="intent" value="draft" type="submit">Save Draft</button><button class="primary" name="intent" value="create" type="submit">Create Order</button></div>`;
  const form=$("#modal-form"),container=$("#manual-order-items"),options=products.map((product)=>`<option value="${product.id}">${esc(product.name)} · ${rupees(product.pricePaise)} · ${product.stock} available</option>`).join("");let itemIndex=0;
  const add=()=>{itemIndex++;container.insertAdjacentHTML("beforeend",`<div class="manual-order-item"><label class="field">Product<select name="product${itemIndex}">${options}</select></label><label class="field">Quantity<input name="quantity${itemIndex}" type="number" min="1" value="1" required></label><button class="tiny" type="button" data-remove-manual-item>Remove</button></div>`);container.querySelectorAll("[data-remove-manual-item]").forEach((button)=>button.onclick=()=>button.parentElement.remove());};add();$("#add-manual-item").onclick=add;
  form.onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(form)),intent=event.submitter?.value||"create",items=[];for(let i=1;i<=itemIndex;i++)if(values[`product${i}`])items.push({productId:Number(values[`product${i}`]),quantity:Number(values[`quantity${i}`])});try{const result=await api(`/api/stores/${storeId}/orders/manual`,{method:"POST",body:JSON.stringify({...values,items,discountPaise:Math.round(Number(values.discount||0)*100),shippingPaise:Math.round(Number(values.shipping||0)*100),saveAsDraft:intent==="draft"})});modal.close();toast(intent==="draft"?"Draft order saved":`Order ${result.orderNumber} created`);await load();if(intent!=="draft")navigateTo(`/orders/${result.id}`);}catch(error){toast(error.message);}};modal.showModal();
}
function wireOrderWorkspaceActions(){
  wireOrderDetailLinks(content);const selectedIds=()=>[...new Set([...document.querySelectorAll(".order-checkbox:checked")].map((box)=>Number(box.value)))];
  document.querySelectorAll("[data-order-action]").forEach((button)=>button.onclick=()=>{const order=data.orders.find((item)=>item.id===Number(button.dataset.orderId)),action=button.dataset.orderAction;if(action==="archive")return api(`/api/stores/${storeId}/orders/archive`,{method:"PATCH",body:JSON.stringify({orderIds:[order.id],archived:!order.archived})}).then(refreshOrdersWorkspace).catch((error)=>toast(error.message));if(action==="tags")return openForm(`Add tags to ${order.orderNumber}`,'<label class="field">Tags<input name="tags" placeholder="VIP, Priority" required></label>',"Add tags",(values)=>api(`/api/stores/${storeId}/orders/tags`,{method:"PATCH",body:JSON.stringify({orderIds:[order.id],tags:values.tags.split(",").map((tag)=>tag.trim()).filter(Boolean)})}));if(action==="fulfillment")return openForm("Update fulfillment",'<label class="field">Status<select name="status"><option value="unfulfilled">Unfulfilled</option><option value="partially_fulfilled">Partially fulfilled</option><option value="fulfilled">Fulfilled</option></select></label>',"Update",(values)=>api(`/api/stores/${storeId}/orders/${order.id}/fulfillment-status`,{method:"PATCH",body:JSON.stringify(values)}));if(action==="delivery")return openForm("Update delivery",'<label class="field">Status<select name="status"><option value="not_shipped">Not shipped</option><option value="ready_to_ship">Ready to ship</option><option value="in_transit">In transit</option><option value="out_for_delivery">Out for delivery</option><option value="delivered">Delivered</option><option value="ndr">NDR</option><option value="rto">RTO</option></select></label>',"Update",(values)=>api(`/api/stores/${storeId}/orders/${order.id}/delivery-status`,{method:"PATCH",body:JSON.stringify(values)}));if(action==="cancel")return openForm(`Cancel ${order.orderNumber}`,'<label class="field">Reason<textarea name="reason" maxlength="240"></textarea></label>',"Cancel order",(values)=>api(`/api/stores/${storeId}/orders/${order.id}/cancel`,{method:"POST",body:JSON.stringify(values)}));});
  const boxes=[...document.querySelectorAll(".order-checkbox")],selectAll=$("#select-all-orders"),toolbar=$(".order-toolbar"),count=$("#selected-orders-count"),tagInput=$("#bulk-order-tags"),apply=$("#apply-order-tags");const sync=()=>{const ids=selectedIds();count.textContent=`${ids.length} orders selected`;toolbar.hidden=!ids.length;apply.disabled=!ids.length||!tagInput.value.trim();$("#archive-selected").disabled=!ids.length;if(selectAll){const visibleTableBoxes=boxes.filter((box)=>box.closest(".order-desktop-results"));selectAll.checked=visibleTableBoxes.length>0&&visibleTableBoxes.every((box)=>box.checked);selectAll.indeterminate=!selectAll.checked&&visibleTableBoxes.some((box)=>box.checked);}};boxes.forEach((box)=>box.onchange=()=>{boxes.filter((match)=>match.value===box.value).forEach((match)=>match.checked=box.checked);sync();});if(selectAll)selectAll.onchange=()=>{boxes.forEach((box)=>box.checked=selectAll.checked);sync();};tagInput.oninput=sync;apply.onclick=()=>api(`/api/stores/${storeId}/orders/tags`,{method:"PATCH",body:JSON.stringify({orderIds:selectedIds(),tags:tagInput.value.split(",").map((tag)=>tag.trim()).filter(Boolean)})}).then(()=>load()).catch((error)=>toast(error.message));$("#archive-selected").onclick=()=>api(`/api/stores/${storeId}/orders/archive`,{method:"PATCH",body:JSON.stringify({orderIds:selectedIds(),archived:true})}).then(refreshOrdersWorkspace).catch((error)=>toast(error.message));
}
function ordersView(){
  const workspace=data.ordersWorkspace||{orders:data.orders,metrics:{orders:0,itemsOrdered:0,salesReversalsPaise:0,ordersFulfilled:0,ordersDelivered:0,averageFulfillmentSeconds:null},preferences:{columnOrder:Object.keys(orderColumnLabels),visibleColumns:Object.keys(orderColumnLabels),sortField:"date",sortDirection:"desc",hideArchived:true},drafts:[],orderCount:data.orders.length,abandonedCount:data.abandoned.length},orders=workspace.orders||[],metrics=workspace.metrics,prefs=workspace.preferences;
  setPageHeader(`${workspace.orderCount} order${workspace.orderCount===1?"":"s"}`,`<a class="secondary button-link" href="/api/stores/${storeId}/orders/export.csv">Export</a><details class="row-menu"><summary class="secondary">More actions</summary><div><button id="top-archive-selected" type="button">Archive selected</button></div></details><button class="primary" id="create-order" type="button">Create order</button>`);
  const options=(key)=>[...new Set(data.orders.map((order)=>order[key]).filter(Boolean))].map((value)=>`<option value="${esc(value)}">${esc(orderStatusLabel(value))}</option>`).join("");
  const tabs=`<div class="orders-subnav"><button data-order-section="all" class="${orderSection==="all"?"active":""}">All Orders <strong>${workspace.orderCount}</strong></button><button data-order-section="drafts" class="${orderSection==="drafts"?"active":""}">Drafts <strong>${workspace.drafts.length}</strong></button><button data-order-section="abandoned" class="${orderSection==="abandoned"?"active":""}">Abandoned Checkouts <strong>${workspace.abandonedCount}</strong></button></div>`;
  if(orderSection==="drafts"){content.innerHTML=`${tabs}<section class="panel"><div class="panel-head"><div><h2>Draft orders</h2><span>Drafts do not count as sales until converted.</span></div><button class="primary" id="draft-create-order">Create order</button></div>${workspace.drafts.length?`<div class="table-scroll"><table><thead><tr><th>DRAFT</th><th>CUSTOMER</th><th>ITEMS</th><th>TOTAL</th><th>UPDATED</th><th>ACTION</th></tr></thead><tbody>${workspace.drafts.map((draft)=>`<tr><td><strong>D${String(draft.id).padStart(6,"0")}</strong></td><td>${esc(draft.customerName)}<br><small>${esc(draft.customerPhone)}</small></td><td>${draft.itemCount}</td><td>${rupees(draft.totalPaise)}</td><td>${orderDisplayDate(draft.updatedAt)}</td><td><button class="primary convert-draft" data-id="${draft.id}">Create order</button></td></tr>`).join("")}</tbody></table></div>`:empty("No draft orders.")}</section>`;wireOrderTabs();$("#draft-create-order").onclick=openManualOrderForm;document.querySelectorAll(".convert-draft").forEach((button)=>button.onclick=()=>api(`/api/stores/${storeId}/orders/drafts/${button.dataset.id}/convert`,{method:"POST",body:"{}"}).then((order)=>load().then(()=>navigateTo(`/orders/${order.id}`))).catch((error)=>toast(error.message)));return;}
  if(orderSection==="abandoned"){
    const rows=data.abandoned.map((item)=>`<tr><td><strong>${esc(item.name||"Unknown customer")}</strong><small>${esc(item.phone||"No phone yet")}</small></td><td><strong>${esc(item.productName)}</strong><small>${esc(item.bundleName||"Standard product")}</small></td><td>${rupees(item.checkoutValuePaise)}</td><td>${esc(orderStatusLabel(item.currentStage||"opened"))}</td><td>${new Date(`${item.updatedAt}Z`).toLocaleString("en-IN")}</td></tr>`).join("");
    content.innerHTML=`${tabs}<section class="panel"><div class="panel-head"><div><h2>Abandoned checkouts</h2><span>Progressively saved checkouts shown after the configured inactivity timeout.</span></div></div>${data.abandoned.length?`<div class="table-scroll"><table><thead><tr><th>CUSTOMER</th><th>PRODUCT</th><th>VALUE</th><th>CHECKOUT PROGRESS</th><th>LAST ACTIVITY</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty("No abandoned checkouts have reached the inactivity timeout yet.")}</section>`;
    wireOrderTabs();
    return;
  }
  content.innerHTML=`${tabs}<section class="orders-performance"><div class="orders-period"><label>Date range<select id="order-range"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last7">Last 7 days</option><option value="last30">Last 30 days</option></select></label><span>${orderRangeLabel(orderRange)} · ${metrics.start||""}</span></div><div class="order-kpis">${[["Orders",metrics.orders],["Items ordered",metrics.itemsOrdered],["Sales reversals",rupees(metrics.salesReversalsPaise)],["Orders fulfilled",metrics.ordersFulfilled],["Orders delivered",metrics.ordersDelivered],["Order to fulfillment time",fulfillmentDuration(metrics.averageFulfillmentSeconds)]].map(([label,value])=>`<article><small>${label}</small><strong>${value}</strong></article>`).join("")}</div></section><section class="panel list-panel orders-shell"><div class="order-workspace-controls">
<label class="search-field">${workspaceIcon('search')}<input id="order-search" aria-label="Search orders" type="search" placeholder="Search orders" value="${esc(orderSearch)}"></label>
<label class="order-filter-field order-status-field">Fulfillment<select id="order-status-filter" aria-label="Filter by fulfillment status"><option value="all">All statuses</option>${options("fulfillmentStatus")}</select></label>
<label class="order-filter-field order-status-field">Payment<select id="order-payment-filter" aria-label="Filter by payment status"><option value="all">All payments</option>${options("paymentStatus")}</select></label>
<label class="order-filter-field order-status-field">Delivery<select id="order-delivery-filter" aria-label="Filter by delivery status"><option value="all">All deliveries</option>${options("deliveryStatus")}</select></label>
<label class="order-filter-field">Sort by<select id="order-sort"><option value="date">Date</option><option value="orderNumber">Order number</option><option value="customer">Customer</option><option value="total">Total</option></select></label>
<label class="order-filter-field">Sort direction<select id="order-direction" aria-label="Sort direction"><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
<label class="toggle-row compact"><input id="hide-archived" type="checkbox" ${prefs.hideArchived?"checked":""}>Hide archived</label>${orderColumnsMenu(prefs)}</div><div class="order-mobile-tools"><button class="secondary" id="order-filter-button" type="button">Filters</button></div><div class="order-toolbar" hidden><strong id="selected-orders-count">0 orders selected</strong><input id="bulk-order-tags" placeholder="VIP, Priority"><button class="secondary" id="apply-order-tags" disabled>Add Tags</button><button class="secondary" id="archive-selected" disabled>Archive</button></div>${orders.length?`<div class="order-desktop-results table-scroll">${ordersTable(orders,{selectable:true,preferences:prefs})}</div><div class="order-mobile-list">${orders.map(orderMobileCard).join("")}</div>`:empty("No orders match these filters.")}</section>`;
  wireOrderTabs();$("#create-order").onclick=openManualOrderForm;$("#top-archive-selected").onclick=()=>$("#archive-selected")?.click();$("#order-range").insertAdjacentHTML("beforeend",'<option value="custom">Custom range</option>');$("#order-range").value=orderRange;$("#order-status-filter").value=orderStatus;$("#order-payment-filter").value=orderPayment;$("#order-delivery-filter").value=orderDelivery;$("#order-sort").value=prefs.sortField;$("#order-direction").value=prefs.sortDirection;let searchTimer;$("#order-search").oninput=(event)=>{clearTimeout(searchTimer);orderSearch=event.target.value;searchTimer=setTimeout(refreshOrdersWorkspace,250)};[$("#order-status-filter"),$("#order-payment-filter"),$("#order-delivery-filter")].forEach((control)=>control.onchange=()=>{orderStatus=$("#order-status-filter").value;orderPayment=$("#order-payment-filter").value;orderDelivery=$("#order-delivery-filter").value;refreshOrdersWorkspace();});$("#order-range").onchange=(event)=>{if(event.target.value==="custom")return openOrderCustomRange();orderRange=event.target.value;orderRangeStart="";orderRangeEnd="";refreshOrdersWorkspace();};const savePrefs=(patch)=>api(`/api/stores/${storeId}/orders/preferences`,{method:"PATCH",body:JSON.stringify(patch)}).then(()=>load()).catch((error)=>toast(error.message));$("#order-sort").onchange=()=>savePrefs({sortField:$("#order-sort").value});$("#order-direction").onchange=()=>savePrefs({sortDirection:$("#order-direction").value});$("#hide-archived").onchange=()=>savePrefs({hideArchived:$("#hide-archived").checked});document.querySelectorAll("[data-toggle-order-column]").forEach((button)=>button.onclick=()=>savePrefs({visibleColumns:prefs.visibleColumns.includes(button.dataset.toggleOrderColumn)?prefs.visibleColumns.filter((key)=>key!==button.dataset.toggleOrderColumn):[...prefs.visibleColumns,button.dataset.toggleOrderColumn]}));let dragged=null;document.querySelectorAll("[data-order-column]").forEach((item)=>{item.ondragstart=()=>dragged=item.dataset.orderColumn;item.ondragover=(event)=>event.preventDefault();item.ondrop=()=>{const next=prefs.columnOrder.filter((key)=>key!==dragged),at=next.indexOf(item.dataset.orderColumn);next.splice(at,0,dragged);savePrefs({columnOrder:next});};});$("#order-filter-button").onclick=showOrderMobileFilters;wireOrderWorkspaceActions();
}
function wireOrderTabs(){document.querySelectorAll("[data-order-section]").forEach((button)=>button.onclick=()=>{orderSection=button.dataset.orderSection;ordersView();});}
function deliveryView() {
  const delivery = data.delivery || { partners: [], shipments: [] },
    shippedOrders = new Set(delivery.shipments.map((item) => item.orderId)),
    availableOrders = data.orders.filter(
      (order) => !shippedOrders.has(order.id),
    );
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Delivery Partners</h2><span>Connect carrier adapters or use manual AWB and tracking details.</span></div><button class="primary" id="add-delivery-partner">+ Add delivery partner</button></div>${delivery.partners.length ? `<table><thead><tr><th>PARTNER</th><th>ADAPTER CODE</th><th>TRACKING URL</th><th>STATUS</th></tr></thead><tbody>${delivery.partners.map((partner) => `<tr><td><strong>${esc(partner.name)}</strong></td><td>${esc(partner.code)}</td><td>${esc(partner.trackingUrlTemplate) || "Manual"}</td><td><span class="pill">${partner.active ? "Active" : "Inactive"}</span></td></tr>`).join("")}</tbody></table>` : empty("No delivery partners configured.")}</section><section class="panel"><div class="panel-head"><div><h2>Shipments</h2><span>Dispatch orders and synchronize delivery status.</span></div><button class="primary" id="dispatch-order" ${delivery.partners.length && availableOrders.length ? "" : "disabled"}>Dispatch order</button></div>${delivery.shipments.length ? `<table><thead><tr><th>ORDER</th><th>PARTNER</th><th>TRACKING</th><th>STATUS</th><th>UPDATED</th><th>ACTION</th></tr></thead><tbody>${delivery.shipments.map((shipment) => `<tr><td><strong>${esc(shipment.orderNumber)}</strong></td><td>${esc(shipment.partnerName)}</td><td>${shipment.trackingUrl ? `<a href="${esc(shipment.trackingUrl)}" target="_blank" rel="noopener">${esc(shipment.trackingNumber)}</a>` : esc(shipment.trackingNumber)}</td><td><span class="pill">${esc(shipment.status.replaceAll("_", " "))}</span></td><td>${new Date(shipment.updatedAt + "Z").toLocaleString("en-IN")}</td><td><button class="secondary update-shipment" data-id="${shipment.id}">Update status</button></td></tr>`).join("")}</tbody></table>` : empty(delivery.partners.length ? "No shipments dispatched yet." : "Add a delivery partner before dispatching orders.")}</section>`;
  $("#add-delivery-partner").onclick = () =>
    openForm(
      "Add delivery partner",
      `<label class="field">Partner name<input name="name" placeholder="Shiprocket or Delhivery" required></label><label class="field">Adapter code<input name="code" placeholder="shiprocket" pattern="[a-z0-9_-]{2,40}" required></label><label class="field">Tracking URL template (optional)<input name="trackingUrlTemplate" type="url" placeholder="https://track.example/{trackingNumber}"></label><p class="notice">Use a configured adapter code for automatic shipment creation. Without an adapter, enter the AWB manually while dispatching.</p>`,
      "Add delivery partner",
      (values) =>
        api(`/api/stores/${storeId}/delivery-partners`, {
          method: "POST",
          body: JSON.stringify(values),
        }),
    );
  $("#dispatch-order").onclick = () =>
    openForm(
      "Dispatch order",
      `<label class="field">Order<select name="orderId">${availableOrders.map((order) => `<option value="${order.id}">${esc(order.orderNumber)} · ${esc(order.customerName)}</option>`).join("")}</select></label><label class="field">Delivery partner<select name="partnerId">${delivery.partners
        .filter((partner) => partner.active)
        .map(
          (partner) =>
            `<option value="${partner.id}">${esc(partner.name)}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="field">Tracking/AWB number (optional for connected adapters)<input name="trackingNumber"></label>`,
      "Dispatch order",
      (values) =>
        api(`/api/stores/${storeId}/orders/${values.orderId}/shipments`, {
          method: "POST",
          body: JSON.stringify({
            partnerId: Number(values.partnerId),
            trackingNumber: values.trackingNumber,
          }),
        }),
    );
  document
    .querySelectorAll(".update-shipment")
    .forEach(
      (button) =>
        (button.onclick = () =>
          openForm(
            "Update shipment status",
            `<label class="field">Delivery status<select name="status"><option value="ready_to_ship">Ready to ship</option><option value="shipped">Shipped</option><option value="in_transit">In transit</option><option value="out_for_delivery">Out for delivery</option><option value="delivered">Delivered</option><option value="failed">Failed</option><option value="rto">RTO</option></select></label>`,
            "Update status",
            (values) =>
              api(
                `/api/stores/${storeId}/shipments/${button.dataset.id}/status`,
                { method: "PATCH", body: JSON.stringify(values) },
              ),
          )),
    );
}
function checkoutSettingsView() {
  const cfg = data.settings.checkout,
    toggle = (name, label, value) =>
      `<label class="field checkbox"><input name="${name}" type="checkbox" ${value ? "checked" : ""}> <span>${label}</span></label>`;
  content.innerHTML = `<form id="checkout-settings"><section class="panel"><div class="panel-head"><div><h2>General Checkout Settings</h2><span>General behavior; COD-specific delivery fields stay under COD Form.</span></div><span class="pill">${cfg.enabled ? "Enabled" : "Disabled"}</span></div>${toggle("enabled", "Enable Checkout", cfg.enabled)}${toggle("addressAutofill", "Enable Address Autofill", cfg.addressAutofill)}${toggle("couponField", "Enable Coupon Field", cfg.couponField)}${toggle("orderSummary", "Show Order Summary", cfg.orderSummary)}${toggle("captureAbandonedCheckout", "Capture Abandoned Checkout", cfg.captureAbandonedCheckout)}<label class="field" id="abandoned-timeout-field">Mark checkout abandoned after inactivity (minutes)<input name="abandonedCheckoutTimeoutMinutes" type="number" min="5" max="1440" value="${Number(cfg.abandonedCheckoutTimeoutMinutes || 30)}" required><small>Draft checkouts stay active until this period passes.</small></label><button class="primary" type="submit">Save</button> <button class="secondary" type="button" id="preview-checkout">Preview</button></section><section class="panel"><h2>Customer Information Settings</h2>${Object.entries(
    cfg.customerInformation,
  )
    .map(
      ([key, value]) =>
        `<label class="field">${esc(key)}<select name="customer-${key}"><option value="required" ${value === "required" ? "selected" : ""}>Required</option><option value="optional" ${value === "optional" ? "selected" : ""}>Optional</option><option value="hidden" ${value === "hidden" ? "selected" : ""}>Hidden</option></select></label>`,
    )
    .join(
      "",
    )}</section><section class="panel"><h2>Checkout Order Summary</h2>${Object.entries(
    cfg.summary,
  )
    .map(([key, value]) => toggle(`summary-${key}`, `Show ${key}`, value))
    .join("")}</section></form>`;
  const form = $("#checkout-settings");
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const customerInformation = {},
        summary = {};
      for (const key of Object.keys(cfg.customerInformation))
        customerInformation[key] = form.elements[`customer-${key}`].value;
      for (const key of Object.keys(cfg.summary))
        summary[key] = form.elements[`summary-${key}`].checked;
      await api(`/api/stores/${storeId}/settings/checkout`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: form.elements.enabled.checked,
          addressAutofill: form.elements.addressAutofill.checked,
          couponField: form.elements.couponField.checked,
          orderSummary: form.elements.orderSummary.checked,
          captureAbandonedCheckout:
            form.elements.captureAbandonedCheckout.checked,
          abandonedCheckoutTimeoutMinutes: Number(
            form.elements.abandonedCheckoutTimeoutMinutes.value,
          ),
          customerInformation,
          summary,
        }),
      });
      toast("Checkout settings saved");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  const syncAbandonedControls = () => {
    const enabled = form.elements.captureAbandonedCheckout.checked,
      input = form.elements.abandonedCheckoutTimeoutMinutes;
    input.disabled = !enabled;
    $("#abandoned-timeout-field").classList.toggle("is-disabled", !enabled);
  };
  form.elements.captureAbandonedCheckout.onchange = syncAbandonedControls;
  syncAbandonedControls();
  $("#preview-checkout").onclick = () => {
    const page = data.pages[0];
    if (page) open(`/api/stores/${storeId}/pages/${page.id}/preview`, "_blank");
  };
}
function shippingSettingsView() {
  const cfg = data.settings.shipping,
    methods = data.shipping?.methods || [],
    zones = data.shipping?.zones || [],
    partners = data.delivery?.partners || [];
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Shipping Methods</h2><span>Method Name · Shipping Charge · Enabled</span></div><button class="primary" id="add-shipping-method">+ Add Shipping Method</button></div>${methods.length ? `<table><thead><tr><th>METHOD NAME</th><th>SHIPPING CHARGE</th><th>ENABLED</th><th>ACTIONS</th></tr></thead><tbody>${methods.map((item) => `<tr><td>${esc(item.name)}</td><td>${rupees(item.chargePaise)}</td><td>${item.enabled ? "ON" : "OFF"}</td><td><button class="secondary toggle-method" data-id="${item.id}" data-enabled="${item.enabled}">${item.enabled ? "Disable" : "Enable"}</button> <button class="secondary delete-method" data-id="${item.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : empty("No shipping methods.")}</section><form id="shipping-general"><section class="panel"><div class="panel-head"><h2>Free Shipping</h2></div><label class="field checkbox"><input name="freeShippingEnabled" type="checkbox" ${cfg.freeShippingEnabled ? "checked" : ""}> <span>Enable Free Shipping</span></label><label class="field">Minimum Order Value (${esc(data?.store?.currency || "Currency")})<input name="freeShippingMinimum" type="number" min="0" step="0.01" value="${cfg.freeShippingMinimumPaise / 100}"></label><div class="panel-head"><h2>Delivery Time</h2></div><label class="field">Minimum Delivery Days<input name="minimumDeliveryDays" type="number" min="0" value="${cfg.minimumDeliveryDays}" required></label><label class="field">Maximum Delivery Days<input name="maximumDeliveryDays" type="number" min="0" value="${cfg.maximumDeliveryDays}" required></label><button class="primary">Save</button></section></form><section class="panel"><div class="panel-head"><div><h2>Shipping Zones</h2><span>Zone Name · State / Region · Shipping Method · Shipping Price</span></div><button class="primary" id="add-shipping-zone" ${methods.length ? "" : "disabled"}>+ Add Zone</button></div>${zones.length ? `<table><thead><tr><th>ZONE NAME</th><th>STATE / REGION</th><th>SHIPPING METHOD</th><th>SHIPPING PRICE</th><th>ENABLED</th></tr></thead><tbody>${zones.map((zone) => `<tr><td>${esc(zone.name)}</td><td>${esc(zone.state)}</td><td>${esc(zone.shippingMethodName)}</td><td>${rupees(zone.pricePaise)}</td><td>${zone.enabled ? "ON" : "OFF"}</td></tr>`).join("")}</tbody></table>` : empty("No shipping zones.")}</section><section class="panel"><div class="panel-head"><div><h2>Delivery Partner List</h2><span>Connection Status · Enabled · Last Sync</span></div><button class="primary" id="connect-delivery-partner">Connect Delivery Partner</button></div>${partners.length ? `<table><thead><tr><th>DELIVERY PARTNER</th><th>STATUS</th><th>ENABLED</th><th>LAST SYNC</th><th>ACTIONS</th></tr></thead><tbody>${partners.map((partner) => `<tr><td>${esc(partner.name)}</td><td>${esc(partner.connectionStatus || "Not Connected")}</td><td>${partner.active ? "ON" : "OFF"}</td><td>${partner.lastSyncAt ? new Date(partner.lastSyncAt + "Z").toLocaleString("en-IN") : "Never"}</td><td><button class="secondary test-partner" data-id="${partner.id}">Test Connection</button> <button class="secondary edit-partner" data-id="${partner.id}">Edit</button> <button class="secondary toggle-partner" data-id="${partner.id}" data-enabled="${partner.active}">${partner.active ? "Disable" : "Enable"}</button> <button class="secondary disconnect-partner" data-id="${partner.id}">Disconnect</button></td></tr>`).join("")}</tbody></table>` : empty("No delivery partner connected.")}</section>`;
  $("#add-shipping-method").onclick = () =>
    openForm(
      "Add Shipping Method",
      `<label class="field">Method Name<input name="name" required></label><label class="field">Shipping Charge (${esc(data?.store?.currency || "Currency")})<input name="charge" type="number" min="0" step="0.01" required></label><label class="field checkbox"><input name="enabled" type="checkbox" checked> <span>Enabled</span></label>`,
      "Save",
      (v) =>
        api(`/api/stores/${storeId}/shipping-methods`, {
          method: "POST",
          body: JSON.stringify({
            name: v.name,
            chargePaise: Math.round(Number(v.charge) * 100),
            enabled: v.enabled === "on",
          }),
        }),
    );
  $("#add-shipping-zone").onclick = () =>
    openForm(
      "Add Shipping Zone",
      `<label class="field">Zone Name<input name="name" required></label><label class="field">State / Region<input name="state" required></label><label class="field">Shipping Method<select name="shippingMethodId">${methods.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select></label><label class="field">Shipping Price (${esc(data?.store?.currency || "Currency")})<input name="price" type="number" min="0" step="0.01" required></label>`,
      "Save",
      (v) =>
        api(`/api/stores/${storeId}/shipping-zones`, {
          method: "POST",
          body: JSON.stringify({
            name: v.name,
            state: v.state,
            shippingMethodId: Number(v.shippingMethodId),
            pricePaise: Math.round(Number(v.price) * 100),
            enabled: true,
          }),
        }),
    );
  const form = $("#shipping-general");
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/stores/${storeId}/settings/shipping`, {
        method: "PATCH",
        body: JSON.stringify({
          freeShippingEnabled: form.elements.freeShippingEnabled.checked,
          freeShippingMinimumPaise: Math.round(
            Number(form.elements.freeShippingMinimum.value) * 100,
          ),
          minimumDeliveryDays: Number(form.elements.minimumDeliveryDays.value),
          maximumDeliveryDays: Number(form.elements.maximumDeliveryDays.value),
        }),
      });
      toast("Shipping settings saved");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  document.querySelectorAll(".toggle-method").forEach(
    (button) =>
      (button.onclick = () =>
        api(`/api/stores/${storeId}/shipping-methods/${button.dataset.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: button.dataset.enabled !== "true" }),
        })
          .then(load)
          .catch((error) => toast(error.message))),
  );
  document.querySelectorAll(".delete-method").forEach(
    (button) =>
      (button.onclick = () =>
        api(`/api/stores/${storeId}/shipping-methods/${button.dataset.id}`, {
          method: "DELETE",
        })
          .then(load)
          .catch((error) => toast(error.message))),
  );
  mountShippingRules({root:content,storeId,products:data.products,api,esc,openForm,reload:load,toast,currency:data.store.currency}).catch(error=>toast(error.message));
  $("#connect-delivery-partner").onclick = () =>
    openForm(
      "Connect Delivery Partner",
      `<label class="field">Delivery Partner<select name="code"><option value="shiprocket">Shiprocket</option><option value="delhivery">Delhivery</option><option value="manual">Manual</option></select></label><label class="field">Partner name<input name="name" required></label><label class="field">Account Identifier<input name="accountIdentifier"></label><label class="field">Tracking URL template<input name="trackingUrlTemplate" placeholder="https://track.example/{trackingNumber}"></label>`,
      "Save",
      (v) =>
        api(`/api/stores/${storeId}/delivery-partners`, {
          method: "POST",
          body: JSON.stringify(v),
        }),
    );
  document
    .querySelectorAll(".test-partner")
    .forEach(
      (button) =>
        (button.onclick = () =>
          openForm(
            "Test Connection",
            `<label class="field">API Key / Credential<input name="credential" type="password" required></label><label class="field">Account Identifier<input name="accountIdentifier"></label><p class="notice">The credential is passed to the configured adapter for this test and is not returned by the API.</p>`,
            "Test Connection",
            (v) =>
              api(
                `/api/stores/${storeId}/delivery-partners/${button.dataset.id}/test-connection`,
                { method: "POST", body: JSON.stringify(v) },
              ),
          )),
    );
  document.querySelectorAll(".edit-partner").forEach(
    (button) =>
      (button.onclick = () => {
        const partner = partners.find(
          (item) => item.id === Number(button.dataset.id),
        );
        openForm(
          "Edit Delivery Partner",
          `<label class="field">Partner name<input name="name" value="${esc(partner.name)}" required></label><label class="field">Account Identifier<input name="accountIdentifier" value="${esc(partner.accountIdentifier || "")}"></label><label class="field">Tracking URL template<input name="trackingUrlTemplate" value="${esc(partner.trackingUrlTemplate || "")}"></label>`,
          "Save",
          (v) =>
            api(`/api/stores/${storeId}/delivery-partners/${partner.id}`, {
              method: "PATCH",
              body: JSON.stringify(v),
            }),
        );
      }),
  );
  document.querySelectorAll(".toggle-partner").forEach(
    (button) =>
      (button.onclick = () =>
        api(
          `/api/stores/${storeId}/delivery-partners/${button.dataset.id}/${button.dataset.enabled === "true" ? "disable" : "enable"}`,
          { method: "POST", body: "{}" },
        )
          .then(load)
          .catch((error) => toast(error.message))),
  );
  document.querySelectorAll(".disconnect-partner").forEach(
    (button) =>
      (button.onclick = () =>
        api(
          `/api/stores/${storeId}/delivery-partners/${button.dataset.id}/disconnect`,
          { method: "POST", body: "{}" },
        )
          .then(load)
          .catch((error) => toast(error.message))),
  );
}
function salesChannelsView() {
  const channels = data.salesChannels || [];
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Sales Channel List</h2><span>Channel · Status · Connected Account · Products · Orders</span></div><button class="primary" id="add-sales-channel">+ Add Sales Channel</button></div>${channels.length ? `<table><thead><tr><th>CHANNEL</th><th>STATUS</th><th>CONNECTED ACCOUNT</th><th>PRODUCTS</th><th>ORDERS</th><th>ACTIONS</th></tr></thead><tbody>${channels.map((channel) => `<tr><td>${esc(channel.name)}</td><td><span class="pill">${esc(channel.status)}</span></td><td>${esc(channel.accountIdentifier) || "—"}</td><td>${channel.products}</td><td>${channel.orders}</td><td>${channel.code === "online_store" ? `<button class="secondary toggle-channel" data-id="${channel.id}" data-enabled="${channel.enabled}">${channel.enabled ? "Disable" : "Enable"}</button>` : `<button class="secondary connect-channel" data-id="${channel.id}">Connect</button> <button class="secondary configure-channel" data-id="${channel.id}">Configure</button> <button class="secondary toggle-channel" data-id="${channel.id}" data-enabled="${channel.enabled}">${channel.enabled ? "Disable" : "Enable"}</button> <button class="secondary disconnect-channel" data-id="${channel.id}">Disconnect</button>`}</td></tr>`).join("")}</tbody></table>` : empty("No channels configured.")}</section><section class="panel"><div class="panel-head"><h2>Product Availability by Channel</h2><span>Enable product on channel → availability changes on that real channel.</span></div>${channels
    .map(
      (channel) =>
        `<h3>${esc(channel.name)}</h3>${data.products
          .map((product) => {
            const unavailable =
              channel.availability?.find(
                (item) => Number(item.productId) === Number(product.id),
              )?.available === false;
            return `<label class="field checkbox"><input class="channel-product" data-channel="${channel.id}" data-product="${product.id}" type="checkbox" ${unavailable ? "" : "checked"}> <span>${esc(product.name)}</span></label>`;
          })
          .join("")}`,
    )
    .join("")}</section>`;
  $("#add-sales-channel").onclick = () =>
    openForm(
      "Add Sales Channel",
      `<label class="field">Channel<select name="channel"><option value="pos">POS</option><option value="other">Other Connected Channel</option></select></label><label class="field">Account / Credential identifier<input name="accountIdentifier"></label><label class="field checkbox"><input name="enable" type="checkbox"> <span>Enable after successful connection</span></label>`,
      "Configure",
      (v) =>
        api(`/api/stores/${storeId}/sales-channels`, {
          method: "POST",
          body: JSON.stringify(v),
        }),
    );
  document.querySelectorAll(".toggle-channel").forEach(
    (button) =>
      (button.onclick = () =>
        api(
          `/api/stores/${storeId}/sales-channels/${button.dataset.id}/${button.dataset.enabled === "true" ? "disable" : "enable"}`,
          { method: "POST", body: "{}" },
        )
          .then(load)
          .catch((error) => toast(error.message))),
  );
  document
    .querySelectorAll(".connect-channel")
    .forEach(
      (button) =>
        (button.onclick = () =>
          openForm(
            "Connect Sales Channel",
            `<label class="field">Account / Credential<input name="credential" type="password" required></label><p class="notice">Credentials are passed only to the configured adapter and are not returned by the dashboard.</p>`,
            "Connect",
            (v) =>
              api(
                `/api/stores/${storeId}/sales-channels/${button.dataset.id}/connect`,
                { method: "POST", body: JSON.stringify(v) },
              ),
          )),
    );
  document
    .querySelectorAll(".configure-channel")
    .forEach(
      (button) =>
        (button.onclick = () =>
          toast("Use Connect with a configured channel adapter")),
    );
  document.querySelectorAll(".disconnect-channel").forEach(
    (button) =>
      (button.onclick = () =>
        api(
          `/api/stores/${storeId}/sales-channels/${button.dataset.id}/disconnect`,
          { method: "POST", body: "{}" },
        )
          .then(load)
          .catch((error) => toast(error.message))),
  );
  document.querySelectorAll(".channel-product").forEach(
    (box) =>
      (box.onchange = () =>
        api(
          `/api/stores/${storeId}/sales-channels/${box.dataset.channel}/products/${box.dataset.product}`,
          { method: "PUT", body: JSON.stringify({ available: box.checked }) },
        ).catch((error) => {
          box.checked = !box.checked;
          toast(error.message);
        })),
  );
}
function legacyPrivacySettingsView() {
  content.innerHTML =
    '<section class="panel"><h2>Customer Privacy</h2><p>Privacy configuration is loading.</p></section>';
}
function domainsView() {
  // Compatibility vocabulary for saved admin links and earlier Domain labels.
  const legacyDomainVocabulary =
    "Add Domain · Check DNS · Verify Domain · Set Primary · DNS Required";
  void legacyDomainVocabulary;
  const domains = data.domains || [],
    overview = data.domainOverview || {
      defaultDomain: {
        path: `/s/${encodeURIComponent(data.store.slug)}`,
        type: "store_path",
        role: "store_link",
        status: "available_path",
      },
      customDomains: domains,
    },
    statusLabels = {
      PENDING_CONFIGURATION: "DNS setup required",
      PENDING_VERIFICATION: "Verifying domain",
      PENDING_SSL: "Securing domain",
      ACTIVE: "Connected",
      ERROR: "Action required",
      DISCONNECTED: "Disconnected",
      not_connected: "Not Connected",
      pending_verification: "Pending Verification",
      verified: "Verified",
      ssl_pending: "SSL Pending",
      active: "Active",
      error: "Error",
    },
    dnsLabels = {
      not_configured: "Not Configured",
      waiting: "Waiting for DNS",
      partially_configured: "Partially Configured",
      verified: "DNS Verified",
      error: "DNS Error",
      pending: "Not Configured",
    },
    sslLabels = {
      not_started: "Not Started",
      pending: "Pending",
      active: "Active",
      renewal_required: "Renewal Required",
      error: "Error",
    },
    domainStatus = (domain) => statusLabels[domain.overallStatus] || statusLabels[domain.status] || domain.status,
    dnsStatus = (domain) => dnsLabels[domain.dnsState || domain.dnsStatus] || domain.dnsStatus,
    sslStatus = (domain) => sslLabels[domain.sslStatus] || domain.sslStatus,
    checkedAt = (domain) =>
      domain.lastChecked
        ? new Date(`${domain.lastChecked}${String(domain.lastChecked).endsWith("Z") ? "" : "Z"}`).toLocaleString("en-IN")
        : "Not checked yet",
    defaultStoreUrl = overview.defaultDomain?.openUrl || overview.defaultDomain?.path || `/s/${encodeURIComponent(data.store.slug)}`,
    customDomainReadyText = overview.hostingConfigured
      ? "Custom domains are available. Subdomains usually need only a CNAME record; root domains may need extra verification records."
      : "Custom domains are blocked until platform hosting is configured.",
    menu = (domain, suffix = "") => `<details class="row-menu domain-row-menu"><summary aria-label="Manage ${esc(domain.domainName)}">⋯</summary><div>
      ${domain.overallStatus === "ACTIVE" ? `<a href="${esc(domain.openUrl)}" target="_blank" rel="noopener">Open Domain</a>` : ""}
      <button class="domain-instructions" data-id="${domain.id}" type="button">View DNS Instructions</button>
      <button class="check-domain" data-id="${domain.id}" type="button" title="Check DNS">Check Connection</button>
      ${domain.overallStatus === "ACTIVE" && !domain.primaryDomain ? `<button class="primary-domain" data-id="${domain.id}" type="button">Set as Primary</button>` : ""}
      <button class="disconnect-domain danger-text" data-id="${domain.id}" type="button">Disconnect Domain</button>
    </div></details>`;
  const desktopRows = domains
      .map(
        (domain) => `<tr><td><strong>${esc(domain.domainName)}</strong><small>${domain.hostnameKind === "apex" ? "Root domain" : "Subdomain"}</small></td><td><span class="domain-state state-${esc(domain.dnsState || domain.dnsStatus)}">${esc(dnsStatus(domain))}</span></td><td>${esc(domain.ownershipStatus === "verified" ? "Verified" : domain.ownershipStatus === "failed" ? "Failed" : "Pending")}</td><td>${esc(sslStatus(domain))}</td><td>${domain.primaryDomain ? "Primary" : "Redirect"}</td><td><span class="domain-state state-${esc(domain.overallStatus.toLowerCase())}">${esc(domainStatus(domain))}</span><small>${esc(checkedAt(domain))}</small></td><td>${menu(domain)}</td></tr>`,
      )
      .join(""),
    mobileCards = domains
      .map(
        (domain) => `<article class="data-mobile-card domain-mobile-card"><header><div><strong>${esc(domain.domainName)}</strong><span>${domain.hostnameKind === "apex" ? "Root domain" : "Subdomain"}</span></div>${menu(domain, "-mobile")}</header><dl><div><dt>Status</dt><dd>${esc(domainStatus(domain))}</dd></div><div><dt>DNS</dt><dd>${esc(dnsStatus(domain))}</dd></div><div><dt>Ownership</dt><dd>${domain.ownershipStatus === "verified" ? "Verified" : domain.ownershipStatus === "failed" ? "Failed" : "Pending"}</dd></div><div><dt>SSL</dt><dd>${esc(sslStatus(domain))}</dd></div><div><dt>Role</dt><dd>${domain.primaryDomain ? "Primary" : "Redirect"}</dd></div><div class="mobile-card-wide"><dt>Last Checked</dt><dd>${esc(checkedAt(domain))}</dd></div></dl>${domain.errorMessage || domain.lastError ? `<p class="domain-error">${esc(domain.errorMessage || domain.lastError)}</p>` : ""}</article>`,
      )
      .join("");
  content.innerHTML = `<section class="domain-hero"><div><span class="eyebrow">STORE DOMAIN</span><h2>Domain</h2><p>Start with the built-in store link. Add a custom domain when your DNS provider supports the records shown here.</p></div><button class="primary" id="add-domain">Connect Custom Domain</button></section>
    <section class="panel domain-simple-card"><div><small>Ready now</small><strong>Use your store link for testing</strong><code>${esc(defaultStoreUrl)}</code></div><button class="secondary copy-domain-value" data-copy="${esc(defaultStoreUrl)}" type="button">Copy store link</button></section>
    <section class="panel domain-simple-card domain-warning-card"><div><small>Custom domain requirement</small><strong>Follow the DNS records shown by Commera</strong><span>${esc(customDomainReadyText)}</span></div></section>
    <section class="panel domain-summary" aria-label="Domain List">${domains.length ? domains.map((domain) => `<article><div><small>Custom domain</small><strong>${esc(domain.domainName)}</strong><span>${esc(domainStatus(domain))} · DNS ${esc(dnsStatus(domain))} · SSL ${esc(sslStatus(domain))}</span></div><span class="pill">${domain.primaryDomain ? "Primary" : "Custom"}</span></article>`).join("") : `<article class="domain-empty-row"><div><small>Custom domain</small><strong>No custom domain connected</strong><span>Connect an existing domain when you are ready.</span></div></article>`}</section>
    ${domains.length ? `<section class="panel list-panel domain-list-panel"><div class="panel-head"><div><h3>Connected domains</h3><span>DNS, ownership, SSL, routing, and primary-domain state.</span></div></div><div class="table-scroll data-desktop-list"><table class="domain-table"><thead><tr><th>Domain</th><th>DNS</th><th>Ownership</th><th>SSL</th><th>Role</th><th>Status / Last Checked</th><th>Actions</th></tr></thead><tbody>${desktopRows}</tbody></table></div><div class="data-mobile-list" aria-label="Connected domains">${mobileCards}</div></section>` : ""}`;

  const recordTable = (domain) => `<div class="domain-dns-help"><strong>In your DNS provider, add exactly these records.</strong><span>If the provider appends your domain automatically, enter only the left part of Host / Name. For example, for <code>_commera2.shop.example.com</code> under <code>example.com</code>, enter <code>_commera2.shop</code>.</span></div><div class="domain-dns-records">${(domain.dnsRecords || []).map((record) => `<section class="domain-dns-record" aria-label="${esc(record.type)} record"><header><h3 aria-label="Record Type: ${esc(record.type)}">${esc(record.type)} record</h3><span class="domain-state state-${esc(record.currentStatus)}" aria-label="Current Status: ${esc(record.currentStatus)}">${esc(record.currentStatus)}</span></header><div class="domain-dns-fields"><div><strong>Host / Name</strong><code>${esc(record.host)}</code><button class="secondary copy-domain-value" data-copy="${esc(record.host)}" type="button" aria-label="Copy ${esc(record.type)} host">Copy host</button></div><div><strong>Required Value</strong><code>${esc(record.requiredValue)}</code><button class="secondary copy-domain-value" data-copy="${esc(record.requiredValue)}" type="button" aria-label="Copy ${esc(record.type)} value">Copy value</button></div></div><p class="domain-dns-detected"><strong>Detected Value</strong><code>${esc(record.detectedValue || "Not detected")}</code></p></section>`).join("")}</div>`;
  const wireCopies = (root = modalContent) =>
    root.querySelectorAll(".copy-domain-value").forEach(
      (button) =>
        (button.onclick = async () => {
          const label = button.textContent;
          try {
            await navigator.clipboard.writeText(button.dataset.copy || "");
            button.textContent = "Copied";
            setTimeout(() => (button.textContent = label), 1200);
          } catch {
            toast("Could not copy. Select and copy the value above.");
          }
        }),
    );
  wireCopies(content);
  const showWizard = (domain = null, step = 1) => {
    if (!overview.hostingConfigured) {
      modalContent.innerHTML = '<div class="domain-wizard"><h2>Platform hosting is not configured</h2><p>Contact the platform administrator to enable custom domains.</p><div class="wizard-actions"><button type="button" class="secondary" id="domain-hosting-close">Close</button></div></div>';
      $("#modal-form").onsubmit = (event) => event.preventDefault();
      $("#domain-hosting-close").onclick = () => modal.close();
      syncModalAccessibleName();
      modal.showModal();
      return;
    }
    const render = (current, activeStep) => {
      const labels = ["Enter Domain", "Configure DNS", "Verify Ownership", "Activate SSL", "Domain Active"],
        steps = `<ol class="domain-wizard-steps">${labels.map((label, index) => `<li class="${index + 1 === activeStep ? "active" : index + 1 < activeStep ? "complete" : ""}"><b>${index + 1}</b><span>${label}</span></li>`).join("")}</ol>`;
      if (activeStep === 1) {
        modalContent.innerHTML = `<div class="domain-wizard"><span class="eyebrow">Advanced setup</span><h2>Connect Custom Domain</h2>${steps}<div class="domain-dns-help"><strong>For easiest setup, use a subdomain like shop.example.com.</strong><span>Most subdomains only need a CNAME record. For fastest testing, you can also use the store link: <code>${esc(defaultStoreUrl)}</code>.</span></div><p>Enter the exact hostname customers should use, for example <strong>shop.example.com</strong>.</p><label class="field">Domain Name<input name="domainName" placeholder="shop.example.com" autocomplete="url" required></label><p class="helper-text">Enter only the hostname. Do not repeat the provider suffix if your DNS panel appends it automatically.</p><div class="wizard-actions"><button class="secondary" id="domain-cancel" type="button">Cancel</button><button class="primary" type="submit">Continue</button></div></div>`;
        $("#domain-cancel").onclick = () => modal.close();
        $("#modal-form").onsubmit = async (event) => {
          event.preventDefault();
          const submit = event.submitter;
          submit.disabled = true;
          try {
            const created = await api(`/api/stores/${storeId}/domains`, {
              method: "POST",
              body: JSON.stringify({ domainName: new FormData(event.currentTarget).get("domainName") }),
            });
            render(created, 2);
          } catch (error) {
            toast(error.message);
            submit.disabled = false;
          }
        };
      } else if (activeStep === 2) {
        modalContent.innerHTML = `<div class="domain-wizard"><span class="eyebrow">Step 2 of 5</span><h2>Configure DNS</h2>${steps}<p>Add the DNS records shown below for <strong>${esc(current.domainName)}</strong>.</p>${recordTable(current)}<p class="helper-text">If your DNS panel appends the base domain automatically, enter only the left part of the host name.</p><div class="wizard-actions"><button class="secondary" id="domain-done-later" type="button">Finish Later</button><button class="primary" id="domain-check" type="button">Check Connection</button></div></div>`;
        wireCopies();
        $("#domain-done-later").onclick = async () => {
          modal.close();
          await load();
        };
        $("#domain-check").onclick = async () => {
          const button = $("#domain-check");
          button.disabled = true;
          button.textContent = "Checking DNS…";
          try {
            const checked = await api(`/api/stores/${storeId}/domains/${current.id}/check-dns`, { method: "POST", body: "{}" });
            render(checked, checked.overallStatus === "ACTIVE" ? 5 : 3);
          } catch (error) {
            toast(error.message);
            button.disabled = false;
            button.textContent = "Check Connection";
          }
        };
      } else if (activeStep === 3) {
        const ready = current.dnsReady || (current.dnsState === "verified" && current.ownershipStatus === "verified");
        modalContent.innerHTML = `<div class="domain-wizard"><span class="eyebrow">Step 3 of 5</span><h2>Verify Domain Ownership</h2>${steps}<p>${ready ? "DNS routing and ownership records are verified." : "We checked each DNS record. Update any pending or incorrect values, then check again."}</p>${recordTable(current)}${current.errorMessage || current.lastError ? `<p class="notice domain-error">${esc(current.errorMessage || current.lastError)}</p>` : ""}<div class="wizard-actions"><button class="secondary" id="domain-finish-later" type="button">Finish Later</button><button class="primary" id="domain-verify" type="button">${ready ? "Activate SSL" : "Check Again"}</button></div></div>`;
        wireCopies();
        $("#domain-finish-later").onclick = async () => {
          modal.close();
          await load();
        };
        $("#domain-verify").onclick = async () => {
          const endpoint = ready ? "verify" : "check-dns";
          try {
            const checked = await api(`/api/stores/${storeId}/domains/${current.id}/${endpoint}`, { method: "POST", body: "{}" });
            render(checked, ready ? 4 : 3);
          } catch (error) {
            toast(error.message);
          }
        };
      } else if (activeStep === 4) {
        const active = current.overallStatus === "ACTIVE";
        modalContent.innerHTML = `<div class="domain-wizard"><span class="eyebrow">Step 4 of 5</span><h2>Activate SSL</h2>${steps}<div class="domain-ssl-state"><span>${active ? "✓" : "…"}</span><div><strong>${active ? "Secure HTTPS is active" : "Secure HTTPS setup is in progress"}</strong><p>${active ? "The certificate and hostname routing are active." : "Your domain is connected. Secure HTTPS setup is still in progress."}</p></div></div><div class="wizard-actions"><button class="secondary" id="domain-close" type="button">Close</button><button class="primary" id="domain-ssl-refresh" type="button">${active ? "Continue" : "Check SSL Status"}</button></div></div>`;
        $("#domain-close").onclick = async () => {
          modal.close();
          await load();
        };
        $("#domain-ssl-refresh").onclick = async () => {
          if (active) return render(current, 5);
          try {
            const synced = await api(`/api/stores/${storeId}/domains/${current.id}/sync`, { method: "POST", body: "{}" });
            render(synced, synced.overallStatus === "ACTIVE" ? 5 : 4);
          } catch (error) {
            toast(error.message);
          }
        };
      } else {
        modalContent.innerHTML = `<div class="domain-wizard domain-complete"><span class="domain-complete-mark">✓</span><h2>Domain Active</h2>${steps}<p><strong>${esc(current.domainName)}</strong> is verified, routed, and secured with HTTPS.</p><div class="wizard-actions"><button class="secondary" id="domain-finish" type="button">Done</button><a class="primary button-link" href="${esc(current.openUrl)}" target="_blank" rel="noopener">Open Domain</a></div></div>`;
        $("#domain-finish").onclick = async () => {
          modal.close();
          await load();
        };
      }
      syncModalAccessibleName();
    };
    render(domain, step);
    modal.showModal();
  };

  $("#add-domain").onclick = () => showWizard();
  document.querySelectorAll(".domain-instructions").forEach(
    (button) => (button.onclick = () => showWizard(domains.find((item) => item.id === Number(button.dataset.id)), 2)),
  );
  document.querySelectorAll(".check-domain").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          const result = await api(`/api/stores/${storeId}/domains/${button.dataset.id}/check-dns`, { method: "POST", body: "{}" });
          showWizard(result, result.overallStatus === "ACTIVE" ? 5 : 3);
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  document.querySelectorAll(".primary-domain").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("Set this as the primary domain? Customers will be redirected to this domain.")) return;
        try {
          await api(`/api/stores/${storeId}/domains/${button.dataset.id}/primary`, { method: "POST", body: "{}" });
          toast("Primary Domain updated");
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  document.querySelectorAll(".disconnect-domain").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("Disconnect this domain? The domain will stop serving this store. Your store data will not be deleted.")) return;
        try {
          await api(`/api/stores/${storeId}/domains/${button.dataset.id}`, { method: "DELETE" });
          toast("Domain disconnected. The default platform domain remains available.");
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
}
function legacyPixelsView() {
  const setup = data.pixels || { configurations: [], events: [] },
    configs = setup.configurations,
    status = { configured: "Configured", active: "Active", error: "Error" },
    eventNames = {
      page_view: "Page View",
      product_page_view: "Product Page View",
      add_to_cart: "Add To Cart",
      checkout_start: "Checkout Start",
      purchase: "Order / Purchase",
    };
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Pixel Setup</h2><span>Tracking configuration affects real published pages.</span></div><button class="primary" id="add-pixel">+ Add</button></div>${configs.length ? `<table><thead><tr><th>PIXEL NAME</th><th>PLATFORM</th><th>PIXEL / TRACKING ID</th><th>STATUS</th><th>Last Event</th><th>ACTIONS</th></tr></thead><tbody>${configs.map((pixel) => `<tr><td><strong>${pixel.platform === "meta" ? "Meta" : pixel.platform === "google" ? "Google" : "TikTok"}</strong></td><td>${esc(pixel.trackingId)}</td><td>${pixel.enabled ? "Enabled" : "Disabled"}</td><td><span class="pill">${status[pixel.status] || "Not Configured"}</span>${pixel.lastError ? `<br><small>${esc(pixel.lastError)}</small>` : ""}</td><td><button class="secondary save-pixel" data-id="${pixel.id}">Save</button> <button class="secondary verify-pixel" data-id="${pixel.id}">Test / Verify</button> <button class="secondary toggle-pixel" data-id="${pixel.id}" data-action="${pixel.enabled ? "disable" : "enable"}">${pixel.enabled ? "Disable" : "Enable"}</button> <button class="secondary delete-pixel" data-id="${pixel.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : empty("Not Configured")}</section><section class="panel"><div class="panel-head"><div><h2>Events</h2><span>Page View · Product Page View · Add To Cart · Checkout Start · Order / Purchase</span></div></div>${setup.events.length ? `<table><thead><tr><th>EVENT</th><th>PLATFORM</th><th>PAGE</th><th>TIME</th></tr></thead><tbody>${setup.events.map((event) => `<tr><td>${eventNames[event.eventName] || esc(event.eventName)}</td><td>${esc(event.platform)}</td><td>${esc(event.pageSlug) || "—"}</td><td>${new Date(event.createdAt + "Z").toLocaleString("en-IN")}</td></tr>`).join("")}</tbody></table>` : empty("No Events Yet")}</section>`;
  const fields = (pixel = {}) =>
    `<label class="field">Platform<select name="platform" required><option value="meta" ${pixel.platform === "meta" ? "selected" : ""}>Meta</option><option value="google" ${pixel.platform === "google" ? "selected" : ""}>Google</option><option value="tiktok" ${pixel.platform === "tiktok" ? "selected" : ""}>TikTok</option></select></label><label class="field">Pixel / Tracking ID<input name="trackingId" value="${esc(pixel.trackingId || "")}" required></label><label class="field checkbox"><input type="checkbox" name="enabled" ${pixel.enabled ? "checked" : ""}> <span>Enable Tracking</span></label>`;
  $("#add-pixel").onclick = () =>
    openForm("Add Pixel", fields(), "Add", (values) =>
      api(`/api/stores/${storeId}/pixels`, {
        method: "POST",
        body: JSON.stringify({ ...values, enabled: values.enabled === "on" }),
      }),
    );
  document.querySelectorAll(".save-pixel").forEach(
    (button) =>
      (button.onclick = () => {
        const pixel = configs.find(
          (item) => item.id === Number(button.dataset.id),
        );
        openForm("Save Pixel", fields(pixel), "Save", (values) =>
          api(`/api/stores/${storeId}/pixels/${pixel.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              ...values,
              enabled: values.enabled === "on",
            }),
          }),
        );
      }),
  );
  document.querySelectorAll(".verify-pixel").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/pixels/${button.dataset.id}/verify`,
            { method: "POST", body: "{}" },
          );
          toast("Pixel configuration verified");
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  document.querySelectorAll(".toggle-pixel").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/pixels/${button.dataset.id}/${button.dataset.action}`,
            { method: "POST", body: "{}" },
          );
          toast(
            button.dataset.action === "enable"
              ? "Tracking enabled"
              : "Tracking disabled",
          );
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  document.querySelectorAll(".delete-pixel").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("Delete this pixel?")) return;
        try {
          await api(`/api/stores/${storeId}/pixels/${button.dataset.id}`, {
            method: "DELETE",
          });
          toast("Pixel deleted");
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
}
function pixelsView() {
  const setup = data.pixels || {
      configurations: [],
      events: [],
      mappings: [],
      deliveries: [],
      platforms: [],
    },
    configs = setup.configurations || [],
    mappings = setup.mappings || [],
    deliveries = setup.deliveries || [],
    platforms = setup.platforms || [],
    platformMap = Object.fromEntries(platforms.map((item) => [item.id, item])),
    eventLabels = {
      page_view: "Page View",
      product_view: "Product View",
      product_page_view: "Product View",
      add_to_cart: "Add To Cart",
      checkout_started: "Checkout Started",
      checkout_start: "Checkout Started",
      checkout_progress: "Checkout Progress",
      coupon_applied: "Coupon Applied",
      otp_started: "OTP Started",
      otp_verified: "OTP Verified",
      order_created: "Order Created",
      purchase: "Order Created",
      payment_started: "Payment Started",
      payment_success: "Payment Success",
      payment_failed: "Payment Failed",
    },
    statusLabels = {
      configured: "Configured",
      connected: "Connected",
      no_events_yet: "No Events Yet",
      active: "Active",
      disabled: "Disabled",
      error: "Error",
      success: "Success",
      failed: "Failed",
      queued: "Queued",
      skipped: "Skipped",
      recorded: "Recorded",
    },
    platformName = (id) => platformMap[id]?.name || (id === "custom" ? "Custom" : id),
    dateValue = (value) => {
      if (!value) return null;
      const text = String(value),
        date = new Date(/(?:Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text.replace(" ", "T")}Z`);
      return Number.isNaN(date.getTime()) ? null : date;
    },
    timeLabel = (value) => {
      const date = dateValue(value);
      if (!date) return "—";
      const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
      if (seconds < 10) return "Just now";
      if (seconds < 60) return `${seconds} sec ago`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
      return date.toLocaleString("en-IN");
    },
    pixelTabs = [
      ["connected", "Connected Pixels"],
      ["mapping", "Event Mapping"],
      ["test", "Test Events"],
      ["activity", "Activity"],
    ],
    connectionOptions = (selected) => configs
      .map((pixel) => `<option value="${pixel.id}" ${Number(selected) === pixel.id ? "selected" : ""}>${esc(pixel.name)} · ${esc(platformName(pixel.platform))}</option>`)
      .join(""),
    scopeOptions = (items, selectedIds = []) => items
      .map((item) => `<option value="${item.id}" ${selectedIds.includes(item.id) ? "selected" : ""}>${esc(item.name || item.title)}</option>`)
      .join("");
  if (!pixelMappingConnectionId || !configs.some((item) => item.id === Number(pixelMappingConnectionId)))
    pixelMappingConnectionId = configs[0]?.id || null;
  setPageHeader(
    "Send real commerce events to advertising platforms with browser and server-side delivery.",
    '<button class="primary" id="add-pixel-wizard">+ Add Pixel</button>',
  );
  const nav = `<span class="sr-only">Pixel Name · Custom Pixel · Last Event</span><div class="pixel-tabs" role="tablist" aria-label="Pixel workspace">${pixelTabs
    .map(([id, label]) => `<button type="button" role="tab" aria-selected="${pixelTab === id}" tabindex="${pixelTab === id ? "0" : "-1"}" data-pixel-tab="${id}" class="${pixelTab === id ? "active" : ""}">${label}</button>`)
    .join("")}</div>`;
  const channelState = (enabled) => `<span class="channel-state ${enabled ? "on" : "off"}">${enabled ? "ON" : "OFF"}</span>`;
  const menu = (pixel) => `<details class="row-menu pixel-row-menu"><summary aria-label="Actions for ${esc(pixel.name)}">⋯</summary><div>
    <button type="button" class="pixel-action" data-action="edit" data-id="${pixel.id}">Edit</button>
    <button type="button" class="pixel-action" data-action="test" data-id="${pixel.id}">Test</button>
    <button type="button" class="pixel-action" data-action="events" data-id="${pixel.id}">View Events</button>
    <button type="button" class="pixel-action" data-action="${pixel.enabled ? "disable" : "enable"}" data-id="${pixel.id}">${pixel.enabled ? "Disable" : "Enable"}</button>
    <button type="button" class="pixel-action danger-text" data-action="delete" data-id="${pixel.id}">Delete</button>
  </div></details>`;
  const connectedView = `<section class="panel pixel-panel"><div class="panel-head"><div><h2>Connected Pixels</h2><span>Each connection belongs only to ${esc(data.store.name)}. Server credentials stay encrypted on the backend.</span></div><span class="pill">${configs.length} ${configs.length === 1 ? "connection" : "connections"}</span></div>
    ${configs.length ? `<div class="pixel-table-wrap"><table class="pixel-connections-table"><thead><tr><th>PIXEL NAME</th><th>PLATFORM</th><th>BROWSER</th><th>SERVER</th><th>STATUS</th><th>LAST EVENT</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${configs.map((pixel) => `<tr>
      <td><strong>${esc(pixel.name)}</strong><small>${esc(pixel.trackingId)}</small></td>
      <td>${esc(platformName(pixel.platform))}</td><td>${channelState(pixel.browserEnabled)}</td><td>${channelState(pixel.serverEnabled)}</td>
      <td><span class="pill pixel-status-${esc(pixel.displayStatus)}">${esc(statusLabels[pixel.displayStatus] || pixel.displayStatus)}</span>${pixel.lastError ? `<small class="pixel-error">${esc(pixel.lastError)}</small>` : ""}</td>
      <td>${pixel.lastInternalEvent ? `<strong>${esc(eventLabels[pixel.lastInternalEvent] || pixel.lastInternalEvent)}</strong><small>${esc(timeLabel(pixel.lastEventAt))}</small>` : "No Event Yet"}</td>
      <td class="row-menu-cell">${menu(pixel)}</td></tr>`).join("")}</tbody></table></div>
      <div class="pixel-mobile-list">${configs.map((pixel) => `<article class="pixel-mobile-card"><header><div><strong>${esc(pixel.name)}</strong><small>${esc(platformName(pixel.platform))} · ${esc(pixel.trackingId)}</small></div>${menu(pixel)}</header><div class="pixel-card-status"><span class="pill pixel-status-${esc(pixel.displayStatus)}">${esc(statusLabels[pixel.displayStatus] || pixel.displayStatus)}</span><span>Browser ${channelState(pixel.browserEnabled)}</span><span>Server ${channelState(pixel.serverEnabled)}</span></div><p>${pixel.lastInternalEvent ? `${esc(eventLabels[pixel.lastInternalEvent] || pixel.lastInternalEvent)} · ${esc(timeLabel(pixel.lastEventAt))}` : "No Event Yet"}</p>${pixel.lastError ? `<p class="pixel-error">${esc(pixel.lastError)}</p>` : ""}</article>`).join("")}</div>`
      : `<div class="pixel-empty"><span>◎</span><h3>No pixels connected</h3><p>Add a provider, test the connection, then enable real event delivery.</p><button class="primary" type="button" id="empty-add-pixel">+ Add Pixel</button></div>`}
    <div class="pixel-architecture-note"><strong>One internal event pipeline</strong><span>Product Page → Add To Cart → Checkout → OTP → Valid Order → connected providers</span></div>
  </section>`;
  const selectedMappings = mappings.filter((item) => item.pixelConnectionId === Number(pixelMappingConnectionId)),
    mappingView = `<section class="panel pixel-panel"><div class="panel-head"><div><h2>Event Mapping</h2><span>Standard commerce events are enabled by default. Checkout micro-events stay internal unless you enable them.</span></div></div>
      ${configs.length ? `<label class="field pixel-connection-picker">Connection<select id="mapping-connection">${connectionOptions(pixelMappingConnectionId)}</select></label>
      <form id="pixel-mapping-form"><div class="pixel-table-wrap"><table class="pixel-mapping-table"><thead><tr><th>INTERNAL EVENT</th><th>EXTERNAL EVENT</th><th>ENABLED</th></tr></thead><tbody>${selectedMappings.map((mapping) => `<tr data-internal-event="${esc(mapping.internalEvent)}"><td><strong>${esc(eventLabels[mapping.internalEvent] || mapping.internalEvent)}</strong><small>${esc(mapping.internalEvent)}</small></td><td><input aria-label="External event name for ${esc(eventLabels[mapping.internalEvent] || mapping.internalEvent)}" name="provider-${esc(mapping.internalEvent)}" value="${esc(mapping.providerEventName)}" required></td><td><label class="switch"><input aria-label="Enable mapping for ${esc(eventLabels[mapping.internalEvent] || mapping.internalEvent)}" name="enabled-${esc(mapping.internalEvent)}" type="checkbox" ${mapping.enabled ? "checked" : ""}><span></span></label></td></tr>`).join("")}</tbody></table></div><div class="form-actions"><button class="primary">Save Mapping</button></div></form>` : `<div class="pixel-empty"><h3>Add a pixel first</h3><p>Mappings are created automatically for each connection.</p></div>`}
    </section>`;
  const selectedTestDeliveries = deliveries.filter((item) => !pixelMappingConnectionId || item.pixelConnectionId === Number(pixelMappingConnectionId)),
    coreEvents = ["page_view", "product_view", "add_to_cart", "checkout_started", "order_created"],
    testView = `<section class="panel pixel-panel"><div class="panel-head"><div><h2>Test Events</h2><span>Open a published product page and follow the customer journey. Received events update in this log.</span></div>${configs.length ? `<button class="secondary" type="button" id="test-selected-pixel">Test Connection</button>` : ""}</div>
      ${configs.length ? `<label class="field pixel-connection-picker">Connection<select id="test-connection">${connectionOptions(pixelMappingConnectionId)}</select></label>
      <div class="pixel-test-grid">${coreEvents.map((eventName) => {
        const received = selectedTestDeliveries.find((item) => item.eventName === eventName && item.status === "success");
        return `<article><span class="test-event-state ${received ? "received" : "waiting"}">${received ? "✓" : "○"}</span><strong>${esc(eventLabels[eventName])}</strong><small>${received ? `${esc(received.channel)} · ${esc(timeLabel(received.eventCreatedAt || received.createdAt))}` : "Not received yet"}</small></article>`;
      }).join("")}</div>
      <div class="pixel-test-log">${selectedTestDeliveries.length ? selectedTestDeliveries.slice(0, 30).map((item) => `<div><span class="delivery-dot ${esc(item.status)}"></span><strong>${esc(eventLabels[item.eventName] || item.eventName)}</strong><span>${esc(item.channel)}</span><span>${esc(statusLabels[item.status] || item.status)}</span><time>${esc(timeLabel(item.eventCreatedAt || item.createdAt))}</time></div>`).join("") : `<p class="muted">Waiting for events...</p>`}</div>` : `<div class="pixel-empty"><h3>No connection to test</h3><p>Add a pixel before opening Test Events.</p></div>`}
    </section>`;
  const activityView = `<section class="panel pixel-panel"><div class="panel-head"><div><h2>Event Activity</h2><span>Browser and server deliveries, including privacy skips and provider errors.</span></div></div>
      <div class="pixel-filters"><label>Event<select id="pixel-event-filter"><option value="all">All events</option>${Object.entries(eventLabels).filter(([key]) => !["product_page_view", "checkout_start", "purchase"].includes(key)).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join("")}</select></label><label>Source<select id="pixel-source-filter"><option value="all">Browser + Server</option><option value="browser">Browser</option><option value="server">Server</option></select></label><label>Status<select id="pixel-status-filter"><option value="all">All statuses</option><option value="success">Success</option><option value="failed">Failed</option><option value="skipped">Skipped</option><option value="queued">Queued</option></select></label></div>
      <div id="pixel-activity-list" class="pixel-activity-list">${deliveries.length ? deliveries.map((item) => `<article data-event="${esc(item.eventName)}" data-source="${esc(item.channel)}" data-status="${esc(item.status)}"><span class="delivery-dot ${esc(item.status)}"></span><div><strong>${esc(eventLabels[item.eventName] || item.eventName)}</strong><small>${esc(item.connectionName)} · ${esc(platformName(item.platform))} · ${esc(item.providerEventName)}</small>${item.error ? `<p class="pixel-error">${esc(item.error)}</p>` : ""}</div><div class="delivery-meta"><span>${esc(item.channel)}</span><span class="pill">${esc(statusLabels[item.status] || item.status)}</span><time>${esc(timeLabel(item.eventCreatedAt || item.createdAt))}</time>${item.status === "failed" && item.channel === "server" ? `<button class="secondary retry-pixel-delivery" type="button" data-id="${item.id}">Retry</button>` : ""}</div></article>`).join("") : `<div class="pixel-empty"><h3>No event activity yet</h3><p>Events will appear after a customer opens a published product page.</p></div>`}</div>
    </section>`;
  content.innerHTML = `${nav}${pixelTab === "connected" ? connectedView : pixelTab === "mapping" ? mappingView : pixelTab === "test" ? testView : activityView}`;

  const credentialFields = (definition, pixel = null) => (definition.credentials || [])
    .map((field) => `<label class="field pixel-server-field">${esc(field.label)}${field.requiredForServer ? " *" : ""}<input name="credential-${esc(field.key)}" type="${field.secret ? "password" : "text"}" placeholder="${pixel?.configuredCredentials?.includes(field.key) ? "Saved — leave blank to keep" : ""}" autocomplete="off"></label>`)
    .join("");
  const scopeFields = (pixel = null) => `<label class="field">Pixel Scope<select name="scopeType"><option value="entire_store" ${pixel?.scopeType === "entire_store" || !pixel ? "selected" : ""}>Entire Store</option><option value="all_product_pages" ${pixel?.scopeType === "all_product_pages" ? "selected" : ""}>All Product Pages</option><option value="specific_products" ${pixel?.scopeType === "specific_products" ? "selected" : ""}>Specific Products</option><option value="specific_product_pages" ${pixel?.scopeType === "specific_product_pages" ? "selected" : ""}>Specific Product Pages</option></select></label><label class="field">Products for scoped tracking<select name="productScopeIds" multiple>${scopeOptions(data.products, pixel?.scopeType === "specific_products" ? pixel.scopeIds : [])}</select><small>Used only when scope is Specific Products.</small></label><label class="field">Product pages for scoped tracking<select name="pageScopeIds" multiple>${scopeOptions(data.pages, pixel?.scopeType === "specific_product_pages" ? pixel.scopeIds : [])}</select><small>Used only when scope is Specific Product Pages.</small></label>`;
  const payloadFromForm = (form, definition, platform) => {
    const values = Object.fromEntries(new FormData(form)),
      scopeType = values.scopeType || "entire_store",
      selectName = scopeType === "specific_products" ? "productScopeIds" : "pageScopeIds",
      scopeSelect = form.elements[selectName],
      credentials = {};
    for (const field of definition.credentials || []) {
      const value = form.elements[`credential-${field.key}`]?.value?.trim();
      if (value) credentials[field.key] = value;
    }
    return {
      name: values.name,
      platform,
      trackingId: values.trackingId,
      browserEnabled: Boolean(form.elements.browserEnabled?.checked),
      serverEnabled: Boolean(form.elements.serverEnabled?.checked),
      enabled: Boolean(form.elements.enabled?.checked),
      scopeType,
      scopeIds: scopeSelect ? [...scopeSelect.selectedOptions].map((option) => Number(option.value)) : [],
      credentials,
    };
  };
  function openPixelWizard() {
    let selectedPlatform = null,
      draft = null;
    const renderChoose = () => {
      modalContent.innerHTML = `<div class="pixel-wizard-head"><span>Step 1 of 3</span><h2>Add Pixel</h2><p>Choose Platform</p></div><div class="pixel-platform-grid">${platforms.map((item) => `<button type="button" data-platform="${esc(item.id)}"><strong>${esc(item.name)}</strong><small>${item.browserSupported ? "Browser" : ""}${item.serverSupported ? `${item.browserSupported ? " + " : ""}Server` : ""}</small></button>`).join("")}</div>`;
      modalContent.querySelectorAll("[data-platform]").forEach((button) => button.onclick = () => {
        selectedPlatform = button.dataset.platform;
        renderCredentials();
      });
    };
    const renderCredentials = () => {
      const definition = platformMap[selectedPlatform];
      modalContent.innerHTML = `<div class="pixel-wizard-head"><span>Step 2 of 3</span><h2>${esc(definition.name)} credentials</h2><p>Enter the public ID and choose delivery channels.</p></div><label class="field">Connection Name<input name="name" placeholder="Main Advertising Pixel" required></label><label class="field">${esc(definition.idLabel)}<input name="trackingId" required></label><div class="pixel-channel-options"><label><input type="checkbox" name="browserEnabled" ${definition.browserSupported ? "checked" : "disabled"}><span><strong>Browser Tracking</strong><small>Product page and checkout browser events</small></span></label><label><input type="checkbox" name="serverEnabled" ${definition.serverSupported ? "" : "disabled"}><span><strong>Server-Side Tracking</strong><small>${definition.serverSupported ? "Reliable backend events and order creation" : "Not available for this provider"}</small></span></label></div>${credentialFields(definition)}${scopeFields()}<label class="field checkbox"><input name="enabled" type="checkbox" checked><span>Enable Tracking after the connection test passes</span></label><div class="wizard-actions"><button class="secondary" type="button" id="pixel-wizard-back">Back</button><button class="primary" type="button" id="pixel-wizard-next">Continue</button></div>`;
      const form = $("#modal-form");
      $("#pixel-wizard-back").onclick = renderChoose;
      $("#pixel-wizard-next").onclick = () => {
        if (!form.reportValidity()) return;
        draft = payloadFromForm(form, definition, selectedPlatform);
        if (!draft.browserEnabled && !draft.serverEnabled) return toast("Enable Browser Tracking, Server-Side Tracking, or both");
        renderTest();
      };
    };
    const renderTest = () => {
      const definition = platformMap[selectedPlatform];
      modalContent.innerHTML = `<div class="pixel-wizard-head"><span>Step 3 of 3</span><h2>Test Connection</h2><p>Commera2 will validate this ${esc(definition.name)} connection before enabling it.</p></div><div class="pixel-test-summary"><strong>${esc(draft.name)}</strong><span>${esc(definition.name)} · ${esc(draft.trackingId)}</span><span>Browser ${draft.browserEnabled ? "ON" : "OFF"} · Server ${draft.serverEnabled ? "ON" : "OFF"}</span></div><p class="notice" id="pixel-wizard-status">Ready to test. No server secret will be sent to the storefront.</p><div class="wizard-actions"><button class="secondary" type="button" id="pixel-wizard-back">Back</button><button class="primary" type="button" id="pixel-wizard-connect">Test & Connect</button></div>`;
      $("#pixel-wizard-back").onclick = renderCredentials;
      $("#pixel-wizard-connect").onclick = async () => {
        const button = $("#pixel-wizard-connect"),
          status = $("#pixel-wizard-status");
        button.disabled = true;
        status.textContent = "Testing connection…";
        let connection;
        try {
          connection = await api(`/api/stores/${storeId}/pixels`, {
            method: "POST",
            body: JSON.stringify({ ...draft, enabled: false }),
          });
          await api(`/api/stores/${storeId}/pixels/${connection.id}/verify`, { method: "POST", body: "{}" });
          if (draft.enabled)
            await api(`/api/stores/${storeId}/pixels/${connection.id}/enable`, { method: "POST", body: "{}" });
          modal.close();
          toast("Pixel connected");
          await load();
        } catch (error) {
          status.textContent = connection ? `Saved with error: ${error.message}` : error.message;
          if (connection) {
            modal.close();
            toast("Connection saved with an error — open Edit or Test");
            await load();
          } else button.disabled = false;
        }
      };
    };
    renderChoose();
    modal.showModal();
  }
  function openPixelEdit(pixel) {
    const definition = platformMap[pixel.platform];
    openForm(
      "Edit Pixel",
      `<input type="hidden" name="platform" value="${esc(pixel.platform)}"><label class="field">Connection Name<input name="name" value="${esc(pixel.name)}" required></label><label class="field">Platform<input value="${esc(definition?.name || pixel.platform)}" disabled></label><label class="field">${esc(definition?.idLabel || "Pixel / Tracking ID")}<input name="trackingId" value="${esc(pixel.trackingId)}" required></label><div class="pixel-channel-options"><label><input type="checkbox" name="browserEnabled" ${pixel.browserEnabled ? "checked" : ""}><span><strong>Browser Tracking</strong></span></label><label><input type="checkbox" name="serverEnabled" ${pixel.serverEnabled ? "checked" : ""} ${definition?.serverSupported ? "" : "disabled"}><span><strong>Server-Side Tracking</strong></span></label></div>${credentialFields(definition || { credentials: [] }, pixel)}${scopeFields(pixel)}<label class="field checkbox"><input name="enabled" type="checkbox" ${pixel.enabled ? "checked" : ""}><span>Enable Tracking</span></label><p class="notice">Changing credentials, channels, ID, or scope requires another Test / Verify.</p>`,
      "Save",
      () => api(`/api/stores/${storeId}/pixels/${pixel.id}`, {
        method: "PATCH",
        body: JSON.stringify(payloadFromForm($("#modal-form"), definition || { credentials: [] }, pixel.platform)),
      }),
    );
  }
  $("#add-pixel-wizard").onclick = openPixelWizard;
  if ($("#empty-add-pixel")) $("#empty-add-pixel").onclick = openPixelWizard;
  document.querySelectorAll("[data-pixel-tab]").forEach((button) => button.onclick = () => {
    pixelTab = button.dataset.pixelTab;
    settingsView();
  });
  document.querySelectorAll(".pixel-action").forEach((button) => button.onclick = async () => {
    const pixel = configs.find((item) => item.id === Number(button.dataset.id)),
      action = button.dataset.action;
    if (!pixel) return;
    if (action === "edit") return openPixelEdit(pixel);
    if (action === "events") {
      pixelMappingConnectionId = pixel.id;
      pixelTab = "test";
      return settingsView();
    }
    if (action === "delete" && !confirm(`Delete ${pixel.name}? Its event history will also be removed.`)) return;
    try {
      if (action === "test") {
        const result = await api(`/api/stores/${storeId}/pixels/${pixel.id}/verify`, { method: "POST", body: "{}" });
        const received = Object.values(result.testResult.events).filter((value) => value === "received").length;
        toast(`Connection verified · ${received} event types received`);
      } else if (["enable", "disable"].includes(action))
        await api(`/api/stores/${storeId}/pixels/${pixel.id}/${action}`, { method: "POST", body: "{}" });
      else if (action === "delete")
        await api(`/api/stores/${storeId}/pixels/${pixel.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      toast(error.message);
      await load();
    }
  });
  if ($("#mapping-connection")) $("#mapping-connection").onchange = (event) => {
    pixelMappingConnectionId = Number(event.target.value);
    settingsView();
  };
  if ($("#pixel-mapping-form")) $("#pixel-mapping-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      values = [...form.querySelectorAll("[data-internal-event]")].map((row) => {
        const internalEvent = row.dataset.internalEvent;
        return {
          internalEvent,
          providerEventName: form.elements[`provider-${internalEvent}`].value,
          enabled: form.elements[`enabled-${internalEvent}`].checked,
        };
      });
    try {
      await api(`/api/stores/${storeId}/pixels/${pixelMappingConnectionId}/mappings`, {
        method: "PATCH",
        body: JSON.stringify({ mappings: values }),
      });
      toast("Event mapping saved");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  if ($("#test-connection")) $("#test-connection").onchange = (event) => {
    pixelMappingConnectionId = Number(event.target.value);
    settingsView();
  };
  if ($("#test-selected-pixel")) $("#test-selected-pixel").onclick = async () => {
    try {
      await api(`/api/stores/${storeId}/pixels/${pixelMappingConnectionId}/verify`, { method: "POST", body: "{}" });
      toast("Connection test passed");
      await load();
    } catch (error) {
      toast(error.message);
      await load();
    }
  };
  const filterActivity = () => {
    const eventName = $("#pixel-event-filter")?.value || "all",
      source = $("#pixel-source-filter")?.value || "all",
      status = $("#pixel-status-filter")?.value || "all";
    document.querySelectorAll("#pixel-activity-list article").forEach((row) => {
      row.hidden = !(
        (eventName === "all" || row.dataset.event === eventName) &&
        (source === "all" || row.dataset.source === source) &&
        (status === "all" || row.dataset.status === status)
      );
    });
  };
  ["#pixel-event-filter", "#pixel-source-filter", "#pixel-status-filter"].forEach((selector) => {
    if ($(selector)) $(selector).onchange = filterActivity;
  });
  document.querySelectorAll(".retry-pixel-delivery").forEach((button) => button.onclick = async () => {
    button.disabled = true;
    try {
      await api(`/api/stores/${storeId}/pixel-deliveries/${button.dataset.id}/retry`, { method: "POST", body: "{}" });
      toast("Delivery retried successfully");
      await load();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      await load();
    }
  });
}
function privacySettingsView() {
  const cfg = data.settings.privacy,
    toggle = (name, label, value) =>
      `<label class="field checkbox privacy-toggle"><span>${label}</span><input name="${name}" type="checkbox" ${value ? "checked" : ""}></label>`;
  content.innerHTML = `<form id="privacy-settings"><section class="panel"><div class="panel-head"><div><h2>Cookie Banner</h2><span>Consent changes tracking behavior on real published pages.</span></div><span class="pill">${cfg.cookieBannerEnabled ? "Enabled" : "Disabled"}</span></div>${toggle("cookieBannerEnabled", "Enable Cookie Banner", cfg.cookieBannerEnabled)}<label class="field">Banner Message<input name="bannerMessage" value="${esc(cfg.bannerMessage)}"></label><label class="field">Accept Button Text<input name="acceptButtonText" value="${esc(cfg.acceptButtonText)}"></label><label class="field">Reject Button Text<input name="rejectButtonText" value="${esc(cfg.rejectButtonText)}"></label><label class="field">Privacy Policy Link<input name="privacyPolicyLink" value="${esc(cfg.privacyPolicyLink)}"></label><button class="primary">Save</button> <button class="secondary" type="button" id="preview-banner">Preview Banner</button></section><section class="panel"><h2>Tracking Consent</h2>${toggle("analyticsTracking", "Analytics Tracking", cfg.analyticsTracking)}${toggle("marketingTracking", "Marketing Tracking", cfg.marketingTracking)}${toggle("advertisingPixels", "Advertising Pixels", cfg.advertisingPixels)}${toggle("requireAnalyticsConsent", "Require Analytics Consent", cfg.requireAnalyticsConsent)}${toggle("requireMarketingConsent", "Require Marketing Consent", cfg.requireMarketingConsent)}</section><section class="panel"><h2>Customer Data Settings</h2>${toggle("allowCustomerDataCollection", "Allow Customer Data Collection", cfg.allowCustomerDataCollection)}${toggle("allowAbandonedCheckoutData", "Allow Abandoned Checkout Data", cfg.allowAbandonedCheckoutData)}${toggle("allowVisitorTracking", "Allow Visitor Tracking", cfg.allowVisitorTracking)}<label class="field">Live visitor inactivity timeout (minutes)<input name="visitorSessionTimeoutMinutes" type="number" min="1" max="60" value="${Number(cfg.visitorSessionTimeoutMinutes || 5)}" required></label>${toggle("allowPixelTracking", "Allow Pixel Tracking", cfg.allowPixelTracking)}<p class="notice">Live visitor sessions, pixel privacy, and abandoned checkout privacy are enforced by their APIs.</p></section></form>`;
  const form = $("#privacy-settings");
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const payload = {};
      for (const name of [
        "cookieBannerEnabled",
        "analyticsTracking",
        "marketingTracking",
        "advertisingPixels",
        "requireAnalyticsConsent",
        "requireMarketingConsent",
        "allowCustomerDataCollection",
        "allowAbandonedCheckoutData",
        "allowVisitorTracking",
        "allowPixelTracking",
      ])
        payload[name] = form.elements[name].checked;
      for (const name of [
        "bannerMessage",
        "acceptButtonText",
        "rejectButtonText",
        "privacyPolicyLink",
      ])
        payload[name] = form.elements[name].value;
      payload.visitorSessionTimeoutMinutes = Number(
        form.elements.visitorSessionTimeoutMinutes.value,
      );
      await api(`/api/stores/${storeId}/settings/privacy`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast("Customer Privacy settings saved");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  $("#preview-banner").onclick = () => {
    const page = data.pages[0];
    if (page) open(`/api/stores/${storeId}/pages/${page.id}/preview`, "_blank");
  };
}
function customersView() {
  setPageHeader(
    "Customers are created and updated automatically from completed orders.",
  );
  const customerRows = data.customers
      .map(
        (customer) =>
          `<tr class="customer-row" role="button" tabindex="0" aria-label="View customer ${esc(customer.name)}" data-customer-id="${customer.id}" data-search="${esc(`${customer.name} ${customer.phone} ${customer.city} ${customer.state}`.toLowerCase())}"><td><strong>${esc(customer.name)}</strong><small>${esc(customer.email) || "No email"}</small></td><td>${esc(customer.phone)}</td><td>${esc([customer.city, customer.state].filter(Boolean).join(", ")) || "—"}</td><td>${customer.orderCount}</td><td><strong>${rupees(customer.totalSpentPaise)}</strong></td><td>${new Date(customer.updatedAt + "Z").toLocaleDateString("en-IN")}</td></tr>`,
      )
      .join(""),
    customerCards = data.customers
      .map(
        (customer) =>
          `<article class="data-mobile-card customer-mobile-card customer-row" role="button" tabindex="0" aria-label="View customer ${esc(customer.name)}" data-customer-id="${customer.id}" data-search="${esc(`${customer.name} ${customer.phone} ${customer.city} ${customer.state}`.toLowerCase())}"><header><div><small>Customer</small><strong>${esc(customer.name)}</strong><span>${esc(customer.email) || "No email"}</span></div><strong>${rupees(customer.totalSpentPaise)}</strong></header><dl><div><dt>Phone</dt><dd>${esc(customer.phone)}</dd></div><div><dt>Orders</dt><dd>${customer.orderCount}</dd></div><div class="mobile-card-wide"><dt>Location</dt><dd>${esc([customer.city, customer.state].filter(Boolean).join(", ")) || "—"}</dd></div><div class="mobile-card-wide"><dt>Updated</dt><dd>${new Date(customer.updatedAt + "Z").toLocaleDateString("en-IN")}</dd></div></dl><footer><span>View customer</span><b aria-hidden="true">→</b></footer></article>`,
      )
      .join("");
  content.innerHTML = `<section class="panel list-panel"><div class="table-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="customer-search" type="search" aria-label="Search customers" placeholder="Search customers..." value="${esc(customerSearch)}"></label></div>${data.customers.length ? `<div class="table-scroll data-desktop-list"><table class="merchant-table"><thead><tr><th>CUSTOMER</th><th>PHONE</th><th>LOCATION</th><th>ORDERS</th><th>TOTAL SPENT</th><th>UPDATED</th></tr></thead><tbody>${customerRows}</tbody></table></div><div class="data-mobile-list" aria-label="Customers">${customerCards}</div>` : empty("No customers yet.")}</section>`;
  const openCustomer = async (id) => {
    try {
      modalContent.innerHTML = `<div class="detail-modal app-loading"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line"></div></div>`;
      $("#modal-form").onsubmit = (event) => event.preventDefault();
      modal.showModal();
      const customer = await api(
        `/api/stores/${storeId}/customers/${Number(id)}`,
      );
      modalContent.innerHTML = `<div class="detail-modal customer-detail"><h2>${esc(customer.name)}</h2><h3>Contact details</h3><div class="detail-grid"><div><small>Primary phone</small><strong>${esc(customer.phone)}</strong></div><div><small>Alternate phone</small><strong>${esc(customer.alternatePhone) || "—"}</strong></div><div><small>Email</small><strong>${esc(customer.email) || "—"}</strong></div><div><small>Pincode</small><strong>${esc(customer.pincode) || "—"}</strong></div></div><h3>Address</h3><div class="detail-address"><p>${esc(customer.address) || "—"}<br>${esc([customer.addressLine2, customer.landmark].filter(Boolean).join(", "))}<br>${esc([customer.city, customer.state, customer.country].filter(Boolean).join(", "))}</p></div><h3>COD history</h3><div class="detail-grid"><div><small>Orders</small><strong>${customer.codHistory.orders}</strong></div><div><small>Total spent</small><strong>${rupees(customer.codHistory.totalSpentPaise)}</strong></div><div><small>Delivered</small><strong>${customer.codHistory.delivered}</strong></div><div><small>Cancelled</small><strong>${customer.codHistory.cancelled}</strong></div></div><h3>Orders</h3>${customer.orders.length ? `<div class="customer-history-list">${customer.orders.map((order) => `<button type="button" data-customer-order="${order.id}"><span><strong>${esc(order.orderNumber)}</strong><small>${new Date(order.createdAt + "Z").toLocaleDateString("en-IN")}</small></span><span>${rupees(order.totalPaise)} · ${esc(order.deliveryStatus.replaceAll("_", " "))}</span></button>`).join("")}</div>` : empty("No completed orders.")}<h3>Checkout history</h3>${customer.checkouts.length ? `<div class="customer-history-list">${customer.checkouts.map((checkout) => `<div><span><strong>${esc(checkout.productName)}</strong><small>${esc(checkout.pageName)}</small></span><span>${esc(checkout.status)} · ${esc(checkout.currentStage.replaceAll("_", " "))}</span></div>`).join("")}</div>` : empty("No checkout history.")}</div>`;
      document.querySelectorAll("[data-customer-order]").forEach(
        (button) =>
          (button.onclick = () => {
            modal.close();
            navigateTo(`/orders/${button.dataset.customerOrder}`);
          }),
      );
    } catch (error) {
      modal.close();
      toast(error.message);
    }
  };
  document.querySelectorAll(".customer-row").forEach((row) => {
    row.onclick = () => openCustomer(row.dataset.customerId);
    row.onkeydown = (event) => {
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        openCustomer(row.dataset.customerId);
      }
    };
  });
  $("#customer-search").oninput = (event) => {
    customerSearch = event.target.value.trim().toLowerCase();
    document.querySelectorAll(".customer-row").forEach((row) => {
      row.hidden =
        customerSearch && !row.dataset.search.includes(customerSearch);
    });
  };
}
function abandonedView() {
  setPageHeader(
    "Progressively saved checkout drafts that have not become orders.",
  );
  const abandonedRows = data.abandoned
      .map(
        (checkout) =>
          `<tr><td><strong>${esc(checkout.name) || "Unknown customer"}</strong><small>${esc(checkout.phone) || "No phone yet"}</small></td><td><strong>${esc(checkout.productName)}</strong><small>${esc(checkout.bundleName) || "Standard product"}</small></td><td>${rupees(checkout.checkoutValuePaise)}</td><td>${esc((checkout.currentStage || "opened").replaceAll("_", " "))}</td><td><span class="status-badge ${checkout.phoneVerificationStatus === "VERIFIED" ? "is-active" : "is-draft"}">${esc((checkout.phoneVerificationStatus || "NOT_REQUIRED").replaceAll("_", " "))}</span></td><td>${new Date(checkout.updatedAt + "Z").toLocaleString("en-IN")}</td></tr>`,
      )
      .join(""),
    abandonedCards = data.abandoned
      .map(
        (checkout) =>
          `<article class="data-mobile-card abandoned-mobile-card"><header><div><small>Customer</small><strong>${esc(checkout.name) || "Unknown customer"}</strong><span>${esc(checkout.phone) || "No phone yet"}</span></div><span class="status-badge ${checkout.phoneVerificationStatus === "VERIFIED" ? "is-active" : "is-draft"}">${esc((checkout.phoneVerificationStatus || "NOT_REQUIRED").replaceAll("_", " "))}</span></header><div class="mobile-card-product"><small>Product</small><strong>${esc(checkout.productName)}</strong><span>${esc(checkout.bundleName) || "Standard product"}</span></div><dl><div><dt>Value</dt><dd>${rupees(checkout.checkoutValuePaise)}</dd></div><div><dt>Quantity</dt><dd>${checkout.quantity}</dd></div><div class="mobile-card-wide"><dt>Checkout progress</dt><dd class="mobile-card-readable">${esc((checkout.currentStage || "opened").replaceAll("_", " "))}</dd></div><div class="mobile-card-wide"><dt>Last activity</dt><dd>${new Date(checkout.updatedAt + "Z").toLocaleString("en-IN")}</dd></div></dl></article>`,
      )
      .join("");
  content.innerHTML = `<section class="panel list-panel">${data.abandoned.length ? `<div class="table-scroll data-desktop-list"><table class="merchant-table"><thead><tr><th>CUSTOMER</th><th>PRODUCT</th><th>VALUE</th><th>CHECKOUT PROGRESS</th><th>OTP STATUS</th><th>LAST ACTIVITY</th></tr></thead><tbody>${abandonedRows}</tbody></table></div><div class="data-mobile-list" aria-label="Abandoned checkouts">${abandonedCards}</div>` : empty("No abandoned checkouts have reached the inactivity timeout yet.")}</section>`;
}
function liveVisitorsView(visitorData = data.liveVisitors) {
  const focusedFilter = document.activeElement?.dataset?.liveFilter;
  const focusedSession = document.activeElement?.dataset?.sessionId;
  const focusedRefresh = document.activeElement?.id === 'refresh-live-visitors';
  content.classList.add('live-visitors-workspace');
  const setup = visitorData || {
      count: 0,
      counts: { all: 0, viewingProduct: 0, addToCart: 0, checkout: 0 },
      visitors: [],
      timeoutMinutes: 5,
    },
    statusLabels = {
      viewing_product: "Product View",
      add_to_cart: "Add To Cart",
      checkout: "Checkout",
    },
    filters = [
      ["all", "All", setup.counts.all],
      ["viewing_product", "Product Viewers", setup.counts.viewingProduct],
      ["add_to_cart", "Add To Cart", setup.counts.addToCart],
      ["checkout", "Checkout", setup.counts.checkout],
    ],
    visible = setup.visitors.filter(
      (item) => liveVisitorFilter === "all" || item.status === liveVisitorFilter,
    ),
    eventTime = (value) => {
      const raw = String(value || ""),
        parsed = new Date(
          /(?:Z|[+-]\d\d:?\d\d)$/.test(raw)
            ? raw
            : `${raw.replace(" ", "T")}Z`,
        ),
        seconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
      if (!Number.isFinite(seconds)) return "—";
      if (seconds < 5) return "Just now";
      if (seconds < 60) return `${seconds} sec ago`;
      const minutes = Math.floor(seconds / 60);
      return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} hr ago`;
    },
    visitorRows = visible
      .map(
        (visitor) =>
          `<tr class="live-visitor-row" role="button" tabindex="0" data-session-id="${esc(visitor.sessionId)}" aria-label="Open visitor ${esc(visitor.sessionId.slice(-6))}"><td><strong>#${esc(visitor.sessionId.slice(-6).toUpperCase())}</strong><small>${visitor.abandoned ? "Checkout draft linked" : "Anonymous session"}</small></td><td><span class="activity-pill activity-${esc(visitor.status)}">${statusLabels[visitor.status] || esc(visitor.status)}</span>${visitor.checkoutProgress ? `<small>${esc(visitor.checkoutProgress.replaceAll("_", " "))}</small>` : ""}</td><td><strong>${esc(visitor.productName)}</strong><small>${esc(visitor.pageName)}</small></td><td>${esc(visitor.deviceType || "Unknown")}</td><td>${visitor.status === "add_to_cart" || visitor.status === "checkout" ? `<strong>${visitor.quantity} × · ${rupees(visitor.cartValuePaise)}</strong><small>${esc(visitor.bundleName) || "Standard product"}</small>` : `<span class="muted">Viewing ${esc(visitor.pageSlug)}</span>`}</td><td><strong>${eventTime(visitor.lastActivityAt)}</strong></td></tr>`,
      )
      .join(""),
    visitorCards = visible
      .map(
        (visitor) =>
          `<article class="data-mobile-card live-visitor-mobile-card live-visitor-row" role="button" tabindex="0" data-session-id="${esc(visitor.sessionId)}" aria-label="Open visitor ${esc(visitor.sessionId.slice(-6))}"><header><div><small>Visitor</small><strong>#${esc(visitor.sessionId.slice(-6).toUpperCase())}</strong><span>${visitor.abandoned ? "Checkout draft linked" : "Anonymous session"}</span></div><span class="activity-pill activity-${esc(visitor.status)}">${statusLabels[visitor.status] || esc(visitor.status)}</span></header><div class="mobile-card-product"><small>Product</small><strong>${esc(visitor.productName)}</strong><span>${esc(visitor.pageName)}</span></div><dl><div><dt>Device</dt><dd>${esc(visitor.deviceType || "Unknown")}</dd></div>${visitor.status === "add_to_cart" || visitor.status === "checkout" ? `<div><dt>Quantity</dt><dd>${visitor.quantity}</dd></div><div><dt>Cart value</dt><dd><strong>${rupees(visitor.cartValuePaise)}</strong></dd></div><div class="mobile-card-wide"><dt>Bundle</dt><dd>${esc(visitor.bundleName) || "Standard product"}</dd></div>` : `<div class="mobile-card-wide"><dt>Page</dt><dd>${esc(visitor.pageSlug) || "—"}</dd></div>`}${visitor.checkoutProgress ? `<div class="mobile-card-wide"><dt>Checkout progress</dt><dd class="mobile-card-readable">${esc(visitor.checkoutProgress.replaceAll("_", " "))}</dd></div>` : ""}<div class="mobile-card-wide"><dt>Last active</dt><dd><strong>${eventTime(visitor.lastActivityAt)}</strong></dd></div></dl><footer><span>View customer movement</span><b aria-hidden="true">→</b></footer></article>`,
      )
      .join("");
  setPageHeader(
    "See where shoppers are right now, from their first product view to checkout.",
    `<span class="live-count"><i></i>${setup.count} Live</span>`,
  );
  const trackingEnabled = data.settings.privacy.allowVisitorTracking && data.settings.privacy.analyticsTracking !== false;
  const emptyTitle = !trackingEnabled ? 'Visitor tracking is paused' : liveVisitorFilter === 'all' ? 'Ready for your next visitor' : `No ${liveVisitorFilter === 'checkout' ? 'shoppers at checkout' : liveVisitorFilter === 'add_to_cart' ? 'shoppers with a cart' : 'product viewers'} right now`;
  const emptyCopy = !trackingEnabled ? 'Your privacy settings currently prevent visitor tracking. You can review them in Customer Privacy.' : liveVisitorFilter === 'all' ? 'When someone browses your products, their activity will appear here automatically. No refresh needed.' : 'This view updates automatically. Choose All to see shoppers at other stages.';
  content.innerHTML = `<div class="live-visitor-tabs" role="tablist" aria-label="Live visitor activity">${filters
    .map(
      ([id, label, count]) =>
        `<button type="button" role="tab" aria-selected="${liveVisitorFilter === id}" tabindex="${liveVisitorFilter === id ? "0" : "-1"}" data-live-filter="${id}" class="${liveVisitorFilter === id ? "active" : ""}"><small>${label}</small><span class="live-metric-value">${count}</span><em>${id === 'all' ? 'Active in your store' : id === 'viewing_product' ? 'Exploring products' : id === 'add_to_cart' ? 'Considering a purchase' : 'Completing an order'}</em></button>`,
    )
    .join("")}</div>${
    trackingEnabled
      ? ""
      : '<div class="notice">Visitor tracking is off. Enable it in Settings → Customer Privacy to collect live sessions.</div>'
  }<section class="panel list-panel live-sessions-panel" aria-labelledby="live-sessions-title"><div class="panel-head"><div><h2 id="live-sessions-title">Active Sessions</h2><div class="live-session-meta"><span id="live-stream-status" class="live-stream-status" role="status">Connecting…</span><span>Active in the last ${setup.timeoutMinutes} minutes</span></div></div><button class="secondary live-refresh" id="refresh-live-visitors" type="button"><span aria-hidden="true">↻</span> Refresh</button></div>${
    visible.length
      ? `<div class="table-scroll data-desktop-list"><table class="merchant-table live-visitors-table"><thead><tr><th>VISITOR</th><th>ACTIVITY</th><th>PRODUCT</th><th>DEVICE</th><th>DETAILS</th><th>LAST ACTIVE</th></tr></thead><tbody>${visitorRows}</tbody></table></div><div class="data-mobile-list" aria-label="Live visitor sessions">${visitorCards}</div>`
      : `<div class="live-empty"><div class="live-empty-visual" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="7" y="10" width="34" height="28" rx="5"/><path d="M7 18h34M12 14h1m4 0h1M13 30h6l4-8 5 12 3-4h5"/></svg></div><h3>${emptyTitle}</h3><p>${emptyCopy}</p>${!trackingEnabled ? '<button type="button" class="secondary" id="live-privacy-settings">Review privacy settings</button>' : liveVisitorFilter === 'all' ? `<a class="secondary button-link" href="${esc(data.storefrontPublication?.live ? storeUrl() : '/api/stores/' + storeId + '/storefront/preview')}" target="_blank" rel="noopener">${data.storefrontPublication?.live ? 'Open your store' : 'Preview your store'} <span aria-hidden="true">↗</span></a>` : '<button type="button" class="secondary" id="live-show-all">Show all visitors</button>'}</div>`
  }</section><div class="live-journey-note"><strong>Follow the customer journey</strong><ol><li><span>1</span> Product view</li><li><span>2</span> Add to cart</li><li><span>3</span> Checkout</li></ol><p>Only real activity is shown. Inactive sessions disappear automatically.</p></div>`;
  const refresh = async () => {
    const requestedStore = storeId, button = $('#refresh-live-visitors');
    button.disabled = true; button.textContent = 'Refreshing…';
    try {
      const latest = await api(`/api/stores/${requestedStore}/live-visitors`);
      if (storeId !== requestedStore || routeFromPath().view !== 'visitors') return;
      data.liveVisitors = latest;
      if (routeFromPath().view === "visitors") liveVisitorsView(latest);
    } catch (error) {
      toast(error.message);
    } finally {
      if (button.isConnected) { button.disabled = false; button.innerHTML = '<span aria-hidden="true">↻</span> Refresh'; }
    }
  };
  $('#live-privacy-settings')?.addEventListener('click', () => navigateTo('/settings/privacy'));
  $('#live-show-all')?.addEventListener('click', () => { liveVisitorFilter = 'all'; liveVisitorsView(setup); });
  document.querySelectorAll("[data-live-filter]").forEach(
    (button) =>
      (button.onclick = () => {
        liveVisitorFilter = button.dataset.liveFilter;
        liveVisitorsView(setup);
      }),
  );
  $('.live-visitor-tabs').onkeydown = event => {
    const tabs = [...document.querySelectorAll('[data-live-filter]')];
    const index = tabs.indexOf(event.target);
    if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  };
  if (focusedFilter) document.querySelector(`[data-live-filter="${focusedFilter}"]`)?.focus({preventScroll:true});
  if (focusedRefresh) $('#refresh-live-visitors').focus({preventScroll:true});
  if (focusedSession) [...document.querySelectorAll('.live-visitor-row')].find(row => row.dataset.sessionId === focusedSession && row.getClientRects().length)?.focus({preventScroll:true});
  const openVisitor = async (sessionId) => {
    try {
      const visitor = await api(
          `/api/stores/${storeId}/live-visitors/${encodeURIComponent(sessionId)}`,
        ),
        eventLabels = {
          product_page_view: "Product Page View",
          add_to_cart: "Add To Cart",
          checkout_started: "Checkout Started",
          checkout_progress: "Checkout Progress",
          otp_started: "OTP Started",
          otp_verified: "OTP Verified",
          order_created: "Order Created",
        };
      modalContent.innerHTML = `<div class="detail-modal live-visitor-detail"><div class="visitor-detail-head"><div><span class="eyebrow">LIVE VISITOR</span><h2>#${esc(visitor.sessionId.slice(-6).toUpperCase())}</h2></div><span class="activity-pill activity-${esc(visitor.status)}">${statusLabels[visitor.status] || esc(visitor.status)}</span></div><div class="detail-grid"><div><small>Product</small><strong>${esc(visitor.productName)}</strong></div><div><small>Page</small><strong>${esc(visitor.pageName)}</strong></div><div><small>Device</small><strong>${esc(visitor.deviceType || "Unknown")}</strong></div><div><small>Quantity / Bundle</small><strong>${visitor.quantity} · ${esc(visitor.bundleName) || "Standard"}</strong></div><div><small>Cart Value</small><strong>${rupees(visitor.cartValuePaise)}</strong></div><div><small>Checkout Progress</small><strong>${esc(visitor.checkoutProgress?.replaceAll("_", " ")) || "Not started"}</strong></div><div><small>Last Activity</small><strong>${eventTime(visitor.lastActivityAt)}</strong></div></div><h3>Customer movement</h3><ol class="visitor-timeline">${visitor.events
        .map(
          (item) =>
            `<li><i></i><div><strong>${eventLabels[item.eventName] || esc(item.eventName)}</strong>${item.checkoutProgress ? `<span>${esc(item.checkoutProgress.replaceAll("_", " "))}</span>` : ""}<small>${new Date(item.createdAt).toLocaleString("en-IN")}</small></div></li>`,
        )
        .join("")}</ol></div>`;
      $("#modal-form").onsubmit = (event) => event.preventDefault();
      modal.showModal();
    } catch (error) {
      toast(error.message);
    }
  };
  document.querySelectorAll(".live-visitor-row").forEach((row) => {
    row.onclick = () => openVisitor(row.dataset.sessionId);
    row.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openVisitor(row.dataset.sessionId);
      }
    };
  });
  $("#refresh-live-visitors").onclick = refresh;
  if (typeof EventSource === "undefined") {
    $("#live-stream-status").textContent = "Manual refresh";
    return;
  }
  if (!liveVisitorStream || liveVisitorStreamStoreId !== storeId) {
    liveVisitorStream?.close();
    liveVisitorStreamStoreId = storeId;
    liveVisitorStream = new EventSource(
      `/api/stores/${storeId}/live-visitors/stream`,
    );
    const streamStore = storeId;
    liveVisitorStream.onopen = () => {
      if (storeId !== streamStore) return;
      const status = $('#live-stream-status');
      if (status) { status.textContent = 'Live updates connected'; status.dataset.state = 'connected'; }
    };
    liveVisitorStream.addEventListener("snapshot", (event) => {
      try {
        if (storeId !== streamStore || routeFromPath().view !== 'visitors') return;
        const latest = JSON.parse(event.data);
        data.liveVisitors = latest;
        if (routeFromPath().view === "visitors") liveVisitorsView(latest);
      } catch {
        // Ignore malformed stream frames; EventSource reconnects automatically.
      }
    });
    liveVisitorStream.onerror = () => {
      if (storeId !== streamStore) return;
      const status = $("#live-stream-status");
      if (status) { status.textContent = "Reconnecting…"; status.dataset.state = 'reconnecting'; }
    };
  }
  const status = $("#live-stream-status");
  if (status) {
    status.textContent = liveVisitorStream.readyState === 1 ? 'Live updates connected' : 'Connecting…';
    status.dataset.state = liveVisitorStream.readyState === 1 ? 'connected' : 'connecting';
  }
}
function policiesView() {
  if (policyTab === "overview") return policyOverviewView();
  setPageHeader(
    policyTab === "rules"
      ? "Configure the operational rules applied to real orders."
      : "Edit and publish customer-facing policy content.",
    '<button class="secondary" id="back-to-policies">← Store policies</button>',
  );
  if (policyTab === 'rules') policyRulesView();
  else writtenPoliciesView(policyTab === 'contact');
  $("#back-to-policies").onclick = () => navigateTo("/policy");
}
function policyOverviewView() {
  const written = data.policies.written || [];
  setPageHeader(
    "Manage your store policies.",
    '<button class="primary" id="manage-written-policy">Manage policies</button>',
  );
  content.innerHTML = `<section class="panel policy-list">${written.map((policy) => `<button class="policy-list-item edit-policy-overview" data-type="${policy.type}"><span><strong>${esc(policy.label)}</strong><small>${policy.status === "published" ? "Published" : policy.status === "draft" ? "Draft" : "Not configured"}</small></span><b>›</b></button>`).join("")}</section><section class="panel policy-list"><h3>Additional settings</h3><button class="policy-list-item" id="open-policy-rules"><span><strong>Return & Cancellation Rules</strong><small>Operational eligibility, windows, and charges</small></span><b>›</b></button><button class="policy-list-item" id="open-contact-information"><span><strong>Contact Information</strong><small>Manage business contact details separately</small></span><b>›</b></button></section>`;
  $("#open-policy-rules").onclick = () => navigateTo("/policy/rules");
  $('#manage-written-policy').onclick = () => navigateTo('/policy/written');
  $('#open-contact-information').onclick = () => navigateTo('/policy/contact');
  if (!written.some(policy => policy.status === 'published')) {
    content.insertAdjacentHTML('afterbegin', '<p class="notice" role="status">No policies published yet. Published policies appear on your store.</p>');
  }
  document.querySelectorAll(".edit-policy-overview").forEach(
    (button) =>
      (button.onclick = () => {
        const policy = written.find(
          (item) => item.type === button.dataset.type,
        );
        if (policy) editWrittenPolicy(policy);
      }),
  );
}
function policyRulesView() {
  const cfg = data.policies.defaultRules,
    rules = data.policies.rules || [],
    toggle = (name, label, value) =>
      `<label class="toggle-row"><span><strong>${label}</strong></span><input name="${name}" type="checkbox" ${value ? "checked" : ""}></label>`;
  content.innerHTML = `<form id="default-policy-rules"><section class="panel"><div class="panel-head"><div><h2>Default Rules</h2><span>Operational return and cancellation rules used by the eligibility engine.</span></div><button class="primary" type="submit">Save Default Rules</button></div>${toggle("allowReturns", "Allow Returns", cfg.allowReturns)}<label class="field">Return Window · days<input name="returnWindowDays" type="number" min="0" max="365" value="${cfg.returnWindowDays}" required></label>${toggle("allowCancellation", "Allow Cancellation", cfg.allowCancellation)}<label class="field">Cancellation Window<select name="cancellationUntil"><option value="before_fulfillment" ${cfg.cancellationUntil === "before_fulfillment" ? "selected" : ""}>Until Order Fulfilled</option><option value="before_shipped" ${cfg.cancellationUntil === "before_shipped" ? "selected" : ""}>Before Shipment</option><option value="hours" ${cfg.cancellationUntil === "hours" ? "selected" : ""}>Number of Hours</option></select></label><label class="field">Cancellation Window Hours<input name="cancellationWindowHours" type="number" min="0" value="${cfg.cancellationWindowHours}"></label><label class="field">Return Shipping Fee · ${esc(data?.store?.currency || "Currency")}<input name="returnShippingFee" type="number" min="0" step="0.01" value="${(cfg.returnShippingFeePaise / 100).toFixed(2)}"></label><label class="field">Restocking / Return Charge · ${esc(data?.store?.currency || "Currency")}<input name="restockingCharge" type="number" min="0" step="0.01" value="${(cfg.restockingChargePaise / 100).toFixed(2)}"></label>${toggle("codOrdersEligible", "COD Orders Eligible", cfg.codOrdersEligible)}${toggle("deliveredOrdersEligible", "Delivered Orders Eligible", cfg.deliveredOrdersEligible)}${toggle("damagedProductReturn", "Damaged Product Return", cfg.damagedProductReturn)}${toggle("wrongProductReturn", "Wrong Product Return", cfg.wrongProductReturn)}</section></form><section class="panel"><div class="panel-head"><div><h2>Special Rules</h2><span>Product and collection rules override Default Rules.</span></div><button class="primary" id="add-policy-rule">+ Add Rule</button></div>${rules.length ? `<table><thead><tr><th>RULE NAME</th><th>APPLIES TO</th><th>RETURN</th><th>CANCELLATION</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${rules.map((rule) => `<tr><td><strong>${esc(rule.ruleName)}</strong></td><td>${esc(rule.targetName)}</td><td>${rule.returnAllowed ? `${rule.returnCondition === "damaged_only" ? "Only if damaged" : rule.returnCondition === "wrong_or_damaged" ? "Wrong or damaged" : `${rule.returnDays} days`}` : "Not allowed"}</td><td>${rule.cancellationAllowed ? "Allowed" : "Not allowed"}</td><td><span class="pill">${esc(rule.status)}</span></td><td><button class="secondary edit-policy-rule" data-id="${rule.id}">Edit</button> <button class="secondary delete-policy-rule" data-id="${rule.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : empty("No special return or cancellation rules.")}</section>`;
  const form = $("#default-policy-rules");
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/stores/${storeId}/policies/rules/default`, {
        method: "PATCH",
        body: JSON.stringify({
          allowReturns: form.elements.allowReturns.checked,
          returnWindowDays: Number(form.elements.returnWindowDays.value),
          allowCancellation: form.elements.allowCancellation.checked,
          cancellationUntil: form.elements.cancellationUntil.value,
          cancellationWindowHours: Number(
            form.elements.cancellationWindowHours.value,
          ),
          returnShippingFeePaise: Math.round(
            Number(form.elements.returnShippingFee.value) * 100,
          ),
          restockingChargePaise: Math.round(
            Number(form.elements.restockingCharge.value) * 100,
          ),
          codOrdersEligible: form.elements.codOrdersEligible.checked,
          deliveredOrdersEligible:
            form.elements.deliveredOrdersEligible.checked,
          damagedProductReturn: form.elements.damagedProductReturn.checked,
          wrongProductReturn: form.elements.wrongProductReturn.checked,
        }),
      });
      toast("Default policy rules saved");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  $("#add-policy-rule").onclick = () => policyRuleForm();
  document
    .querySelectorAll(".edit-policy-rule")
    .forEach(
      (button) =>
        (button.onclick = () =>
          policyRuleForm(
            rules.find((rule) => rule.id === Number(button.dataset.id)),
          )),
    );
  document.querySelectorAll(".delete-policy-rule").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("Delete this special policy rule?")) return;
        try {
          await api(
            `/api/stores/${storeId}/policies/rules/${button.dataset.id}`,
            { method: "DELETE" },
          );
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
}
function policyRuleForm(rule = null) {
  const products = data.products || [],
    collections = ops.collections || [];
  openForm(
    rule ? "Edit Rule" : "Add Rule",
    `<label class="field">Rule Name<input name="ruleName" value="${esc(rule?.ruleName || "")}" required></label><label class="field">Applies To<select name="appliesTo"><option value="all_products" ${rule?.appliesTo === "all_products" ? "selected" : ""}>All Products</option><option value="product" ${rule?.appliesTo === "product" ? "selected" : ""}>Specific Product</option><option value="collection" ${rule?.appliesTo === "collection" ? "selected" : ""}>Specific Collection</option></select></label><label class="field">Specific Product<select name="productTarget">${products.map((item) => `<option value="${item.id}" ${rule?.appliesTo === "product" && rule.targetId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label class="field">Specific Collection<select name="collectionTarget">${collections.map((item) => `<option value="${item.id}" ${rule?.appliesTo === "collection" && rule.targetId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label class="field checkbox"><input name="returnAllowed" type="checkbox" ${rule?.returnAllowed ? "checked" : ""}> <span>Return Allowed</span></label><label class="field">Return Days<input name="returnDays" type="number" min="0" max="365" value="${rule?.returnDays || 0}"></label><label class="field">Return Condition<select name="returnCondition"><option value="standard">Standard</option><option value="damaged_only" ${rule?.returnCondition === "damaged_only" ? "selected" : ""}>Only if damaged</option><option value="wrong_or_damaged" ${rule?.returnCondition === "wrong_or_damaged" ? "selected" : ""}>Wrong or damaged</option></select></label><label class="field checkbox"><input name="cancellationAllowed" type="checkbox" ${rule?.cancellationAllowed ? "checked" : ""}> <span>Cancellation Allowed</span></label><label class="field">Cancellation Window<select name="cancellationUntil"><option value="before_fulfillment">Before fulfillment</option><option value="before_shipped">Before shipment</option><option value="hours">Number of hours</option></select></label><label class="field">Cancellation Hours<input name="cancellationWindowHours" type="number" min="0" value="${rule?.cancellationWindowHours || 0}"></label><label class="field">Status<select name="status"><option value="active" ${rule?.status !== "inactive" ? "selected" : ""}>Active</option><option value="inactive" ${rule?.status === "inactive" ? "selected" : ""}>Inactive</option></select></label>`,
    rule ? "Save Rule" : "Add Rule",
    (values) => {
      const appliesTo = values.appliesTo,
        targetId =
          appliesTo === "product"
            ? Number(values.productTarget)
            : appliesTo === "collection"
              ? Number(values.collectionTarget)
              : null,
        payload = {
          ruleName: values.ruleName,
          appliesTo,
          targetId,
          returnAllowed: values.returnAllowed === "on",
          returnDays: Number(values.returnDays),
          returnCondition: values.returnCondition,
          cancellationAllowed: values.cancellationAllowed === "on",
          cancellationUntil: values.cancellationUntil,
          cancellationWindowHours: Number(values.cancellationWindowHours),
          status: values.status,
        };
      return api(
        rule
          ? `/api/stores/${storeId}/policies/rules/${rule.id}`
          : `/api/stores/${storeId}/policies/rules`,
        { method: rule ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
    },
  );
}
function writtenPoliciesView(contactOnly = false) {
  const written = contactOnly ? [data.policies.contact].filter(Boolean) : data.policies.written || [],
    statusLabel = (status) =>
      status === "no_policy"
        ? "No Policy Set"
        : status === "draft"
          ? "Draft"
          : "Published";
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>${contactOnly ? 'Contact Information' : 'Store policies'}</h2><span>${contactOnly ? "Your business contact details." : "Your return, privacy, shipping, and other store policies."}</span></div></div><table><thead><tr><th>POLICY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${written.map((policy) => `<tr><td><strong>${esc(policy.label)}</strong></td><td><span class="pill">${statusLabel(policy.status)}</span></td><td><button class="secondary edit-written-policy" data-type="${policy.type}">Edit</button> <button class="secondary preview-written-policy" data-type="${policy.type}" ${policy.status === "no_policy" ? "disabled" : ""}>Preview</button> <button class="primary publish-written-policy" data-type="${policy.type}" ${policy.status === "no_policy" ? "disabled" : ""}>Publish</button>${policy.status === "published" ? ` <button class="secondary unpublish-written-policy" data-type="${policy.type}">Move to Draft</button>` : ""}</td></tr>`).join("")}</tbody></table></section>`;
  document
    .querySelectorAll(".edit-written-policy")
    .forEach(
      (button) =>
        (button.onclick = () =>
          editWrittenPolicy(
            written.find((item) => item.type === button.dataset.type),
          )),
    );
  document
    .querySelectorAll(".preview-written-policy")
    .forEach(
      (button) =>
        (button.onclick = () =>
          open(
            `/api/stores/${storeId}/policies/written/${button.dataset.type}/preview`,
            "_blank",
          )),
    );
  document.querySelectorAll(".publish-written-policy").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/policies/written/${button.dataset.type}/publish`,
            { method: "POST", body: "{}" },
          );
          toast("Policy Published");
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  document.querySelectorAll(".unpublish-written-policy").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await api(
            `/api/stores/${storeId}/policies/written/${button.dataset.type}/unpublish`,
            { method: "POST", body: "{}" },
          );
          toast("Policy moved to Draft");
          await load();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
}
function editWrittenPolicy(policy) {
  if (policy.type === "contact")
    return openForm(
      "Edit Contact Information",
      `<label class="field">Policy Title<input name="title" value="${esc(policy.title)}" required></label><label class="field">Business / Store Name<input name="storeName" value="${esc(policy.contact.storeName || data.store.name)}" required></label><label class="field">Support Email<input name="supportEmail" type="email" value="${esc(policy.contact.supportEmail || "")}" required></label><label class="field">Phone Number<input name="phone" value="${esc(policy.contact.phone || "")}"></label><label class="field">Address<textarea name="address">${esc(policy.contact.address || "")}</textarea></label><label class="field">Support Hours<input name="supportHours" value="${esc(policy.contact.supportHours || "")}"></label>`,
      "Save",
      (values) =>
        api(`/api/stores/${storeId}/policies/written/contact`, {
          method: "PATCH",
          body: JSON.stringify({
            title: values.title,
            contact: {
              storeName: values.storeName,
              supportEmail: values.supportEmail,
              phone: values.phone,
              address: values.address,
              supportHours: values.supportHours,
            },
          }),
        }),
    );
  modalContent.innerHTML = `<h2>Edit ${esc(policy.label)}</h2><label class="field">Policy Title<input id="written-policy-title" value="${esc(policy.title)}" required></label><label class="field">Rich Text Editor</label><div class="rich-toolbar"><button type="button" data-command="bold"><strong>B</strong></button><button type="button" data-command="italic"><em>I</em></button><button type="button" data-command="insertUnorderedList">List</button></div><div id="written-policy-editor" class="rich-text-editor" contenteditable="true">${policy.content}</div><button class="primary" type="submit">Save</button>`;
  const form = $("#modal-form"),
    editor = $("#written-policy-editor");
  document
    .querySelectorAll("[data-command]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          document.execCommand(button.dataset.command, false)),
    );
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/stores/${storeId}/policies/written/${policy.type}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: $("#written-policy-title").value,
          content: editor.innerHTML,
        }),
      });
      modal.close();
      toast("Policy saved as Draft");
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  modal.showModal();
}

const productPageOverrides = (() => {
  const productPageMethods = [
    [
      "default",
      "Use Default Template",
      "Build a clean working page from connected product data.",
    ],
    [
      "template",
      "Choose Template",
      "Browse the template gallery only when you need it.",
    ],
    [
      "upload",
      "Upload Pre-Built Page",
      "Process an HTML page and connect it to this product.",
    ],
    [
      "blank",
      "Build From Scratch",
      "Start with a blank page and add sections.",
    ],
    ["ai", "Create With AI", "Generate editable sections in the same editor."],
  ];
  const productPageCategories = [
    "All",
    "General",
    "Single Product",
    "Long Form",
    "Minimal",
    "My Templates",
  ];
  const corePageSections = [
    ["product-media", "Product Media"],
    ["product-information", "Product Information"],
    ["description", "Description"],
    ["bundle", "Bundle"],
    ["reviews", "Reviews"],
    ["checkout-button", "Checkout Button"],
  ];
  const pageSectionLabel = (type) =>
    corePageSections.find(([id]) => id === type)?.[1] ||
    type
      .split("-")
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" ");
  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const pageSlugExists = (slug, exceptPageId = null) =>
    data.pages.some(
      (page) =>
        page.id !== exceptPageId &&
        [page.slug, page.liveSlug].filter(Boolean).includes(slug),
    );
  const availablePageSlug = (value, exceptPageId = null) => {
    const base = slugify(value) || "product-page";
    if (!pageSlugExists(base, exceptPageId)) return base;
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!pageSlugExists(candidate, exceptPageId)) return candidate;
    }
    return `${base}-${Date.now()}`;
  };
  const pageSetupDefaults = (productId = null) => {
    const product =
      data.products.find((item) => item.id === Number(productId)) ||
      data.products[0] ||
      null;
    return {
      product,
      title: product?.name || "",
      slug: availablePageSlug(product?.slug || product?.name || ""),
    };
  };
  async function refreshWorkspace() {
    [data, ops, templates, aiState] = await Promise.all([
      api(`/api/stores/${storeId}/dashboard`),
      api(`/api/stores/${storeId}/product-operations`),
      api("/api/page-templates"),
      api(`/api/stores/${storeId}/ai-page-status`),
    ]);
  }

  function allProductsView() {
    const el = $("#product-section");
    el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>All Products</h2><span>Product details and product pages stay connected.</span></div><button class="primary" id="add-product">+ Add product</button></div>${
      data.products.length
        ? `<table><thead><tr><th>PRODUCT</th><th>PRICE</th><th>INVENTORY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${data.products
            .map((product) => {
              const page = data.pages.find(
                (item) => item.productId === product.id,
              );
              return `<tr><td><strong>${esc(product.name)}</strong><br><small>/${esc(product.slug)}</small></td><td>${rupees(product.pricePaise)}${product.comparePricePaise ? `<br><small><s>${rupees(product.comparePricePaise)}</s></small>` : ""}</td><td>${product.stock}</td><td><span class="pill">${product.active ? "Active" : "Draft"}</span></td><td><button class="secondary edit-product" data-id="${product.id}">Edit Product</button> <button class="primary product-page-action" data-product="${product.id}">Manage Pages</button></td></tr>`;
            })
            .join("")}</tbody></table>`
        : empty("No products yet. Add a product to create its product page.")
    }</section>`;
    $("#add-product").onclick = () => navigateTo("/products/new");
    document
      .querySelectorAll(".edit-product")
      .forEach(
        (button) =>
          (button.onclick = () =>
            navigateTo(`/products/${Number(button.dataset.id)}`)),
      );
    document
      .querySelectorAll(".product-page-action")
      .forEach(
        (button) =>
          (button.onclick = () =>
            button.dataset.page
              ? productPageEditor(Number(button.dataset.page))
              : productPageMethodPicker(Number(button.dataset.product))),
      );
  }

  function createProductEditor(productId = null) {
    const product = productId
      ? data.products.find((item) => item.id === productId)
      : null;
    content.innerHTML = `<form id="product-editor" class="product-editor"><div class="product-editor-head"><div><button class="back-link" type="button" id="back-products">← Products</button><h2>${product ? "Edit" : "Add"} Product</h2><p>Enter product data once. Templates read these values automatically.</p></div><div><button class="primary" type="submit">Save Product</button></div></div><div class="product-editor-layout"><div><section class="panel"><h3>Product Details</h3><label class="field">Product Title *<input name="name" value="${esc(product?.name || "")}" required autofocus></label><label class="field">URL slug *<input name="slug" value="${esc(product?.slug || "")}" required></label><label class="field">Description *<textarea name="description" rows="7" required>${esc(product?.description || "")}</textarea></label></section><section class="panel"><h3>Pricing and Inventory</h3><div class="form-columns"><label class="field">Price (${esc(data?.store?.currency || "Currency")}) *<input name="price" type="number" min="0" step="0.01" value="${product ? (product.pricePaise / 100).toFixed(2) : ""}" required></label><label class="field">Compare-at Price (${esc(data?.store?.currency || "Currency")})<input name="comparePrice" type="number" min="0" step="0.01" value="${product?.comparePricePaise ? (product.comparePricePaise / 100).toFixed(2) : ""}"></label><label class="field">Quantity *<input name="stock" type="number" min="0" value="${product?.stock ?? 0}" required></label><label class="field">Status<select name="status"><option value="active" ${product?.active !== 0 ? "selected" : ""}>Active</option><option value="draft" ${product?.active === 0 ? "selected" : ""}>Draft</option></select></label></div></section>${product ? "" : `<section class="panel"><h3>Product Page</h3><div class="method-list">${productPageMethods.map(([id, label, copy], index) => `<label class="choice"><input type="radio" name="pageMode" value="${id}" ${index === 0 ? "checked" : ""} ${id === "ai" && !aiState.available ? "disabled" : ""}><span><b>${label}</b><small>${id === "ai" && !aiState.available ? "AI provider is not authorized." : copy}</small></span></label>`).join("")}</div></section>`}</div><aside class="product-editor-side"><section class="panel"><h3>Connected Data</h3><p class="muted">Title, price, description, inventory, bundles, approved reviews, and product media remain connected to the live page.</p></section></aside></div></form>`;
    $("#back-products").onclick = productsView;
    $("#product-editor").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        values = Object.fromEntries(new FormData(form)),
        payload = {
          name: values.name,
          slug: values.slug,
          description: values.description,
          pricePaise: Math.round(Number(values.price) * 100),
          comparePricePaise: values.comparePrice
            ? Math.round(Number(values.comparePrice) * 100)
            : null,
          stock: Number(values.stock),
          status: values.status,
        };
      try {
        const saved = product
          ? await api(`/api/stores/${storeId}/products/${product.id}`, {
              method: "PATCH",
              body: JSON.stringify(payload),
            })
          : await api(`/api/stores/${storeId}/products`, {
              method: "POST",
              body: JSON.stringify(payload),
            });
        await refreshWorkspace();
        toast(
          product
            ? "Product updated — live connected data refreshed"
            : "Product saved",
        );
        if (product) {
          createProductEditor(saved.id);
          return;
        }
        productPageMethodPicker(saved.id, values.pageMode || "default");
      } catch (error) {
        toast(error.message);
      }
    };
  }

  function pagesView() {
    const productPages = data.pages;
    content.innerHTML = `<section class="panel page-creation-panel"><div class="panel-head"><div><h2>Create Product Page</h2><span>Choose one starting method. Every method opens the same editor.</span></div></div><div class="method-grid five-methods">${productPageMethods.map(([id, label, copy], index) => `<button class="method-card" data-page-method="${id}" ${!data.products.length || (id === "ai" && !aiState.available) ? "disabled" : ""}><b>0${index + 1}</b><strong>${label}</strong><span>${id === "ai" && !aiState.available ? "AI provider is not authorized." : copy}</span></button>`).join("")}</div></section><section class="panel"><div class="panel-head"><div><h2>Product Pages</h2><span>Draft, preview, edit, publish, and open live pages.</span></div></div>${productPages.length ? `<table><thead><tr><th>PAGE</th><th>PRODUCT</th><th>METHOD</th><th>TEMPLATE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${productPages.map((page) => `<tr><td><strong>${esc(page.title)}</strong><br><small>/${esc(page.slug)}</small></td><td>${esc(page.productName)}</td><td><span class="pill">${esc(page.creationMethod)}</span></td><td>${esc(page.templateKey)}</td><td><span class="pill">${esc(page.status)}</span></td><td><button class="primary edit-page" data-id="${page.id}">Edit</button> <a class="link" target="_blank" href="/api/stores/${storeId}/pages/${page.id}/preview">Preview ↗</a>${page.status === "published" ? ` <a class="link" target="_blank" href="${esc(storeUrl(encodeURIComponent(page.liveSlug || page.slug)))}">View Live Page ↗</a>` : ""}</td></tr>`).join("")}</tbody></table>` : empty("No product pages yet.")}</section>`;
    document
      .querySelectorAll("[data-page-method]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            productPageMethodPicker(null, button.dataset.pageMethod)),
      );
    document
      .querySelectorAll(".edit-page")
      .forEach(
        (button) =>
          (button.onclick = () => productPageEditor(Number(button.dataset.id))),
      );
  }

  function productPageMethodPicker(productId = null, initialMethod = null) {
    if (initialMethod === "template") return templateGallery(productId);
    if (initialMethod === "upload") return uploadProductPageWizard(productId);
    return pageSetup(initialMethod || "default", productId);
  }
  function pageSetup(method, productId = null, templateKey = null) {
    const defaults = pageSetupDefaults(productId),
      product = productId ? defaults.product : null;
    modalContent.innerHTML = `<h2>${method === "ai" ? "Create With AI" : method === "blank" ? "Build From Scratch" : method === "default" ? "Use Default Template" : "Use Template"}</h2><p class="muted">Product data is inserted automatically and remains connected.</p><label class="field">Product *<select name="productId" ${product ? "disabled" : ""}>${data.products.map((item) => `<option value="${item.id}" ${item.id === defaults.product?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label class="field">Page Name *<input name="title" value="${esc(defaults.title)}" required></label><label class="field">URL slug *<input name="slug" value="${esc(defaults.slug)}" required><small>Must be unique for this store.</small></label>${method === "ai" ? '<label class="field">Instructions *<textarea name="brief" required placeholder="Describe the product page tone and structure."></textarea></label>' : ""}<label class="field">Button Text *<input name="ctaText" value="BUY NOW" required></label><label class="field">Button Action *<select name="ctaAction"><option value="direct">Direct Checkout</option><option value="cart">Add To Cart</option><option value="redirect">Redirect</option></select></label><label class="field redirect-setup" hidden>Redirect URL *<input name="redirectUrl" type="url" placeholder="https://example.com/offer"></label><button class="primary" type="submit">Create and Open Editor</button>`;
    const form = $("#modal-form"),
      action = form.elements.ctaAction,
      redirect = $(".redirect-setup");
    action.onchange = () => (redirect.hidden = action.value !== "redirect");
    let customTitle = false,
      customSlug = false;
    form.elements.title.oninput = () => (customTitle = true);
    form.elements.slug.oninput = () => (customSlug = true);
    form.elements.productId.onchange = () => {
      const next = pageSetupDefaults(Number(form.elements.productId.value));
      if (!customTitle) form.elements.title.value = next.title;
      if (!customSlug) form.elements.slug.value = next.slug;
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)),
        selectedId = productId || Number(form.elements.productId.value);
      if (values.ctaAction === "redirect" && !values.redirectUrl)
        return toast("Redirect URL is required");
      if (pageSlugExists(slugify(values.slug)))
        return toast(
          `/${slugify(values.slug)} is already used. Try /${availablePageSlug(
            values.slug,
          )}.`,
        );
      try {
        const page = await createPageRequest(
          {
            ...values,
            productId: selectedId,
            status: "draft",
            templateKey:
              templateKey || (method === "default" ? "warm-story" : undefined),
            body: method === "blank" ? "" : "Connected product page",
          },
          method,
        );
        modal.close();
        await refreshWorkspace();
        productPageEditor(page.id);
      } catch (error) {
        toast(
          /URL is already being used/i.test(error.message)
            ? "That page URL is already used. Change the URL slug and try again."
            : error.message,
        );
      }
    };
    modal.showModal();
  }

  function templateGallery(productId = null, category = "All") {
    const visible = templates.filter(
      (template) => category === "All" || template.category === category,
    );
    modalContent.innerHTML = `<div class="template-gallery-head"><div><h2>Choose Product Page Template</h2><p>Templates control layout only. Product data stays connected.</p></div></div><div class="template-categories">${productPageCategories.map((item) => `<button type="button" data-template-category="${item}" class="${item === category ? "active" : ""}">${item}</button>`).join("")}</div><div class="template-gallery">${visible.length ? visible.map((template) => `<article class="template-card" style="--preview-bg:${template.designTokens.background};--preview-text:${template.designTokens.text};--preview-accent:${template.designTokens.accent}"><div class="template-preview"><i></i><strong>${esc(template.name)}</strong><span></span><button></button></div><h3>${esc(template.name)}</h3><p>${esc(template.description)}</p><span class="pill">${esc(template.category || "General")}</span><div class="template-actions"><button class="secondary preview-template" type="button" data-key="${template.key}">Preview</button><button class="primary use-template" type="button" data-key="${template.key}">Use Template</button></div></article>`).join("") : '<p class="empty">No templates in this category yet.</p>'}</div>`;
    $("#modal-form").onsubmit = (event) => event.preventDefault();
    document
      .querySelectorAll("[data-template-category]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            templateGallery(productId, button.dataset.templateCategory)),
      );
    document.querySelectorAll(".preview-template").forEach(
      (button) =>
        (button.onclick = () => {
          const template = templates.find(
            (item) => item.key === button.dataset.key,
          );
          $(".template-gallery-head").insertAdjacentHTML(
            "beforeend",
            `<div class="template-inline-preview" style="background:${template.designTokens.background};color:${template.designTokens.text};border-color:${template.designTokens.accent}"><span>${esc(template.category || "General")}</span><h3>${esc(template.name)}</h3><p>${esc(template.preview)}</p></div>`,
          );
        }),
    );
    document.querySelectorAll(".use-template").forEach(
      (button) =>
        (button.onclick = () => {
          modal.close();
          pageSetup("template", productId, button.dataset.key);
        }),
    );
    modal.showModal();
  }

  function uploadProductPageWizard(productId = null) {
    const defaults = pageSetupDefaults(productId),
      product = productId ? defaults.product : null;
    modalContent.innerHTML = `<h2>Upload Pre-Built Product Page</h2><div class="quick-flow"><div class="step"><b>01</b>Upload</div><div class="step"><b>02</b>Process</div><div class="step"><b>03</b>Preview</div><div class="step"><b>04</b>Connect Product</div><div class="step"><b>05</b>Configure Checkout</div><div class="step"><b>06</b>Editor</div><div class="step"><b>07</b>Publish</div></div><label class="field">Product *<select name="productId" ${product ? "disabled" : ""}>${data.products.map((item) => `<option value="${item.id}" ${item.id === defaults.product?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label class="field">Page Name *<input name="title" value="${esc(defaults.title)}" required></label><label class="field">Upload File *<input name="file" type="file" accept=".html,.htm,text/html" required></label><button class="secondary" id="process-product-page" type="button">Process & Preview</button><div id="product-import-preview" hidden><iframe title="Processed page preview" sandbox></iframe><label class="field">URL slug *<input name="slug" value="${esc(defaults.slug)}" required><small>Must be unique for this store.</small></label><label class="field">Button Text *<input name="ctaText" value="BUY NOW" required></label><label class="field">Button Action *<select name="ctaAction"><option value="direct">Direct Checkout</option><option value="cart">Add To Cart</option><option value="redirect">Redirect</option></select></label><label class="field redirect-upload" hidden>Redirect URL *<input name="redirectUrl" type="url"></label><button class="primary" type="submit">Save and Open Editor</button></div>`;
    const form = $("#modal-form");
    let processed = null,
      customTitle = false,
      customSlug = false;
    form.elements.title.oninput = () => (customTitle = true);
    form.elements.slug.oninput = () => (customSlug = true);
    form.elements.productId.onchange = () => {
      const next = pageSetupDefaults(Number(form.elements.productId.value));
      if (!customTitle) form.elements.title.value = next.title;
      if (!customSlug) form.elements.slug.value = next.slug;
    };
    form.elements.ctaAction.onchange = () =>
      ($(".redirect-upload").hidden =
        form.elements.ctaAction.value !== "redirect");
    $("#process-product-page").onclick = async () => {
      try {
        const file = form.elements.file.files[0];
        if (!file) throw Error("Upload File is required");
        processed = {
          fileName: file.name,
          mimeType: file.type || "text/html",
          fileContentBase64: await fileToBase64(file),
        };
        const result = await api(
            `/api/stores/${storeId}/page-imports/preview`,
            { method: "POST", body: JSON.stringify(processed) },
          ),
          preview = $("#product-import-preview");
        showImportedPreview(preview, result);
      } catch (error) {
        toast(error.message);
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!processed)
        return toast("Process and Preview the uploaded file first");
      const values = Object.fromEntries(new FormData(form));
      if (values.ctaAction === "redirect" && !values.redirectUrl)
        return toast("Redirect URL is required");
      if (pageSlugExists(slugify(values.slug)))
        return toast(
          `/${slugify(values.slug)} is already used. Try /${availablePageSlug(
            values.slug,
          )}.`,
        );
      try {
        const page = await createPageRequest(
          {
            ...values,
            ...processed,
            productId: productId || Number(form.elements.productId.value),
            status: "draft",
            codEnabled: values.ctaAction !== "redirect",
          },
          "upload",
        );
        modal.close();
        await refreshWorkspace();
        productPageEditor(page.id);
      } catch (error) {
        toast(
          /URL is already being used/i.test(error.message)
            ? "That page URL is already used. Change the URL slug and try again."
            : error.message,
        );
      }
    };
    modal.showModal();
  }

  function pageEditorSections(page, pageContent) {
    if (Array.isArray(pageContent.editorSections))
      return pageContent.editorSections;
    return page.creationMethod === "blank"
      ? []
      : corePageSections.map(([id, label]) => ({
          id,
          type: id,
          label,
          visible: true,
          connected: true,
        }));
  }
  function productPageEditor(pageId) {
    const page = data.pages.find((item) => item.id === pageId);
    if (!page) return pagesView();
    const product = data.products.find((item) => item.id === page.productId),
      bundles = data.bundles.filter((item) => item.productId === product.id),
      approved = data.reviews.filter(
        (item) => item.productId === product.id && item.status === "approved",
      );
    let pageContent = {};
    try {
      pageContent = JSON.parse(page.contentJson || "{}");
    } catch {}
    const sections = pageEditorSections(page, pageContent),
      reviews = {
        showReviews: true,
        showRating: true,
        showImages: true,
        limit: 6,
        ...(pageContent.reviewSettings || {}),
      },
      media = {
        mainImage: true,
        imageGallery: true,
        gif: true,
        video: true,
        ...(pageContent.mediaSettings || {}),
      };
    content.innerHTML = `<div class="page-editor"><div class="page-editor-top"><div><button class="back-link" id="back-pages">← Product Pages</button><h2>Product Page</h2><p>${esc(product.name)} · <span class="pill">${esc(page.status)}</span></p></div><div class="page-editor-actions"><a class="secondary button-link" target="_blank" href="/api/stores/${storeId}/pages/${page.id}/preview">Preview</a><button class="secondary" id="save-page-editor">Save</button><button class="primary" id="publish-page-editor">Publish</button>${page.status === "published" ? `<a class="primary button-link" target="_blank" href="${esc(storeUrl(encodeURIComponent(page.liveSlug || page.slug)))}">View Live Page</a>` : ""}</div></div><div class="page-editor-layout"><section class="panel"><div class="panel-head"><div><h3>Sections</h3><span>Edit, reorder, show, or hide each section.</span></div><button class="secondary" id="add-page-section">+ Add Section</button></div><div id="page-section-list">${sections.length ? sections.map((section, index) => pageSectionCard(section, index, { product, bundles, approved, reviews, media, pageContent })).join("") : '<div class="blank-page"><h3>Blank Page</h3><p>Add the first connected or custom section.</p></div>'}</div></section><aside class="page-editor-side"><section class="panel"><h3>Connected Product Data</h3><dl><dt>Title</dt><dd>${esc(product.name)}</dd><dt>Price</dt><dd>${rupees(product.pricePaise)}</dd><dt>Images</dt><dd>Product media</dd><dt>Bundles</dt><dd>${bundles.length}</dd><dt>Approved Reviews</dt><dd>${approved.length}</dd></dl><p class="muted">Changes to the product price, title, bundles, or approved reviews automatically reach this page.</p></section><section class="panel"><label class="field">Headline<input id="page-headline" value="${esc(pageContent.hero?.headline || page.title)}"></label><label class="field">Subheadline<textarea id="page-subheadline">${esc(pageContent.hero?.subheadline || page.body)}</textarea></label><label class="field">Button Text *<input id="page-cta-text" value="${esc(pageContent.ctaText || "BUY NOW")}" required></label><label class="field">Button Action *<select id="page-cta-action"><option value="direct" ${pageContent.checkoutAction !== "redirect" && pageContent.checkoutAction !== "cart" ? "selected" : ""}>Direct Checkout</option><option value="cart" ${pageContent.checkoutAction === "cart" ? "selected" : ""}>Add To Cart</option><option value="redirect" ${pageContent.checkoutAction === "redirect" ? "selected" : ""}>Redirect</option></select></label><label class="field" id="page-redirect-field" ${pageContent.checkoutAction === "redirect" ? "" : "hidden"}>Redirect URL *<input id="page-redirect-url" type="url" value="${esc(pageContent.redirectUrl || "")}"></label></section></aside></div></div>`;
    $("#back-pages").onclick = pagesView;
    $("#page-cta-action").onchange = () =>
      ($("#page-redirect-field").hidden =
        $("#page-cta-action").value !== "redirect");
    wirePageSectionButtons(page, pageContent);
    $("#save-page-editor").onclick = () => saveProductPageEditor(page, false);
    $("#publish-page-editor").onclick = () => saveProductPageEditor(page, true);
    $("#add-page-section").onclick = () =>
      addProductPageSection(page, pageContent);
  }
  function pageSectionCard(section, index, ctx) {
    const settings =
      section.id === "product-media"
        ? `<div class="section-settings" hidden>${["mainImage", "imageGallery", "gif", "video"].map((key) => `<label class="field checkbox"><input data-media-setting="${key}" type="checkbox" ${ctx.media[key] ? "checked" : ""}> <span>${pageSectionLabel(key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()))}</span></label>`).join("")}</div>`
        : section.id === "reviews"
          ? `<div class="section-settings" hidden><label class="field checkbox"><input id="review-show" type="checkbox" ${ctx.reviews.showReviews ? "checked" : ""}> <span>Show Reviews</span></label><label class="field checkbox"><input id="rating-show" type="checkbox" ${ctx.reviews.showRating ? "checked" : ""}> <span>Show Rating</span></label><label class="field checkbox"><input id="review-images-show" type="checkbox" ${ctx.reviews.showImages ? "checked" : ""}> <span>Show Images</span></label><label class="field">Number to Display<input id="review-limit" type="number" min="1" max="50" value="${ctx.reviews.limit}"></label></div>`
          : section.connected
            ? `<div class="section-settings" hidden><p class="notice">Connected to the actual ${esc(ctx.product.name)} data. Edit the product source to change these values.</p></div>`
            : `<div class="section-settings" hidden><label class="field">Heading<input data-section-title value="${esc(section.title || section.label || "Custom Content")}"></label><label class="field">Content<textarea data-section-body>${esc(section.body || "")}</textarea></label></div>`;
    return `<article class="page-section-card" data-section-id="${esc(section.id)}" data-section-type="${esc(section.type || section.id)}" data-connected="${section.connected ? "true" : "false"}"><div><span class="section-order">${index + 1}</span><strong>${esc(section.label || pageSectionLabel(section.type || section.id))}</strong>${section.connected ? "<small>Connected</small>" : ""}</div><label class="section-visible"><input type="checkbox" ${section.visible !== false ? "checked" : ""}> Show</label><div class="section-card-actions"><button class="tiny section-up" type="button" aria-label="Move up">↑</button><button class="tiny section-down" type="button" aria-label="Move down">↓</button><button class="secondary section-edit" type="button">Edit</button></div>${settings}</article>`;
  }
  function wirePageSectionButtons() {
    const list = $("#page-section-list"),
      renumber = () =>
        [...list.querySelectorAll(".page-section-card")].forEach(
          (card, index) =>
            (card.querySelector(".section-order").textContent = index + 1),
        );
    list.querySelectorAll(".section-edit").forEach(
      (button) =>
        (button.onclick = () => {
          const settings = button
            .closest(".page-section-card")
            .querySelector(".section-settings");
          settings.hidden = !settings.hidden;
        }),
    );
    list.querySelectorAll(".section-up").forEach(
      (button) =>
        (button.onclick = () => {
          const card = button.closest(".page-section-card");
          if (card.previousElementSibling)
            list.insertBefore(card, card.previousElementSibling);
          renumber();
        }),
    );
    list.querySelectorAll(".section-down").forEach(
      (button) =>
        (button.onclick = () => {
          const card = button.closest(".page-section-card");
          if (card.nextElementSibling)
            list.insertBefore(card.nextElementSibling, card);
          renumber();
        }),
    );
  }
  async function saveProductPageEditor(page, publish) {
    const cards = [...document.querySelectorAll(".page-section-card")],
      editorSections = cards.map((card) => ({
        id: card.dataset.sectionId,
        type: card.dataset.sectionType,
        label: card.querySelector("strong").textContent,
        visible: card.querySelector(".section-visible input").checked,
        connected: card.dataset.connected === "true",
        title: card.querySelector("[data-section-title]")?.value,
        body: card.querySelector("[data-section-body]")?.value,
      })),
      customSections = editorSections
        .filter((section) => !section.connected)
        .map((section) => ({
          id: section.id,
          type: section.type,
          title: section.title,
          body: section.body,
          visible: section.visible,
        })),
      checkoutAction = $("#page-cta-action").value,
      redirectUrl = $("#page-redirect-url").value.trim();
    if (checkoutAction === "redirect" && !redirectUrl)
      return toast("Redirect URL is required");
    const mediaSettings = Object.fromEntries(
        [...document.querySelectorAll("[data-media-setting]")].map((input) => [
          input.dataset.mediaSetting,
          input.checked,
        ]),
      ),
      reviewSettings = {
        showReviews: $("#review-show")?.checked ?? true,
        showRating: $("#rating-show")?.checked ?? true,
        showImages: $("#review-images-show")?.checked ?? true,
        limit: Number($("#review-limit")?.value || 6),
      },
      payload = {
        hero: {
          headline: $("#page-headline").value,
          subheadline: $("#page-subheadline").value,
        },
        ctaText: $("#page-cta-text").value,
        checkoutAction,
        redirectUrl,
        editorSections,
        mediaSettings,
        reviewSettings,
        sections: customSections,
      };
    try {
      await api(`/api/stores/${storeId}/pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (publish)
        await api(`/api/stores/${storeId}/pages/${page.id}/publish`, {
          method: "POST",
          body: "{}",
        });
      await refreshWorkspace();
      toast(publish ? "Page published" : "Page saved");
      productPageEditor(page.id);
    } catch (error) {
      toast(error.message);
    }
  }
  function addProductPageSection(page, pageContent) {
    const existing = new Set(
      [...document.querySelectorAll(".page-section-card")].map(
        (card) => card.dataset.sectionId,
      ),
    );
    const options = [
      ...corePageSections.map(([id, label]) => ({
        id,
        label,
        connected: true,
      })),
      ...["Image", "GIF", "Video", "Text", "Custom Content"].map((label) => ({
        id: slugify(label),
        label,
        connected: false,
      })),
    ].filter((option) => !option.connected || !existing.has(option.id));
    modalContent.innerHTML = `<h2>Add Section</h2><label class="field">Section<select name="sectionType">${options.map((option) => `<option value="${option.id}" data-connected="${option.connected ? "true" : "false"}">${esc(option.label)}</option>`).join("")}</select></label><button class="primary" type="submit">Add Section</button>`;
    $("#modal-form").onsubmit = async (event) => {
      event.preventDefault();
      const select = event.currentTarget.elements.sectionType,
        option = select.selectedOptions[0],
        id = select.value,
        editorSections = [
          ...pageEditorSections(page, pageContent),
          {
            id: id + "-" + Date.now(),
            type: id,
            label: option.textContent,
            visible: true,
            connected: option.dataset.connected === "true",
          },
        ];
      if (option.dataset.connected === "true")
        editorSections[editorSections.length - 1].id = id;
      try {
        await api(`/api/stores/${storeId}/pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify({ editorSections }),
        });
        modal.close();
        await refreshWorkspace();
        productPageEditor(page.id);
      } catch (error) {
        toast(error.message);
      }
    };
    modal.showModal();
  }

  function editPageForm(id) {
    productPageEditor(id);
  }
  return { allProductsView, createProductEditor, pagesView, editPageForm };
})();
({ allProductsView, createProductEditor, pagesView, editPageForm } =
  productPageOverrides);

const simplifiedProductPages = (() => {
  const methods = [
    ["default", "Default Product Page"],
    ["template", "Choose Template"],
    ["upload", "Upload Pre-Built Page"],
    ["blank", "Build From Scratch"],
    ["ai", "Create With AI"],
  ];
  const methodLabels = {
    default: "Default",
    template: "Template",
    upload: "Uploaded",
    blank: "Blank",
    ai: "AI",
  };
  const categories = [
    "All",
    "General",
    "Single Product",
    "Long Form",
    "Minimal",
  ];
  const sectionDefinitions = [
    ["header", "Header", true],
    ["announcement-bar", "Announcement Bar", false],
    ["product-media", "Product Media", true],
    ["product-information", "Product Title & Price", true],
    ["description", "Product Description", true],
    ["bundle", "Product Options / Bundles", true],
    ["checkout-button", "Checkout Button", true],
    ["urgency", "Urgency", false],
    ["reviews", "Reviews", true],
    ["policies-footer", "Footer / Policy", true],
  ];
  const configSectionIds = new Set([
    "urgency",
    "announcement-bar",
    "checkout-button",
  ]);
  const sectionLabel = (type) =>
    sectionDefinitions.find(([id]) => id === type)?.[1] ||
    String(type || "custom-content")
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  const makeSlug = (value) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const productPageSlugExists = (slug, exceptPageId = null) =>
    data.pages.some(
      (page) =>
        page.id !== exceptPageId &&
        [page.slug, page.liveSlug].filter(Boolean).includes(slug),
    );
  const availableProductPageSlug = (value, exceptPageId = null) => {
    const base = makeSlug(value) || "product-page";
    if (!productPageSlugExists(base, exceptPageId)) return base;
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!productPageSlugExists(candidate, exceptPageId)) return candidate;
    }
    return `${base}-${Date.now()}`;
  };
  const productById = (id) =>
    data.products.find((product) => product.id === Number(id));
  const clonePersonalSections = (sections) =>
    JSON.parse(JSON.stringify(Array.isArray(sections) ? sections : [])).map(
      (section, index) => ({
        ...section,
        id:
          section.id ||
          `${section.type || "section"}-${Date.now()}-${index + 1}`,
      }),
    );
  async function refresh() {
    [data, ops, templates, aiState] = await Promise.all([
      api(`/api/stores/${storeId}/dashboard`),
      api(`/api/stores/${storeId}/product-operations`),
      api("/api/page-templates"),
      api(`/api/stores/${storeId}/ai-page-status`),
    ]);
  }

  function allProductsView() {
    const el = $("#product-section");
    setPageHeader(
      "Manage product information shared with every connected product page.",
      '<button class="primary" id="header-add-product">+ Add Product</button>',
    );
    const productRows = data.products
        .map(
          (product) =>
            `<tr data-product-row data-search="${esc(`${product.name} ${product.slug}`.toLowerCase())}"><td><button type="button" class="edit-product product-name-action" data-id="${product.id}">${esc(product.name)}</button><br><small>/${esc(product.slug)}</small></td><td>${rupees(product.pricePaise)}${product.comparePricePaise ? `<br><small><s>${rupees(product.comparePricePaise)}</s></small>` : ""}</td><td>${product.stock}</td><td><span class="status-badge ${product.active ? "is-active" : "is-draft"}">${product.active ? "Active" : "Draft"}</span></td><td class="row-menu-cell"><details class="row-menu"><summary aria-label="Actions for ${esc(product.name)}">⋯</summary><div><button class="edit-product" data-id="${product.id}" type="button">Edit Product</button><button class="product-page-action" data-product="${product.id}" type="button">Manage Pages</button></div></details></td></tr>`,
        )
        .join(""),
      productCards = data.products
        .map(
          (product) =>
            `<article class="product-mobile-card" data-product-row data-search="${esc(`${product.name} ${product.slug}`.toLowerCase())}"><header><div><button type="button" class="edit-product product-name-action" data-id="${product.id}">${esc(product.name)}</button><small>/${esc(product.slug)}</small></div><details class="row-menu"><summary aria-label="Actions for ${esc(product.name)}">⋯</summary><div><button class="edit-product" data-id="${product.id}" type="button">Edit Product</button><button class="product-page-action" data-product="${product.id}" type="button">Manage Pages</button></div></details></header><dl><div><dt>Price</dt><dd>${rupees(product.pricePaise)}</dd></div><div><dt>Inventory</dt><dd>${product.stock}</dd></div><div><dt>Status</dt><dd><span class="status-badge ${product.active ? "is-active" : "is-draft"}">${product.active ? "Active" : "Draft"}</span></dd></div></dl></article>`,
        )
        .join("");
    el.innerHTML = `<section class="panel list-panel"><div class="table-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="product-search" type="search" aria-label="Search products" placeholder="Search products..."></label></div>${
      data.products.length
        ? `<div class="table-scroll product-desktop-list"><table class="merchant-table"><thead><tr><th>PRODUCT</th><th>PRICE</th><th>INVENTORY</th><th>STATUS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${productRows}</tbody></table></div><div class="product-mobile-list">${productCards}</div>`
        : empty("No products yet. Add a product first.")
    }</section>`;
    $("#header-add-product").onclick = () => navigateTo("/products/new");
    const resultCount = document.createElement('small');
    resultCount.className = 'product-result-count';
    resultCount.setAttribute('role', 'status');
    resultCount.textContent = `${data.products.length} products`;
    el.querySelector('.table-toolbar').append(resultCount);
    const noMatches = document.createElement('p');
    noMatches.className = 'empty';
    noMatches.textContent = 'No matching products. Try a different name.';
    noMatches.hidden = true;
    el.querySelector('.list-panel').append(noMatches);
    $("#product-search").oninput = (event) => {
      const query = event.target.value.trim().toLowerCase();
      document.querySelectorAll("[data-product-row]").forEach((row) => {
        row.hidden = query && !row.dataset.search.includes(query);
      });
      const count = data.products.filter(product => `${product.name} ${product.slug}`.toLowerCase().includes(query)).length;
      resultCount.textContent = `${count} ${count === 1 ? 'product' : 'products'}`;
      noMatches.hidden = !data.products.length || count > 0;
    };
    document
      .querySelectorAll(".edit-product")
      .forEach(
        (button) =>
          (button.onclick = () =>
            navigateTo(`/products/${Number(button.dataset.id)}`)),
      );
    document
      .querySelectorAll(".product-page-action")
      .forEach(
        (button) =>
          (button.onclick = () =>
            navigateTo(
              `/product-pages?productId=${Number(button.dataset.product)}`,
            )),
      );
  }

  function createProductEditor(productId = null) {
    const product = productId ? productById(productId) : null;
    if (productId && !product)
      return navigateTo("/products", { replace: true });
    const storefrontProduct = data.storefront?.products?.find(
        (item) => item.id === product?.id,
      ),
      existingMedia = [
        storefrontProduct?.media?.main,
        ...(storefrontProduct?.media?.additional || []),
        storefrontProduct?.media?.gif,
        ...(storefrontProduct?.media?.videos || []),
      ].filter(Boolean),
      mediaCards = existingMedia.length
        ? existingMedia
            .map(
              (item) =>
                `<figure class="product-media-card">${item.type?.startsWith("video/") ? `<video src="${item.dataUrl}" controls></video>` : `<img src="${item.dataUrl}" alt="${esc(item.name)}">`}<figcaption>${esc(item.name)}</figcaption></figure>`,
            )
            .join("")
        : '<p class="muted">No product media uploaded yet.</p>';
    $("#page-title").textContent = product ? "Edit Product" : "Add Product";
    setPageHeader(
      "Product information is shared automatically with connected product pages.",
      '<button class="secondary" type="button" id="back-products">Cancel</button><button class="primary" type="submit" form="product-editor">Save Product</button>',
    );
    content.innerHTML = `<form id="product-editor" class="product-editor compact-form"><section class="panel form-section"><div class="section-heading"><h2>Product Information</h2><p>Core product content used throughout the store.</p></div><label class="field">Product Title *<input name="name" value="${esc(product?.name || "")}" required autofocus></label><label class="field">URL Slug *<input name="slug" value="${esc(product?.slug || "")}" required></label><label class="field">Description *<textarea name="description" rows="6" required>${esc(product?.description || "")}</textarea></label></section><section class="panel form-section"><div class="panel-head"><div class="section-heading"><h2>Media</h2><p>Images, GIFs, and videos shared with connected pages.</p></div>${product && existingMedia.length ? '<button class="secondary" type="button" id="clear-product-media">Remove All</button>' : ""}</div><div class="product-media-grid">${mediaCards}</div><label class="file-drop product-media-drop" id="product-media-drop"><strong>Upload Media</strong><span>Drag and drop images, GIF, MP4, or WebM files</span><input name="media" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" multiple hidden></label><div class="product-media-grid" id="new-product-media"></div><p class="helper-text">Choosing files replaces the current media after Save. Up to 6 additional images, 1 GIF, and 2 videos.</p></section><div class="form-section-grid"><section class="panel form-section"><div class="section-heading"><h2>Pricing</h2></div><label class="field">Price (${esc(data?.store?.currency || "Currency")}) *<input name="price" type="number" min="0" step="0.01" value="${product ? (product.pricePaise / 100).toFixed(2) : ""}" required></label><label class="field">Compare-at Price (${esc(data?.store?.currency || "Currency")})<input name="comparePrice" type="number" min="0" step="0.01" value="${product?.comparePricePaise ? (product.comparePricePaise / 100).toFixed(2) : ""}"></label></section><section class="panel form-section"><div class="section-heading"><h2>Inventory</h2></div><label class="field">Quantity *<input name="stock" type="number" min="0" value="${product?.stock ?? 0}" required></label><label class="field">Status<select name="status"><option value="active" ${product?.active !== 0 ? "selected" : ""}>Active</option><option value="draft" ${product?.active === 0 ? "selected" : ""}>Draft</option></select></label></section></div></form>`;
    $("#back-products").onclick = () => navigateTo("/products");
    const form = $("#product-editor"),
      mediaInput = form.elements.media,
      mediaDrop = $("#product-media-drop"),
      newMedia = $("#new-product-media"),
      drawSelectedMedia = () => {
        newMedia.innerHTML = [...mediaInput.files]
          .map((file) => {
            const source = URL.createObjectURL(file);
            return `<figure class="product-media-card">${file.type.startsWith("video/") ? `<video src="${source}" controls></video>` : `<img src="${source}" alt="${esc(file.name)}">`}<figcaption>${esc(file.name)}</figcaption></figure>`;
          })
          .join("");
      };
    mediaInput.onchange = drawSelectedMedia;
    mediaDrop.ondragover = (event) => {
      event.preventDefault();
      mediaDrop.classList.add("dragging");
    };
    mediaDrop.ondragleave = () => mediaDrop.classList.remove("dragging");
    mediaDrop.ondrop = (event) => {
      event.preventDefault();
      mediaDrop.classList.remove("dragging");
      const transfer = new DataTransfer();
      [...event.dataTransfer.files].forEach((file) => transfer.items.add(file));
      mediaInput.files = transfer.files;
      drawSelectedMedia();
    };
    if ($("#clear-product-media"))
      $("#clear-product-media").onclick = async () => {
        if (!confirm("Remove all product media?")) return;
        try {
          await api(`/api/stores/${storeId}/products/${product.id}/media`, {
            method: "PATCH",
            body: JSON.stringify({ clear: true }),
          });
          await refresh();
          toast("Product media removed");
          createProductEditor(product.id);
        } catch (error) {
          toast(error.message);
        }
      };
    $("#product-editor").onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget)),
        payload = {
          name: values.name,
          slug: values.slug,
          description: values.description,
          pricePaise: Math.round(Number(values.price) * 100),
          comparePricePaise: values.comparePrice
            ? Math.round(Number(values.comparePrice) * 100)
            : null,
          stock: Number(values.stock),
          status: values.status,
        };
      try {
        const saved = product
          ? await api(`/api/stores/${storeId}/products/${product.id}`, {
              method: "PATCH",
              body: JSON.stringify(payload),
            })
          : await api(`/api/stores/${storeId}/products`, {
              method: "POST",
              body: JSON.stringify(payload),
            });
        const files = [...mediaInput.files];
        if (files.length) {
          const images = files.filter((file) =>
              ["image/jpeg", "image/png", "image/webp"].includes(file.type),
            ),
            gif = files.find((file) => file.type === "image/gif"),
            videos = files.filter((file) => file.type.startsWith("video/")),
            asset = async (file) =>
              file
                ? {
                    name: file.name,
                    type: file.type,
                    data: await fileToBase64(file),
                  }
                : null;
          await api(`/api/stores/${storeId}/products/${saved.id}/media`, {
            method: "PATCH",
            body: JSON.stringify({
              mainImage: await asset(images[0]),
              additionalImages: await Promise.all(images.slice(1).map(asset)),
              productGif: await asset(gif),
              productVideos: await Promise.all(videos.map(asset)),
            }),
          });
        }
        await refresh();
        toast(
          product
            ? "Product updated — connected pages refreshed"
            : "Product saved",
        );
        navigateTo("/products");
      } catch (error) {
        toast(error.message);
      }
    };
  }

  function pagesView() {
    if (location.pathname !== "/product-pages")
      return navigateTo("/product-pages");
    const requestedProductId = Number(
        new URLSearchParams(location.search).get("productId"),
      ),
      selectedProduct = productById(requestedProductId),
      productPages = selectedProduct
        ? data.pages.filter((page) => page.productId === selectedProduct.id)
        : data.pages;
    const pageActions = (page) =>
        `<details class="row-menu"><summary aria-label="Actions for ${esc(page.title)}">⋯</summary><div><button class="edit-page" data-id="${page.id}" type="button">Edit</button><a target="_blank" href="/api/stores/${storeId}/pages/${page.id}/preview">Preview</a>${page.status === "published" ? `<a target="_blank" href="${esc(storeUrl(encodeURIComponent(page.liveSlug || page.slug)))}">View Live</a>` : ""}<button type="button" data-page-rename="${page.id}">Rename</button><button type="button" data-page-duplicate="${page.id}">Duplicate</button>${page.status === "published" ? `<button type="button" data-page-unpublish="${page.id}">Unpublish</button>` : ""}<button class="danger-text" type="button" data-page-delete="${page.id}">Delete</button></div></details>`,
      pageRows = productPages
        .map(
          (page) =>
            `<tr><td><strong>${esc(page.title)}</strong></td><td>${esc(page.productName)}</td><td><small>${esc(storeUrl(encodeURIComponent(page.liveSlug || page.slug)))}</small></td><td>${esc(methodLabels[page.creationMethod] || "Legacy")}</td><td><span class="status-badge ${page.status === "published" ? "is-active" : "is-draft"}">${page.status === "published" ? "Published" : "Draft"}</span></td><td class="row-menu-cell">${pageActions(page)}</td></tr>`,
        )
        .join(""),
      pageCards = productPages
        .map(
          (page) =>
            `<article class="product-page-mobile-card"><header><div><strong>${esc(page.title)}</strong><small>${esc(page.productName)}</small></div>${pageActions(page)}</header><code>${esc(storeUrl(encodeURIComponent(page.liveSlug || page.slug)))}</code><dl><div><dt>Method</dt><dd>${esc(methodLabels[page.creationMethod] || "Legacy")}</dd></div><div><dt>Status</dt><dd><span class="status-badge ${page.status === "published" ? "is-active" : "is-draft"}">${page.status === "published" ? "Published" : "Draft"}</span></dd></div></dl></article>`,
        )
        .join("");
    setPageHeader(
      selectedProduct
        ? `Pages connected to ${selectedProduct.name}.`
        : "Create and manage the selling pages connected to your products.",
      `${selectedProduct ? '<button class="secondary" id="all-product-pages">All Product Pages</button>' : ""}<button class="primary" id="create-product-page" ${data.products.length ? "" : "disabled"}>+ Create Product Page</button>`,
    );
    content.innerHTML = `<section class="panel list-panel">${selectedProduct ? `<div class="list-context"><strong>${esc(selectedProduct.name)}</strong><span>${productPages.length} connected page${productPages.length === 1 ? "" : "s"}</span></div>` : ""}${productPages.length ? `<div class="table-scroll product-pages-desktop-list"><table class="merchant-table product-pages-table"><thead><tr><th>PAGE</th><th>PRODUCT</th><th>URL</th><th>METHOD</th><th>STATUS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${pageRows}</tbody></table></div><div class="product-pages-mobile-list">${pageCards}</div>` : empty(selectedProduct ? "No pages are connected to this product yet." : "No product pages yet. Create one from a connected product.")}</section>`;
    if ($("#all-product-pages"))
      $("#all-product-pages").onclick = () => navigateTo("/product-pages");
    $("#create-product-page").onclick = () =>
      createProductPageModal(selectedProduct?.id || null);
    document
      .querySelectorAll(".edit-page")
      .forEach(
        (button) =>
          (button.onclick = () =>
            navigateTo(`/product-pages/${Number(button.dataset.id)}/edit`)),
      );
    document.querySelectorAll("[data-page-duplicate]").forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            const duplicate = await api(
              `/api/stores/${storeId}/pages/${button.dataset.pageDuplicate}/duplicate`,
              { method: "POST", body: "{}" },
            );
            await refresh();
            toast(`Duplicated as “${duplicate.title}”`);
            pagesView();
          } catch (error) {
            toast(error.message);
          }
        }),
    );
    document.querySelectorAll("[data-page-unpublish]").forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            await api(
              `/api/stores/${storeId}/pages/${button.dataset.pageUnpublish}/unpublish`,
              { method: "POST", body: "{}" },
            );
            await refresh();
            toast("Page unpublished");
            pagesView();
          } catch (error) {
            toast(error.message);
          }
        }),
    );
    document
      .querySelectorAll("[data-page-rename]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            renameProductPage(
              data.pages.find(
                (page) => page.id === Number(button.dataset.pageRename),
              ),
            )),
      );
    document
      .querySelectorAll("[data-page-delete]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            deleteProductPage(
              data.pages.find(
                (page) => page.id === Number(button.dataset.pageDelete),
              ),
            )),
      );
  }

  function renameProductPage(page) {
    if (!page) return;
    modalContent.innerHTML = `<h2>Rename Product Page</h2><label class="field">Page Name *<input name="title" value="${esc(page.title)}" minlength="3" required autofocus></label><label class="field">URL Slug *<input name="slug" value="${esc(page.slug)}" minlength="3" pattern="[a-z0-9-]+" required><small>Must be unique for this store.</small></label><div class="modal-actions"><button class="secondary" id="cancel-page-rename" type="button">Cancel</button><button class="primary" type="submit">Save Changes</button></div>`;
    $("#cancel-page-rename").onclick = () => modal.close();
    $("#modal-form").onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      if (productPageSlugExists(makeSlug(values.slug), page.id))
        return toast(
          `/${makeSlug(values.slug)} is already used. Try /${availableProductPageSlug(
            values.slug,
            page.id,
          )}.`,
        );
      try {
        await api(`/api/stores/${storeId}/pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify(values),
        });
        modal.close();
        await refresh();
        toast("Product page renamed");
        pagesView();
      } catch (error) {
        toast(
          /URL is already being used/i.test(error.message)
            ? "That page URL is already used. Change the URL slug and try again."
            : error.message,
        );
      }
    };
    modal.showModal();
  }

  function deleteProductPage(page) {
    if (!page) return;
    modalContent.innerHTML = `<div class="delete-page-confirm"><h2>Delete Product Page?</h2><p>Page Name: <strong>${esc(page.title)}</strong></p><p class="notice">This action cannot be undone. The connected product will not be deleted.</p><div class="modal-actions"><button class="secondary" id="cancel-page-delete" type="button">Cancel</button><button class="danger" type="submit">Delete Page</button></div></div>`;
    $("#cancel-page-delete").onclick = () => modal.close();
    $("#modal-form").onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api(`/api/stores/${storeId}/pages/${page.id}`, {
          method: "DELETE",
        });
        modal.close();
        await refresh();
        toast("Product page deleted");
        pagesView();
      } catch (error) {
        toast(error.message);
      }
    };
    modal.showModal();
  }

  function createProductPageModal(productId = null) {
    const product = productById(productId) || data.products[0];
    const availableMethods = methods.filter(
      ([id]) => id !== "ai" || aiState.available,
      ),
      defaultSlug = availableProductPageSlug(
        product?.slug || product?.name || "",
      );
    modalContent.innerHTML = `<div class="simple-create-modal"><h2>Create Product Page</h2><p class="muted">Choose the page starting point. Product content loads automatically.</p><label class="field">Page Name *<input name="title" value="${esc(product?.name || "")}" minlength="3" required autofocus></label><label class="field">Connected Product *<select name="productId" required>${data.products.map((item) => `<option value="${item.id}" ${item.id === product?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><fieldset class="creation-methods"><legend>Creation Method *</legend>${availableMethods.map(([id, label], index) => `<label class="choice"><input type="radio" name="creationMethod" value="${id}" ${index === 0 ? "checked" : ""}><span><b>${label}</b></span></label>`).join("")}</fieldset><label class="field">URL Slug<div class="slug-input"><span>/products/</span><input name="slug" value="${esc(defaultSlug)}" minlength="3" pattern="[a-z0-9-]+" required></div><small>Must be unique for this store.</small></label><fieldset class="status-choice"><legend>Status</legend><label><input type="radio" name="status" value="draft" checked> Draft</label><label><input type="radio" name="status" value="published"> Published</label></fieldset><div class="modal-actions"><button class="secondary" id="cancel-create-page" type="button">Cancel</button><button class="primary" type="submit">Create Page</button></div></div>`;
    const form = $("#modal-form"),
      productSelect = form.elements.productId,
      title = form.elements.title,
      slug = form.elements.slug;
    productSelect.onchange = () => {
      const selected = productById(productSelect.value);
      title.value = selected?.name || "";
      slug.value = availableProductPageSlug(selected?.slug || title.value);
      delete slug.dataset.edited;
    };
    title.oninput = () => {
      if (!slug.dataset.edited) slug.value = availableProductPageSlug(title.value);
    };
    slug.oninput = () => (slug.dataset.edited = "true");
    $("#cancel-create-page").onclick = () => modal.close();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)),
        context = {
          title: values.title,
          productId: Number(values.productId),
          slug: values.slug,
          status: values.status,
        };
      if (productPageSlugExists(makeSlug(context.slug)))
        return toast(
          `/${makeSlug(context.slug)} is already used. Try /${availableProductPageSlug(
            context.slug,
          )}.`,
        );
      modal.close();
      if (values.creationMethod === "template") return templateGallery(context);
      if (values.creationMethod === "upload") return uploadWizard(context);
      if (values.creationMethod === "ai") return aiWizard(context);
      try {
        const page = await createPageRequest(
          {
            ...context,
            templateKey:
              values.creationMethod === "default" ? "warm-story" : undefined,
            ctaText: "Buy Now",
            ctaAction: "direct",
            codEnabled: true,
          },
          values.creationMethod,
        );
        await refresh();
        productPageEditor(page.id);
      } catch (error) {
        toast(
          /URL is already being used/i.test(error.message)
            ? "That page URL is already used. Change the URL slug and try again."
            : error.message,
        );
      }
    };
    modal.showModal();
  }

  function templateGallery(context, category = "All") {
    const personalTemplates = JSON.parse(
        localStorage.getItem(`commera2-page-templates-${storeId}`) || "[]",
      ).map((template) => ({
        ...template,
        key: template.id,
        category: "My Templates",
        description: `Saved visual layout · ${new Date(template.savedAt).toLocaleDateString("en-IN")}`,
        preview: "Your reusable visual page layout",
        designTokens: {
          background: template.pageSettings?.backgroundColor || "#f5f3ec",
          text: template.pageSettings?.textColor || "#17201b",
          accent: template.pageSettings?.primaryColor || "#173e34",
        },
        personal: true,
      })),
      availableTemplates = [...templates, ...personalTemplates],
      visibleTemplates = availableTemplates.filter(
        (template) => category === "All" || template.category === category,
      );
    modalContent.innerHTML = `<div class="template-gallery-head"><div><h2>Choose Template</h2><p>Preview a layout, then use it with ${esc(productById(context.productId)?.name || "the connected product")}.</p></div></div><div class="template-categories">${categories.map((item) => `<button type="button" data-template-category="${item}" class="${item === category ? "active" : ""}">${item}</button>`).join("")}</div><div class="template-gallery">${visibleTemplates.map((template) => `<article class="template-card" style="--preview-bg:${template.designTokens.background};--preview-text:${template.designTokens.text};--preview-accent:${template.designTokens.accent}"><div class="template-preview"><i></i><strong>${esc(template.name)}</strong><span></span><button type="button" tabindex="-1"></button></div><h3>${esc(template.name)}</h3><p>${esc(template.description)}</p><span class="pill">${esc(template.category)}</span><div class="template-actions"><button class="secondary preview-template" type="button" data-key="${template.key}">Preview</button><button class="primary use-template" type="button" data-key="${template.key}">Use Template</button></div></article>`).join("")}</div>`;
    $("#modal-form").onsubmit = (event) => event.preventDefault();
    document
      .querySelectorAll("[data-template-category]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            templateGallery(context, button.dataset.templateCategory)),
      );
    document.querySelectorAll(".preview-template").forEach(
      (button) =>
        (button.onclick = () => {
          const template = availableTemplates.find(
              (item) => item.key === button.dataset.key,
            ),
            old = $(".template-inline-preview");
          if (old) old.remove();
          $(".template-gallery-head").insertAdjacentHTML(
            "beforeend",
            `<div class="template-inline-preview" style="background:${template.designTokens.background};color:${template.designTokens.text};border-color:${template.designTokens.accent}"><span>${esc(template.category)}</span><h3>${esc(template.name)}</h3><p>${esc(template.preview)}</p></div>`,
          );
        }),
    );
    document.querySelectorAll(".use-template").forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            const selectedTemplate = availableTemplates.find(
                (item) => item.key === button.dataset.key,
              ),
              page = await createPageRequest(
                {
                  ...context,
                  templateKey: selectedTemplate.personal
                    ? undefined
                    : button.dataset.key,
                  ctaText: "Buy Now",
                  ctaAction: "direct",
                },
                selectedTemplate.personal ? "blank" : "template",
              );
            if (selectedTemplate.personal) {
              const copiedSections = clonePersonalSections(
                  selectedTemplate.editorSections,
                ),
                sectionSettings = Object.fromEntries(
                  copiedSections.map((section) => [
                    section.id,
                    section.settings || {},
                  ]),
                );
              await api(`/api/stores/${storeId}/pages/${page.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  editorSections: copiedSections.map((section) => ({
                    id: section.id,
                    type: section.type,
                    label: section.label,
                    connected: section.connected === true,
                    visible: section.settings?.visible !== false,
                  })),
                  sectionSettings,
                  pageSettings: selectedTemplate.pageSettings || {},
                }),
              });
            }
            modal.close();
            await refresh();
            productPageEditor(page.id);
          } catch (error) {
            toast(error.message);
          }
        }),
    );
    if (!modal.open) modal.showModal();
  }

  function uploadWizard(context) {
    modalContent.innerHTML = `<h2>Upload Pre-Built Page</h2><p class="muted">${esc(context.title)} is already connected. Upload and inspect the page before opening the editor.</p><div class="quick-flow"><div class="step"><b>01</b>Upload</div><div class="step"><b>02</b>Process</div><div class="step"><b>03</b>Preview</div><div class="step"><b>04</b>Open Editor</div></div><label class="field">HTML File *<input name="file" type="file" accept=".html,.htm,text/html" required></label><button class="secondary" id="process-product-page" type="button">Process & Preview</button><div id="product-import-preview" hidden><iframe title="Processed page preview" sandbox></iframe><button class="primary" type="submit">Create Page</button></div>`;
    const form = $("#modal-form");
    let processed = null;
    $("#process-product-page").onclick = async () => {
      try {
        const file = form.elements.file.files[0];
        if (!file) throw Error("HTML File is required");
        processed = {
          fileName: file.name,
          mimeType: file.type || "text/html",
          fileContentBase64: await fileToBase64(file),
        };
        const result = await api(
            `/api/stores/${storeId}/page-imports/preview`,
            { method: "POST", body: JSON.stringify(processed) },
          ),
          preview = $("#product-import-preview");
        showImportedPreview(preview, result);
      } catch (error) {
        toast(error.message);
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!processed)
        return toast("Process and preview the uploaded file first");
      try {
        const page = await createPageRequest(
          { ...context, ...processed, ctaText: "Buy Now", codEnabled: true },
          "upload",
        );
        modal.close();
        await refresh();
        productPageEditor(page.id);
      } catch (error) {
        toast(error.message);
      }
    };
    modal.showModal();
  }

  function aiWizard(context) {
    if (!aiState.available) return;
    modalContent.innerHTML = `<h2>AI Product Page Generator</h2><p class="muted">The generated sections remain editable in the same Product Page Editor.</p><label class="field">Instructions *<textarea name="brief" rows="6" required placeholder="Describe the desired tone, audience, and page structure."></textarea></label><button class="primary" type="submit">Generate Page</button>`;
    $("#modal-form").onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const page = await createPageRequest(
          { ...context, brief: values.brief, ctaText: "Buy Now" },
          "ai",
        );
        modal.close();
        await refresh();
        productPageEditor(page.id);
      } catch (error) {
        toast(error.message);
      }
    };
    modal.showModal();
  }

  function editorSections(page, pageContent) {
    const stored = Array.isArray(pageContent.editorSections)
      ? pageContent.editorSections
      : [];
    if (page.creationMethod === "blank" && !stored.length) return [];
    const sections = stored
      .filter(
        (section) =>
          !["social-proof", "proof", "testimonials", "rating"].includes(
            section.type || section.id,
          ),
      )
      .map((section) => {
        const definition = sectionDefinitions.find(([id]) => id === section.id);
        return {
          ...section,
          label: definition?.[1] || section.label,
        };
      });
    for (const [id, label, connected] of sectionDefinitions) {
      if (!sections.some((section) => section.id === id))
        sections.push({
          id,
          type: id,
          label,
          connected,
          visible:
            id === "urgency"
              ? Boolean(pageContent.urgency?.enabled)
              : id === "announcement-bar"
                ? Boolean(pageContent.announcement)
                : true,
        });
    }
    return sections;
  }

  function productPageEditor(pageId) {
    const editorPath = `/product-pages/${Number(pageId)}/edit`;
    if (location.pathname !== editorPath) return navigateTo(editorPath);
    openVisualProductPageBuilder(pageId, {
      refresh,
      pagesView,
      productById,
      editorSections,
    });
  }

  function sectionCard(section, index, ctx) {
    const id = section.id,
      type = section.type || id,
      connected = section.connected === true,
      visible = section.visible !== false;
    let settings = "";
    if (id === "product-media")
      settings = `<div class="section-settings" hidden>${[
        ["mainImage", "Main Image"],
        ["imageGallery", "Image Gallery"],
        ["gif", "GIF"],
        ["video", "Video"],
      ]
        .map(
          ([key, label]) =>
            `<label class="field checkbox"><input data-media-setting="${key}" type="checkbox" ${ctx.media[key] ? "checked" : ""}> <span>${label}</span></label>`,
        )
        .join("")}</div>`;
    else if (id === "reviews")
      settings = `<div class="section-settings" hidden><label class="field checkbox"><input id="review-show" type="checkbox" ${ctx.reviews.showReviews ? "checked" : ""}> <span>Show Reviews</span></label><label class="field checkbox"><input id="rating-show" type="checkbox" ${ctx.reviews.showRating ? "checked" : ""}> <span>Show Rating</span></label><label class="field checkbox"><input id="review-images-show" type="checkbox" ${ctx.reviews.showImages ? "checked" : ""}> <span>Show Images</span></label><label class="field">Number to Display<input id="review-limit" type="number" min="1" max="50" value="${ctx.reviews.limit}"></label></div>`;
    else if (id === "social-proof")
      settings = `<div class="section-settings" hidden><label class="field">Source<select id="social-proof-source"><option value="approved-reviews">Approved Reviews</option></select></label><p class="muted">Only approved reviews are used as customer proof.</p></div>`;
    else if (id === "urgency")
      settings = `<div class="section-settings" hidden><label class="field">Type<select id="urgency-type"><option value="limited-stock" ${ctx.pageContent.urgency?.type === "limited-stock" ? "selected" : ""}>Limited Stock</option><option value="limited-time" ${ctx.pageContent.urgency?.type === "limited-time" ? "selected" : ""}>Limited Time</option><option value="high-demand" ${ctx.pageContent.urgency?.type === "high-demand" ? "selected" : ""}>High Demand</option></select></label><label class="field">Message<input id="urgency-message" value="${esc(ctx.pageContent.urgency?.text || "Only {stock} left")}"></label></div>`;
    else if (id === "announcement-bar")
      settings = `<div class="section-settings" hidden><label class="field">Message<input id="announcement-message" value="${esc(ctx.pageContent.announcement || "Add an announcement")}"></label></div>`;
    else if (id === "checkout-button")
      settings = `<div class="section-settings" hidden><label class="field">Button Text<input id="checkout-button-text" value="${esc(ctx.pageContent.ctaText || "Buy Now")}" required></label><label class="field">Action<select id="checkout-button-action"><option value="direct" ${!["cart", "redirect"].includes(ctx.pageContent.checkoutAction) ? "selected" : ""}>Direct Checkout</option><option value="cart" ${ctx.pageContent.checkoutAction === "cart" ? "selected" : ""}>Add To Cart</option><option value="redirect" ${ctx.pageContent.checkoutAction === "redirect" ? "selected" : ""}>Redirect</option></select></label><label class="field checkout-redirect" ${ctx.pageContent.checkoutAction === "redirect" ? "" : "hidden"}>Redirect URL<input id="checkout-redirect-url" type="url" value="${esc(ctx.pageContent.redirectUrl || "")}"></label></div>`;
    else if (connected)
      settings = `<div class="section-settings" hidden><p class="notice">Connected to ${esc(ctx.product.name)}. Edit this value from Products.</p></div>`;
    else
      settings = `<div class="section-settings" hidden><label class="field">Heading<input data-section-title value="${esc(section.title || section.label || "Custom Content")}"></label><label class="field">Content<textarea data-section-body>${esc(section.body || "")}</textarea></label></div>`;
    return `<article class="page-section-card" data-section-id="${esc(id)}" data-section-type="${esc(type)}" data-connected="${connected ? "true" : "false"}" data-configurable="${configSectionIds.has(id) ? "true" : "false"}"><div><span class="section-order">${index + 1}</span><strong>${esc(section.label || sectionLabel(type))}</strong>${connected ? "<small>Connected</small>" : ""}</div><label class="section-visible"><input type="checkbox" ${visible ? "checked" : ""}> ${configSectionIds.has(id) ? "On" : "Show"}</label><div class="section-card-actions"><button class="tiny section-up" type="button" aria-label="Move up">↑</button><button class="tiny section-down" type="button" aria-label="Move down">↓</button><button class="secondary section-edit" type="button">Edit</button></div>${settings}</article>`;
  }

  function wireSectionButtons() {
    const list = $("#page-section-list"),
      renumber = () =>
        [...list.querySelectorAll(".page-section-card")].forEach(
          (card, index) =>
            (card.querySelector(".section-order").textContent = index + 1),
        );
    list.querySelectorAll(".section-edit").forEach(
      (button) =>
        (button.onclick = () => {
          const settings = button
            .closest(".page-section-card")
            .querySelector(".section-settings");
          settings.hidden = !settings.hidden;
        }),
    );
    list.querySelectorAll(".section-up").forEach(
      (button) =>
        (button.onclick = () => {
          const card = button.closest(".page-section-card");
          if (card.previousElementSibling)
            list.insertBefore(card, card.previousElementSibling);
          renumber();
        }),
    );
    list.querySelectorAll(".section-down").forEach(
      (button) =>
        (button.onclick = () => {
          const card = button.closest(".page-section-card");
          if (card.nextElementSibling)
            list.insertBefore(card.nextElementSibling, card);
          renumber();
        }),
    );
    const action = $("#checkout-button-action");
    if (action)
      action.onchange = () =>
        ($(".checkout-redirect").hidden = action.value !== "redirect");
  }

  async function saveEditor(page, pageContent, publish) {
    const cards = [...document.querySelectorAll(".page-section-card")];
    const editorSections = cards.map((card) => ({
      id: card.dataset.sectionId,
      type: card.dataset.sectionType,
      label: card.querySelector("strong").textContent,
      visible: card.querySelector(".section-visible input").checked,
      connected: card.dataset.connected === "true",
      title: card.querySelector("[data-section-title]")?.value,
      body: card.querySelector("[data-section-body]")?.value,
    }));
    const customCards = cards.filter(
        (card) =>
          card.dataset.connected !== "true" &&
          card.dataset.configurable !== "true",
      ),
      customIds = new Set(customCards.map((card) => card.dataset.sectionId));
    const preserved = (pageContent.sections || []).filter(
      (section) => !section.editorCustom && !customIds.has(section.id),
    );
    const customSections = customCards.map((card) => ({
      id: card.dataset.sectionId,
      type: card.dataset.sectionType,
      title: card.querySelector("[data-section-title]")?.value,
      body: card.querySelector("[data-section-body]")?.value,
      visible: card.querySelector(".section-visible input").checked,
      editorCustom: true,
    }));
    const checkoutAction =
        $("#checkout-button-action")?.value ||
        pageContent.checkoutAction ||
        "direct",
      redirectUrl = $("#checkout-redirect-url")?.value.trim() || "";
    if (checkoutAction === "redirect" && !redirectUrl)
      return toast("Redirect URL is required");
    const sectionVisible = (id) =>
      editorSections.find((section) => section.id === id)?.visible !== false;
    const mediaSettings = Object.fromEntries(
      [...document.querySelectorAll("[data-media-setting]")].map((input) => [
        input.dataset.mediaSetting,
        input.checked,
      ]),
    );
    const reviewSettings = {
      showReviews: $("#review-show")?.checked ?? true,
      showRating: $("#rating-show")?.checked ?? true,
      showImages: $("#review-images-show")?.checked ?? true,
      limit: Number($("#review-limit")?.value || 6),
    };
    const urgencyEnabled =
      sectionVisible("urgency") &&
      Boolean(editorSections.find((section) => section.id === "urgency"));
    const payload = {
      editorSections,
      mediaSettings,
      reviewSettings,
      sections: [...preserved, ...customSections],
      socialProofEnabled: sectionVisible("social-proof"),
      socialProofType: "real",
      urgency: {
        enabled: urgencyEnabled,
        type: urgencyEnabled
          ? $("#urgency-type")?.value || "limited-stock"
          : "none",
        text: $("#urgency-message")?.value || "",
      },
      announcement: sectionVisible("announcement-bar")
        ? $("#announcement-message")?.value || ""
        : "",
      ctaText:
        $("#checkout-button-text")?.value || pageContent.ctaText || "Buy Now",
      checkoutAction,
      redirectUrl,
      thankYou: {
        headline:
          $("#thank-you-headline")?.value.trim() || "Thank you! Your order is confirmed.",
        body:
          $("#thank-you-message")?.value.trim() ||
          "Your order has been confirmed.",
        ctaText: $("#thank-you-button")?.value.trim() || "Continue shopping",
      },
    };
    try {
      await api(`/api/stores/${storeId}/pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (publish)
        await api(`/api/stores/${storeId}/pages/${page.id}/publish`, {
          method: "POST",
          body: "{}",
        });
      await refresh();
      toast(publish ? "Page published" : "Page saved");
      productPageEditor(page.id);
    } catch (error) {
      toast(error.message);
    }
  }

  function addSection(page, pageContent) {
    const existing = new Set(
      [...document.querySelectorAll(".page-section-card")].map(
        (card) => card.dataset.sectionId,
      ),
    );
    const options = [
      ...sectionDefinitions.map(([id, label, connected]) => ({
        id,
        label,
        connected,
      })),
      ...["Image", "GIF", "Video", "Text", "Custom Content"].map((label) => ({
        id: makeSlug(label),
        label,
        connected: false,
      })),
    ].filter(
      (option) =>
        !existing.has(option.id) ||
        !sectionDefinitions.some(([id]) => id === option.id),
    );
    modalContent.innerHTML = `<h2>Add Section</h2><label class="field">Section<select name="sectionType">${options.map((option) => `<option value="${option.id}" data-connected="${option.connected ? "true" : "false"}">${esc(option.label)}</option>`).join("")}</select></label><button class="primary" type="submit">Add Section</button>`;
    $("#modal-form").onsubmit = async (event) => {
      event.preventDefault();
      const select = event.currentTarget.elements.sectionType,
        option = select.selectedOptions[0],
        type = select.value,
        known = sectionDefinitions.find(([id]) => id === type),
        section = {
          id: known ? type : `${type}-${Date.now()}`,
          type,
          label: option.textContent,
          visible: true,
          connected: option.dataset.connected === "true",
        },
        next = [...editorSections(page, pageContent), section];
      try {
        await api(`/api/stores/${storeId}/pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify({ editorSections: next }),
        });
        modal.close();
        await refresh();
        productPageEditor(page.id);
      } catch (error) {
        toast(error.message);
      }
    };
    modal.showModal();
  }

  function editPageForm(id) {
    productPageEditor(id);
  }
  return { allProductsView, createProductEditor, pagesView, editPageForm };
})();
({ allProductsView, createProductEditor, pagesView, editPageForm } =
  simplifiedProductPages);

async function openVisualProductPageBuilder(pageId, helpers) {
  const { renderBlocks, blockSectionStyle } = await import('/page-blocks.js');
  document.body.classList.add("visual-builder-open");
  const page = data.pages.find((item) => item.id === Number(pageId));
  if (!page) return helpers.pagesView();
  productPageDirty = false;
  const connectedProduct = helpers.productById(page.productId),
    hasConnectedProduct = Boolean(connectedProduct),
    product = connectedProduct || {
      id: null,
      name: "Product Name",
      description: "",
      pricePaise: 0,
      comparePricePaise: null,
      stock: 0,
    },
    storefrontProduct = data.storefront?.products?.find(
      (item) => item.id === connectedProduct?.id,
    ),
    bundles = hasConnectedProduct
      ? data.bundles.filter((item) => item.productId === product.id)
      : [],
    approvedReviews = data.reviews.filter(
      (item) =>
        hasConnectedProduct &&
        item.productId === product.id &&
        item.status === "approved",
    );
  let pageContent = {};
  try {
    pageContent = JSON.parse(page.contentJson || "{}");
  } catch {}
  const clone = (value) => JSON.parse(JSON.stringify(value)),
    mobileBuilderMedia = matchMedia("(max-width: 767px)"),
    tabletBuilderMedia = matchMedia(
      "(min-width: 768px) and (max-width: 1199px)",
    ),
    storedSectionSettings = pageContent.sectionSettings || {},
    pageDefaults = {
      primaryColor: "#173e34",
      secondaryColor: "#d9f76f",
      textColor: "#17201b",
      backgroundColor: "#f5f3ec",
      buttonColor: "#173e34",
      headingFont: "Inter",
      bodyFont: "Inter",
      buttonFont: "Inter",
      pageWidth: "contained",
      maxWidth: 1200,
      borderRadius: 14,
      sectionSpacing: 18,
      imageRadius: 12,
      ...(pageContent.pageSettings || {}),
      thankYouAnimationEnabled: pageContent.thankYou?.animation?.enabled !== false,
      thankYouAnimationStyle: pageContent.thankYou?.animation?.style || "checkmark",
    },
    defaultSectionSettings = (section) => ({
      visible: section.visible !== false,
      desktop: true,
      mobile: true,
      width: "contained",
      alignment: "left",
      paddingTop: 20,
      paddingBottom: 20,
      paddingLeft: 20,
      paddingRight: 20,
      marginTop: 0,
      marginBottom: 0,
      backgroundColor: "transparent",
      textColor: "",
      borderRadius: 0,
      ...(storedSectionSettings[section.id] || {}),
    });
  let initialSections = helpers
    .editorSections(page, pageContent)
    .filter((section) => (section.type || section.id) !== "inline-checkout")
    .map((section) => ({
      ...section,
      type: section.type || section.id,
      settings: defaultSectionSettings(section),
    }));
  if (!initialSections.some((section) => section.type === "header")) {
    const header = {
      id: "header",
      type: "header",
      label: "Header",
      connected: true,
      visible: true,
    };
    initialSections.unshift({
      ...header,
      settings: {
        ...defaultSectionSettings(header),
        logoSource: "store-logo",
        logoText: "",
        logoWidth: 140,
        alignment: "center",
        sticky: false,
      },
    });
  }
  const builder = {
    sections: initialSections,
    selectedBlockId: null,
    selectedId: initialSections[0]?.id || "__page",
    viewport: mobileBuilderMedia.matches ? "mobile" : "desktop",
    mobileTab: "sections",
    tabletSettingsOpen: false,
    actionSectionId: null,
    pageSettings: pageDefaults,
    history: [],
    future: [],
    dirty: false,
  };
  const stateSnapshot = () =>
      clone({
        sections: builder.sections,
        selectedId: builder.selectedId,
        selectedBlockId: builder.selectedBlockId,
        pageSettings: builder.pageSettings,
      }),
    markBuilderDirty = () => {
      builder.dirty = true;
      productPageDirty = true;
      document.querySelectorAll("[data-builder-status]").forEach(
        (status) => (status.textContent = "Unsaved changes"),
      );
    },
    restore = (snapshot) => {
      builder.sections = snapshot.sections;
      builder.selectedId = snapshot.selectedId;
      builder.selectedBlockId = snapshot.selectedBlockId || null;
      builder.pageSettings = snapshot.pageSettings;
      markBuilderDirty();
      renderBuilder();
    },
    commit = (change) => {
      builder.history.push(stateSnapshot());
      if (builder.history.length > 50) builder.history.shift();
      builder.future = [];
      change();
      markBuilderDirty();
      renderBuilder();
    },
    selected = () =>
      builder.sections.find((section) => section.id === builder.selectedId),
    displayName = (section) =>
      section.label ||
      String(section.type || "Section")
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    sectionStyle = (section) => {
      const setting = section.settings;
      if (section.type === 'blocks') return blockSectionStyle(setting);
      return [
        `text-align:${setting.alignment || "left"}`,
        `padding:${Number(setting.paddingTop) || 0}px ${Number(setting.paddingRight) || 0}px ${Number(setting.paddingBottom) || 0}px ${Number(setting.paddingLeft) || 0}px`,
        `margin:${Number(setting.marginTop) || 0}px 0 ${Number(setting.marginBottom) || 0}px`,
        `background:${setting.backgroundColor || "transparent"}`,
        setting.textColor ? `color:${setting.textColor}` : "",
        `border-radius:${Number(setting.borderRadius) || 0}px`,
      ]
        .filter(Boolean)
        .join(";");
    },
    visibleForViewport = (section) =>
      section.settings.visible !== false &&
      section.settings[builder.viewport] !== false,
    approvedAverage = approvedReviews.length
      ? approvedReviews.reduce(
          (total, review) => total + Number(review.rating || 0),
          0,
        ) / approvedReviews.length
      : null;

  function productMediaPreview(section) {
    const settings = section.settings,
      connectedMedia = [
        storefrontProduct?.media?.main,
        ...(storefrontProduct?.media?.additional || []),
        storefrontProduct?.media?.gif,
        ...(storefrontProduct?.media?.videos || []),
      ].filter(Boolean),
      selectedMedia =
        settings.mediaSource === "custom" && settings.customMedia
          ? {
              dataUrl: settings.customMedia,
              name: "Custom product media",
              type: settings.customMediaType,
            }
          : connectedMedia[0],
      ratio =
        settings.imageRatio === "portrait"
          ? "4 / 5"
          : settings.imageRatio === "square"
            ? "1"
            : "4 / 3";
    return `<div class="builder-media-preview ${esc(settings.mediaLayout || "slider")}" style="aspect-ratio:${ratio};border-radius:${Number(settings.imageRadius ?? builder.pageSettings.imageRadius)}px">${selectedMedia ? (selectedMedia.type?.startsWith("video/") ? `<video src="${esc(selectedMedia.dataUrl)}" controls></video>` : `<img src="${esc(selectedMedia.dataUrl)}" alt="${esc(selectedMedia.name || product.name)}">`) : '<div class="builder-product-mark builder-product-empty"><strong>No product media available</strong><small>Add media from Products</small></div>'}</div>${
      settings.showThumbnails === false || connectedMedia.length < 2
        ? ""
        : `<div class="builder-thumbnails">${connectedMedia
            .slice(0, 5)
            .map((item) =>
              item.type?.startsWith("video/")
                ? `<span class="builder-video-thumb">Video</span>`
                : `<img src="${esc(item.dataUrl)}" alt="">`,
            )
            .join("")}</div>`
    }`;
  }

  const sharedStoreSection = (section) => data.storefront?.home?.banner
    ? ({ header: "header", "announcement-bar": "announcement", "policies-footer": "footer" }[section?.type] || "")
    : "";
  function renderPreviewSection(section) {
    const shared = sharedStoreSection(section);
    if (shared) {
      const home = data.storefront.home;
      if (shared === "announcement" && !home.announcement?.enabled) return "";
      const logo = data.storefront.logo?.dataUrl
        ? `<img src="${esc(data.storefront.logo.dataUrl)}" alt="${esc(data.store.name)}" style="height:36px;width:auto">`
        : `<strong>${esc(data.store.name)}</strong>`;
      const sharedContent = shared === "announcement" ? esc(home.announcement.message)
        : shared === "header" ? `${logo}<span>${(home.header?.links?.length ? home.header.links : [{ label: "Home" }, { label: "Products" }]).map((link) => esc(link.label)).join(" · ")}</span>`
        : `${logo}<p>${esc(home.footer?.contact || "")}</p>${home.footer?.showProducts ? `<small>${(home.featuredProducts || []).map((product) => esc(product.name)).join(" · ")}</small>` : ""}`;
      return `<section class="builder-shared-preview builder-shared-${shared}" data-builder-section="${esc(section.id)}">${sharedContent}<small>Shared store ${shared}</small></section>`;
    }
    const settings = section.settings,
      type = section.type,
      classes = `builder-canvas-section ${builder.selectedId === section.id ? "selected" : ""}`;
    if (!visibleForViewport(section)) return "";
    let body = "";
    if (type === 'blocks') body = renderBlocks(settings.blocks || [], { editor: true, selectedId: builder.selectedId === section.id ? builder.selectedBlockId : null }) || `<p>${settings.blocks?.length ? 'All blocks are hidden.' : 'Add blocks to build this section.'}</p>`;
    else if (type === "header") {
      const source = settings.logoSource || "store-logo",
        storeLogo = data.storefront?.logo?.dataUrl,
        headerValue =
          source === "custom-logo" && settings.logoData
            ? `<img src="${esc(settings.logoData)}" alt="${esc(settings.customLogoAlt || "Custom logo")}">`
            : source === "custom-text"
              ? esc(settings.customText || "Store Name")
              : source === "store-name"
                ? esc(data.store?.name || "Store Name")
                : storeLogo
                  ? `<img src="${esc(storeLogo)}" alt="${esc(data.storefront.logo.alt || data.store.name)}">`
                  : esc(data.store?.name || "Store Name");
      body = `<div class="builder-logo" style="max-width:${Number(settings.logoWidth) || 140}px">${headerValue}</div>`;
    } else if (type === "product-media") body = productMediaPreview(section);
    else if (type === "product-information") {
      const discount = product.comparePricePaise
        ? Math.round((1 - product.pricePaise / product.comparePricePaise) * 100)
        : 0,
        averageRating = approvedAverage?.toFixed(1) || null;
      body = `${settings.showTitle === false ? "" : `<h1 style="font-size:${Number(settings.fontSize) || 32}px;font-weight:${esc(settings.weight || "700")}">${esc(hasConnectedProduct ? product.name : "Product Name")}</h1>`}${settings.showRating === false ? "" : `<div class="builder-rating">${averageRating ? `${ratingStars(approvedAverage)} <span>${averageRating} · ${approvedReviews.length} ${approvedReviews.length === 1 ? "Review" : "Reviews"}</span>` : "No approved reviews yet"}</div>`}<div class="builder-price">${settings.showPrice === false ? "" : `<strong>${hasConnectedProduct ? rupees(product.pricePaise) : "Product Price"}</strong>`}${hasConnectedProduct && settings.showComparePrice !== false && product.comparePricePaise ? `<del>${rupees(product.comparePricePaise)}</del>` : ""}${hasConnectedProduct && settings.showDiscount !== false && discount > 0 ? `<span>SAVE ${discount}%</span>` : ""}</div>`;
    } else if (type === "description")
      body = `<h2>${esc(settings.heading || "Product Description")}</h2><p>${esc(settings.descriptionSource === "custom" ? settings.customDescription || "Add a custom page description." : hasConnectedProduct ? product.description || "Add product description from Products" : "Add product description from Products")}</p>`;
    else if (type === "bundle")
      body = bundles.length
        ? `<h2>${esc(settings.heading || "Choose an option")}</h2><div class="builder-bundles ${esc(settings.bundleLayout || "cards")}">${bundles.map((bundle, index) => `<label class="builder-bundle ${index === Number(settings.defaultBundle || 0) ? "active" : ""}"><input type="radio" disabled ${index === Number(settings.defaultBundle || 0) ? "checked" : ""}><span><strong>${esc(bundle.name || `Option ${index + 1}`)}</strong><small>${rupees(bundle.pricePaise)}</small>${settings.showBadge !== false && index === 1 ? "<b>MOST POPULAR</b>" : ""}</span></label>`).join("")}</div>`
        : '<div class="builder-empty-connected"><strong>No bundles created for this product</strong><small>Manage Product Bundles</small></div>';
    else if (type === "reviews")
      body = `<h2>Customer Reviews</h2>${settings.showRatingSummary === false ? "" : `<div class="builder-review-summary"><strong>${approvedAverage === null ? "—" : approvedAverage.toFixed(1)}</strong><span>${ratingStars(approvedAverage)}<small>${approvedReviews.length} approved ${approvedReviews.length === 1 ? "review" : "reviews"}</small></span></div>`}<div class="builder-review-grid ${esc(settings.reviewLayout || "cards")}">${
        approvedReviews.length
          ? approvedReviews
              .slice(0, Math.min(3, Number(settings.reviewsPerPage) || 10))
              .map(
                (review) =>
                  `<article><span>${ratingStars(review.rating)}</span><p>${esc(review.text || review.title || "Verified customer review")}</p><strong>${esc(review.customerName)}</strong></article>`,
              )
              .join("")
          : '<div class="builder-empty-connected"><strong>No approved reviews yet</strong><small>Approved reviews will appear here.</small></div>'
      }</div>`;
    else if (type === "announcement-bar")
      body = `<strong>${esc(settings.text || pageContent.announcement || "Add an announcement")}</strong>`;
    else if (type === "urgency")
      body = `<div class="builder-urgency ${esc(settings.urgencyStyle || "box")}">${esc((settings.text || pageContent.urgency?.text || "Only {stock} items left").replaceAll("{stock}", String(product.stock)))}</div>`;
    else if (type === "checkout-button")
      body = `<button class="builder-buy-button ${settings.buttonWidth === "auto" ? "auto" : ""}" style="background:${settings.background || builder.pageSettings.buttonColor};color:${settings.buttonTextColor || "#ffffff"};border-radius:${Number(settings.buttonRadius ?? builder.pageSettings.borderRadius)}px;font-size:${Number(settings.buttonFontSize) || 18}px">${esc(settings.buttonText || pageContent.ctaText || "Buy Now")}</button>`;
    else if (type === "policies-footer")
      body = `<div class="builder-footer-preview"><strong>${esc(data.store.name)}</strong><span>Shipping Policy · Return & Refund Policy · Privacy Policy · Contact</span></div>`;
    else if (["image", "gif", "video"].includes(type))
      body = settings.customMedia
        ? `${type === "video" || String(settings.customMediaType || "").startsWith("video/") ? `<video class="builder-custom-media" src="${esc(settings.customMedia)}" controls></video>` : `<img class="builder-custom-media" src="${esc(settings.customMedia)}" alt="${esc(displayName(section))}">`}`
        : `<div class="builder-empty-media"><span>＋</span><strong>Upload ${esc(displayName(section))}</strong></div>`;
    else if (type === "image-with-text") {
      const media = settings.customMedia
        ? `<img class="builder-custom-media" src="${esc(settings.customMedia)}" alt="${esc(settings.heading || displayName(section))}">`
        : '<div class="builder-empty-media"><span>＋</span><strong>Upload Image</strong></div>';
      body = `<div class="builder-image-text ${settings.mediaPosition === "right" ? "media-right" : ""}"><div>${media}</div><div><h2>${esc(settings.heading || "Image With Text")}</h2><p>${esc(settings.body || "Add supporting copy for this image.")}</p></div></div>`;
    }
    else
      body = `<h2>${esc(settings.heading || displayName(section))}</h2><p>${esc(settings.body || "Click this section to add content.")}</p>`;
    return `<section class="${classes}" data-builder-section="${esc(section.id)}" style="${sectionStyle(section)}">${body}</section>`;
  }

  function renderCanvas() {
    const canvas = $("#builder-live-page");
    if (!canvas) return;
    canvas.className = `builder-live-page ${builder.viewport}`;
    canvas.style.cssText = `--builder-primary:${builder.pageSettings.primaryColor};--builder-secondary:${builder.pageSettings.secondaryColor};--builder-text:${builder.pageSettings.textColor};--builder-bg:${builder.pageSettings.backgroundColor};--builder-max:${Number(builder.pageSettings.maxWidth) || 1200}px;--builder-heading:${builder.pageSettings.headingFont};--builder-body:${builder.pageSettings.bodyFont};`;
    if (page.creationMethod === "upload" && page.importedHtml) {
      canvas.innerHTML = `<iframe id="builder-imported-page-preview" title="Imported page preview" sandbox></iframe>`;
      const frame = $("#builder-imported-page-preview");
      frame.srcdoc = importedPreviewDocument(page.importedHtml);
      return;
    }
    canvas.innerHTML = `<div class="builder-page-inner">${builder.sections.map(renderPreviewSection).join("") || '<div class="blank-page"><h3>Blank page</h3><p>Add a section to start building.</p></div>'}</div>`;
    canvas.querySelectorAll("[data-builder-section]").forEach(
      (element) =>
        (element.onclick = (event) => {
          event.preventDefault();
          builder.selectedId = element.dataset.builderSection;
          builder.selectedBlockId = event.target.closest('[data-builder-block]')?.dataset.builderBlock || null;
          if (mobileBuilderMedia.matches) builder.mobileTab = "settings";
          if (tabletBuilderMedia.matches) builder.tabletSettingsOpen = true;
          renderBuilder();
        }),
    );
    canvas.querySelectorAll('[data-builder-block]').forEach(element => {
      element.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); }
      };
    });
  }

  const toggleControl = (key, label, checked) =>
      `<label class="builder-toggle"><span>${esc(label)}</span><input data-vb-setting="${key}" type="checkbox" ${checked !== false ? "checked" : ""}></label>`,
    numberControl = (key, label, value, min = 0, max = 200) =>
      `<label class="field">${esc(label)}<div class="number-suffix"><input data-vb-setting="${key}" type="number" min="${min}" max="${max}" value="${Number(value) || 0}"><span>px</span></div></label>`,
    selectControl = (key, label, value, options) =>
      `<label class="field">${esc(label)}<select data-vb-setting="${key}">${options.map(([id, name]) => `<option value="${esc(id)}" ${value === id ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label>`;

  function specificSettings(section) {
    const setting = section.settings;
    if (section.type === 'blocks') return '<p>Select a block in the section tree or preview to edit it.</p><button type="button" class="secondary" data-add-block>Add Block</button>';
    if (section.type === "header")
      return `<h4>Header / Logo</h4>${selectControl(
        "logoSource",
        "Logo Source",
        setting.logoSource || "store-logo",
        [
          ["store-logo", "Use Store Logo"],
          ["store-name", "Use Store Name"],
          ["custom-logo", "Upload Custom Logo"],
          ["custom-text", "Custom Text"],
        ],
      )}<label class="field">Custom Text<input data-vb-setting="customText" value="${esc(setting.customText || "")}" placeholder="Enter custom header text"></label><label class="field">Custom Logo<input data-vb-logo type="file" accept="image/png,image/jpeg,image/webp"></label><label class="field">Custom Logo Alt Text<input data-vb-setting="customLogoAlt" value="${esc(setting.customLogoAlt || "")}" placeholder="Describe the logo"></label>${numberControl("logoWidth", "Logo Width", setting.logoWidth || 140, 60, 320)}${selectControl(
        "alignment",
        "Alignment",
        setting.alignment,
        [
          ["left", "Left"],
          ["center", "Center"],
        ],
      )}${toggleControl("sticky", "Sticky Header", setting.sticky)}`;
    if (section.type === "product-media")
      return `<h4>Product Media</h4>${selectControl(
        "mediaSource",
        "Source",
        setting.mediaSource || "product",
        [
          ["product", "Product Media"],
          ["custom", "Custom Media"],
        ],
      )}<p class="connected-note">${setting.mediaSource === "custom" ? "Upload media only for this page." : "Uses media managed in Products."}</p>${selectControl(
        "mediaLayout",
        "Layout",
        setting.mediaLayout || "slider",
        [
          ["slider", "Slider"],
          ["grid", "Grid"],
          ["thumbnails", "Main Image + Thumbnails"],
        ],
      )}${selectControl(
        "imageRatio",
        "Image Ratio",
        setting.imageRatio || "original",
        [
          ["original", "Original"],
          ["square", "Square"],
          ["portrait", "Portrait"],
        ],
      )}${toggleControl("showGif", "Show GIF", setting.showGif)}${toggleControl("showVideo", "Show Video", setting.showVideo)}${toggleControl("showThumbnails", "Show Thumbnails", setting.showThumbnails)}${numberControl("imageRadius", "Image Radius", setting.imageRadius ?? builder.pageSettings.imageRadius, 0, 80)}<label class="field">Upload page-specific media<input data-vb-media type="file" accept="image/*,video/mp4,video/webm,.gif"></label>`;
    if (section.type === "product-information")
      return `<h4>Product Title & Price</h4><p class="connected-note">Connected to Products. Display settings cannot change checkout price.</p>${toggleControl("showTitle", "Show Title", setting.showTitle)}${toggleControl("showPrice", "Show Price", setting.showPrice)}${toggleControl("showComparePrice", "Show Compare Price", setting.showComparePrice)}${toggleControl("showDiscount", "Show Discount %", setting.showDiscount)}${toggleControl("showRating", "Show Rating", setting.showRating)}${selectControl(
        "weight",
        "Weight",
        setting.weight || "700",
        [
          ["400", "Regular"],
          ["600", "Semibold"],
          ["700", "Bold"],
        ],
      )}${numberControl("fontSize", "Font Size", setting.fontSize || 32, 16, 72)}`;
    if (section.type === "description")
      return `<h4>Description</h4>${selectControl(
        "descriptionSource",
        "Source",
        setting.descriptionSource || "product",
        [
          ["product", "Use Product Description"],
          ["custom", "Custom Page Description"],
        ],
      )}<label class="field">Heading<input data-vb-setting="heading" value="${esc(setting.heading || "Product Description")}"></label><label class="field">Custom Description<textarea data-vb-setting="customDescription" rows="6">${esc(setting.customDescription || "")}</textarea></label>`;
    if (section.type === "bundle")
      return `<h4>Bundles</h4><p class="connected-note">Prices and quantities stay connected to Product bundles.</p>${selectControl(
        "bundleLayout",
        "Layout",
        setting.bundleLayout || "cards",
        [
          ["cards", "Cards"],
          ["radio", "Radio"],
          ["horizontal", "Horizontal"],
        ],
      )}${toggleControl("showSavings", "Show Savings", setting.showSavings)}${toggleControl("showBadge", "Show Badge", setting.showBadge)}<label class="field">Default Selection<select data-vb-setting="defaultBundle" ${bundles.length ? "" : "disabled"}>${bundles.length ? bundles.map((bundle, index) => `<option value="${index}" ${Number(setting.defaultBundle || 0) === index ? "selected" : ""}>${esc(bundle.name || `Option ${index + 1}`)}</option>`).join("") : "<option>No bundles available</option>"}</select></label>${bundles.length ? "" : '<p class="connected-note">Create options from Products before publishing this section.</p>'}`;
    if (section.type === "reviews")
      return `<h4>Reviews</h4><p class="connected-note">Only approved reviews appear.</p>${toggleControl("showRatingSummary", "Show Rating Summary", setting.showRatingSummary)}${toggleControl("showReviewCount", "Show Review Count", setting.showReviewCount)}${toggleControl("showReviewImages", "Show Review Images", setting.showReviewImages)}<label class="field">Reviews Per Page<input data-vb-setting="reviewsPerPage" type="number" min="1" max="50" value="${Number(setting.reviewsPerPage) || 10}"></label>${selectControl(
        "reviewLayout",
        "Layout",
        setting.reviewLayout || "cards",
        [
          ["list", "List"],
          ["cards", "Cards"],
          ["grid", "Grid"],
        ],
      )}${selectControl("sorting", "Sorting", setting.sorting || "newest", [
        ["newest", "Newest"],
        ["highest", "Highest Rated"],
      ])}`;
    if (section.type === "announcement-bar")
      return `<h4>Announcement Bar</h4><label class="field">Text<input data-vb-setting="text" value="${esc(setting.text || pageContent.announcement || "")}" placeholder="Add an announcement"></label><label class="field">Background<input data-vb-setting="backgroundColor" type="color" value="${esc(setting.backgroundColor === "transparent" ? "#173e34" : setting.backgroundColor)}"></label><label class="field">Text Color<input data-vb-setting="textColor" type="color" value="${esc(setting.textColor || "#ffffff")}"></label>${numberControl("fontSize", "Font Size", setting.fontSize || 14, 10, 30)}${toggleControl("sticky", "Sticky", setting.sticky)}${selectControl(
        "position",
        "Position",
        setting.position || "top",
        [
          ["top", "Top"],
          ["above-product", "Above Product"],
        ],
      )}`;
    if (section.type === "urgency")
      return `<h4>Urgency</h4>${selectControl(
        "urgencyType",
        "Type",
        setting.urgencyType || "limited-stock",
        [
          ["limited-stock", "Limited Stock"],
          ["limited-time", "Limited Time"],
          ["high-demand", "High Demand"],
        ],
      )}<label class="field">Text<input data-vb-setting="text" value="${esc(setting.text || pageContent.urgency?.text || "Only {stock} items left")}"></label>${toggleControl("showStock", "Show Stock Number", setting.showStock)}${selectControl(
        "urgencyStyle",
        "Style",
        setting.urgencyStyle || "box",
        [
          ["text", "Text"],
          ["box", "Box"],
          ["progress", "Progress Bar"],
        ],
      )}`;
    if (section.type === "checkout-button")
      return `<h4>Checkout Button</h4><label class="field">Button Text<input data-vb-setting="buttonText" value="${esc(setting.buttonText || pageContent.ctaText || "Buy Now")}"></label>${selectControl(
        "action",
        "Action",
        setting.action || pageContent.checkoutAction || "direct",
        [
          ["direct", "Direct Checkout"],
          ["redirect", "Redirect"],
        ],
      )}<label class="field">Redirect URL<input data-vb-setting="redirectUrl" type="url" value="${esc(setting.redirectUrl || pageContent.redirectUrl || "")}"></label>${selectControl(
        "buttonWidth",
        "Button Width",
        setting.buttonWidth || "full",
        [
          ["auto", "Auto"],
          ["full", "Full Width"],
        ],
      )}${selectControl(
        "buttonSize",
        "Button Size",
        setting.buttonSize || "large",
        [
          ["small", "Small"],
          ["medium", "Medium"],
          ["large", "Large"],
        ],
      )}${numberControl("buttonRadius", "Border Radius", setting.buttonRadius ?? builder.pageSettings.borderRadius, 0, 80)}${numberControl("buttonFontSize", "Font Size", setting.buttonFontSize || 18, 12, 32)}${toggleControl("sameTab", "Open Checkout in Same Tab", setting.sameTab)}${toggleControl("stickyMobile", "Sticky on Mobile", setting.stickyMobile)}<label class="field">Background<input data-vb-setting="background" type="color" value="${esc(setting.background || builder.pageSettings.buttonColor)}"></label><label class="field">Text Color<input data-vb-setting="buttonTextColor" type="color" value="${esc(setting.buttonTextColor || "#ffffff")}"></label>`;
    if (section.type === "policies-footer")
      return `<h4>Footer / Policy</h4><p class="connected-note">Policy content is managed in Policy. These controls change which published links appear.</p>${toggleControl("showStoreName", "Show Store Name", setting.showStoreName)}${toggleControl("showReturnPolicy", "Show Return Policy", setting.showReturnPolicy)}${toggleControl("showPrivacyPolicy", "Show Privacy Policy", setting.showPrivacyPolicy)}${toggleControl("showTerms", "Show Terms", setting.showTerms)}${toggleControl("showShippingPolicy", "Show Shipping Policy", setting.showShippingPolicy)}${toggleControl("showContact", "Show Contact", setting.showContact)}`;
    if (["image", "gif", "video"].includes(section.type))
      return `<h4>${esc(displayName(section))}</h4><label class="field">Upload / Replace<input data-vb-media type="file" accept="image/*,video/*,.gif"></label><label class="field">Optional Link<input data-vb-setting="link" type="url" value="${esc(setting.link || "")}"></label>${numberControl("mediaWidth", "Width", setting.mediaWidth || 100, 10, 100)}`;
    if (section.type === "image-with-text")
      return `<h4>Image With Text</h4><label class="field">Upload / Replace Image<input data-vb-media type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><label class="field">Heading<input data-vb-setting="heading" value="${esc(setting.heading || "Image With Text")}"></label><label class="field">Text<textarea data-vb-setting="body" rows="6">${esc(setting.body || "")}</textarea></label><label class="field">Optional Link<input data-vb-setting="link" type="url" value="${esc(setting.link || "")}"></label>${selectControl("mediaPosition", "Image Position", setting.mediaPosition || "left", [["left", "Left"], ["right", "Right"]])}`;
    return `<h4>Content</h4><label class="field">Heading<input data-vb-setting="heading" value="${esc(setting.heading || displayName(section))}"></label><label class="field">Text<textarea data-vb-setting="body" rows="6">${esc(setting.body || "")}</textarea></label>`;
  }

  function commonSettings(section) {
    const setting = section.settings;
    return `<details class="builder-settings-group"><summary>Layout</summary>${selectControl(
      "width",
      "Width",
      setting.width || "contained",
      [
        ["full", "Full Width"],
        ["contained", "Contained"],
      ],
    )}${selectControl("alignment", "Alignment", setting.alignment || "left", [
      ["left", "Left"],
      ["center", "Center"],
      ["right", "Right"],
    ])}</details><details class="builder-settings-group"><summary>Typography</summary><p class="connected-note">This section uses the page fonts. Section-specific size and weight controls appear under Content when available.</p></details><details class="builder-settings-group"><summary>Spacing</summary><div class="builder-setting-grid">${numberControl("paddingTop", "Top", setting.paddingTop)}${numberControl("paddingBottom", "Bottom", setting.paddingBottom)}${numberControl("paddingLeft", "Left", setting.paddingLeft)}${numberControl("paddingRight", "Right", setting.paddingRight)}${numberControl("marginTop", "Margin Top", setting.marginTop)}${numberControl("marginBottom", "Margin Bottom", setting.marginBottom)}</div></details><details class="builder-settings-group"><summary>Appearance</summary><label class="field">Background Color<input data-vb-setting="backgroundColor" type="color" value="${esc(setting.backgroundColor === "transparent" ? "#ffffff" : setting.backgroundColor)}"></label><label class="field">Text Color<input data-vb-setting="textColor" type="color" value="${esc(setting.textColor || builder.pageSettings.textColor)}"></label>${numberControl("borderRadius", "Radius", setting.borderRadius, 0, 80)}</details><details class="builder-settings-group" open><summary>Visibility</summary>${toggleControl("visible", "Visible", setting.visible)}${toggleControl("desktop", "Desktop", setting.desktop)}${toggleControl("mobile", "Mobile", setting.mobile)}</details>`;
  }

  function pageSettingsPanel() {
    const setting = builder.pageSettings;
    return `<div class="builder-settings-head"><div><span>GLOBAL</span><h3>Page Settings</h3><p>Changes apply across the complete page.</p></div><button class="builder-settings-close" type="button" aria-label="Close settings">×</button></div><div class="builder-settings-scroll"><h4>Colors</h4>${[
      ["primaryColor", "Primary Color"],
      ["secondaryColor", "Secondary Color"],
      ["textColor", "Text Color"],
      ["backgroundColor", "Background Color"],
      ["buttonColor", "Button Color"],
    ]
      .map(
        ([key, label]) =>
          `<label class="field">${label}<input data-vb-page="${key}" type="color" value="${esc(setting[key])}"></label>`,
      )
      .join("")}<h4>Typography</h4>${[
      ["headingFont", "Heading Font"],
      ["bodyFont", "Body Font"],
      ["buttonFont", "Button Font"],
    ]
      .map(
        ([key, label]) =>
          `<label class="field">${label}<select data-vb-page="${key}">${["Inter", "Georgia", "Arial", "Poppins"].map((font) => `<option ${setting[key] === font ? "selected" : ""}>${font}</option>`).join("")}</select></label>`,
      )
      .join(
        "",
      )}<h4>Page Width</h4><label class="field">Layout<select data-vb-page="pageWidth"><option value="contained" ${setting.pageWidth === "contained" ? "selected" : ""}>Contained</option><option value="full" ${setting.pageWidth === "full" ? "selected" : ""}>Full Width</option></select></label><label class="field">Max Width<input data-vb-page="maxWidth" type="number" min="720" max="1800" value="${setting.maxWidth}"></label><h4>General Styling</h4><label class="field">Border Radius<input data-vb-page="borderRadius" type="number" min="0" max="80" value="${setting.borderRadius}"></label><label class="field">Section Spacing<input data-vb-page="sectionSpacing" type="number" min="0" max="100" value="${setting.sectionSpacing}"></label><label class="field">Image Radius<input data-vb-page="imageRadius" type="number" min="0" max="80" value="${setting.imageRadius}"></label><h4>Thank You Page</h4><label class="field">Thank You Page headline<input data-vb-page="thankYouHeadline" value="${esc(setting.thankYouHeadline || pageContent.thankYou?.headline || "Thank you! Your order is confirmed.")}"></label><label class="field">Thank You Page message<textarea data-vb-page="thankYouBody">${esc(setting.thankYouBody || pageContent.thankYou?.body || "Your order has been confirmed.")}</textarea></label><label class="field">Thank You Page button<input data-vb-page="thankYouCta" value="${esc(setting.thankYouCta || pageContent.thankYou?.ctaText || "Continue shopping")}"></label>${confirmationSettingsPanel(setting)}</div>`;
  }

  function confirmationSettingsPanel(setting) {
    return `<h4>Confirmation Animation</h4><label class="toggle-row"><span>Enable animation</span><input type="checkbox" data-vb-page="thankYouAnimationEnabled" ${setting.thankYouAnimationEnabled ? "checked" : ""}></label><label class="field">Style<select data-vb-page="thankYouAnimationStyle">${[["checkmark", "Checkmark"], ["confetti", "Checkmark + Confetti"], ["none", "None"]].map(([value, label]) => `<option value="${value}" ${setting.thankYouAnimationStyle === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field">Accent color<select disabled aria-label="Confirmation accent color"><option>Use store theme color</option></select></label><p class="muted">Plays once per order in this browser session. Reduced motion shows a static confirmation.</p><button type="button" class="secondary" data-preview-confirmation>Preview Animation</button>`;
  }

  function renderSettings() {
    const panel = $("#builder-settings");
    if (!panel) return;
    const block = selected()?.settings.blocks?.find(item => item.id === builder.selectedBlockId);
    if (selected()?.type === 'blocks' && block) {
      renderBlockSettings(panel, block);
      return;
    }
    const shared = builder.selectedId !== "__page" && sharedStoreSection(selected());
    if (shared) {
      panel.innerHTML = `<div class="builder-settings-head"><div><span>STORE SECTION</span><h3>${esc(displayName(selected()))}</h3><p>Shared across this store’s pages.</p></div><button class="builder-settings-close" type="button" aria-label="Close settings">×</button></div><div class="builder-settings-scroll"><p>Edit this section in Store to update the homepage, product pages, and checkout together.</p><button type="button" class="primary" id="edit-shared-store-section">Edit in Store</button></div>`;
      $("#edit-shared-store-section").onclick = () => { storeEditorSection = shared; navigateTo("/store"); };
      panel.querySelector(".builder-settings-close").onclick = () => { builder.tabletSettingsOpen = false; renderBuilder(); };
      return;
    }
    if (builder.selectedId === "__page") panel.innerHTML = pageSettingsPanel();
    else {
      const section = selected();
      panel.innerHTML = section
        ? `<div class="builder-settings-head"><div><span>SECTION</span><h3>${esc(displayName(section))}</h3><p>${section.connected ? (section.type === "header" || section.type === "policies-footer" ? "Content connected to Store · display is customizable" : "Content connected to Product · display is customizable") : "Edit this element directly"}</p></div><button class="builder-settings-close" type="button" aria-label="Close settings">×</button></div><div class="builder-settings-scroll"><details class="builder-settings-group" open><summary>Content</summary><div class="builder-settings-content">${specificSettings(section)}</div></details>${commonSettings(section)}<button class="builder-settings-save primary" id="builder-settings-save" type="button">Save Changes</button></div>`
        : pageSettingsPanel();
    }
    panel.querySelectorAll("[data-vb-setting]").forEach((input) => {
      const update = () => {
        const section = selected();
        if (!section) return;
        const key = input.dataset.vbSetting,
          value =
            input.type === "checkbox"
              ? input.checked
              : input.type === "number"
                ? Number(input.value)
                : input.value;
        section.settings[key] = value;
        markBuilderDirty();
        renderCanvas();
        const item = document.querySelector(
          `[data-builder-item="${CSS.escape(section.id)}"]`,
        );
        if (item)
          item.classList.toggle(
            "is-hidden",
            section.settings.visible === false,
          );
      };
      input.oninput = update;
      input.onchange = update;
    });
    panel.querySelectorAll("[data-vb-page]").forEach((input) => {
      const update = () => {
        builder.pageSettings[input.dataset.vbPage] =
          input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
        markBuilderDirty();
        renderCanvas();
      };
      input.oninput = update;
      input.onchange = update;
    });
    const mediaInput = panel.querySelector("[data-vb-media]");
    panel.querySelector('[data-add-block]')?.addEventListener('click', () => openBlockDrawer(selected()));
    panel.querySelector("[data-preview-confirmation]")?.addEventListener("click", async () => {
      try {
        const preview = await api(`/api/stores/${storeId}/pages/${page.id}/thank-you/preview`, {
          method: "POST",
          body: JSON.stringify({ thankYou: payloadFromBuilder().thankYou }),
        });
        modalContent.innerHTML = `<h2>Confirmation Animation Preview</h2><p class="muted">Sample order only. No payment, order creation, or purchase tracking.</p><iframe title="Thank You animation preview" sandbox="allow-scripts" style="width:100%;height:65vh;border:1px solid #ddd;border-radius:12px"></iframe><div class="modal-actions"><button type="button" class="secondary" data-replay-confirmation>Replay Animation</button><button type="button" class="primary" data-close-confirmation>Close Preview</button></div>`;
        const frame = modalContent.querySelector("iframe");
        frame.srcdoc = preview.html;
        modalContent.querySelector("[data-replay-confirmation]").onclick = () => { frame.srcdoc = preview.html; };
        modalContent.querySelector("[data-close-confirmation]").onclick = () => modal.close();
        modal.showModal();
      } catch (error) { toast(error.message); }
    });
    if (mediaInput)
      mediaInput.onchange = () => {
        const file = mediaInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          selected().settings.customMedia = String(reader.result);
          selected().settings.customMediaType = file.type;
          markBuilderDirty();
          renderCanvas();
        };
        reader.readAsDataURL(file);
      };
    const logoInput = panel.querySelector("[data-vb-logo]");
    if (logoInput)
      logoInput.onchange = () => {
        const file = logoInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          selected().settings.logoData = String(reader.result);
          selected().settings.logoSource = "custom-logo";
          markBuilderDirty();
          renderCanvas();
          renderSettings();
        };
        reader.readAsDataURL(file);
      };
    panel.querySelector(".builder-settings-close")?.addEventListener(
      "click",
      () => {
        builder.tabletSettingsOpen = false;
        renderBuilder();
      },
    );
    panel.querySelector("#builder-settings-save")?.addEventListener(
      "click",
      () => saveVisualBuilder(false),
    );
  }

  function blockTree(section) {
    if (section.type !== 'blocks') return '';
    return `<div class="builder-block-tree">${(section.settings.blocks || []).map(block => `<button type="button" data-select-block="${esc(block.id)}" data-block-section="${esc(section.id)}" aria-pressed="${builder.selectedId === section.id && builder.selectedBlockId === block.id}" class="${block.visible === false ? 'is-hidden' : ''}">${esc(block.type)} · ${esc(block.text || block.alt || 'Image')}</button>`).join('')}<button type="button" data-section-add-block="${esc(section.id)}">＋ Add Block</button></div>`;
  }

  function openBlockDrawer(section) {
    if (!section || section.type !== 'blocks') return;
    if ((section.settings.blocks || []).length >= 40) return toast('A section can contain up to 40 blocks');
    modalContent.innerHTML = `<h2>Add Block</h2><p>Add content inside ${esc(displayName(section))}.</p><div class="builder-block-actions">${['heading', 'text', 'image', 'button'].map(type => `<button type="button" class="secondary" data-new-block="${type}">${type[0].toUpperCase() + type.slice(1)}</button>`).join('')}</div><button type="button" class="secondary" data-cancel-block>Cancel</button>`;
    $('#modal-form').onsubmit = event => event.preventDefault();
    modalContent.querySelector('[data-cancel-block]').onclick = () => modal.close();
    modalContent.querySelectorAll('[data-new-block]').forEach(button => {
      button.onclick = () => {
        const type = button.dataset.newBlock;
        modal.close();
        commit(() => {
          const block = { id: `block-${crypto.randomUUID()}`, type, visible: true, text: type === 'heading' ? 'Your heading' : type === 'text' ? 'Tell your product story.' : type === 'button' ? 'Learn more' : '', url: '', alt: '' };
          (section.settings.blocks ||= []).push(block);
          builder.selectedId = section.id;
          builder.selectedBlockId = block.id;
          if (mobileBuilderMedia.matches) builder.mobileTab = 'settings';
          if (tabletBuilderMedia.matches) builder.tabletSettingsOpen = true;
        });
      };
    });
    modal.showModal();
  }

  function renderBlockSettings(panel, block) {
    const section = selected(), blocks = section.settings.blocks, index = blocks.indexOf(block);
    panel.innerHTML = `<div class="builder-settings-head"><div><span>BLOCK</span><h3>${esc(block.type[0].toUpperCase() + block.type.slice(1))}</h3><p>Inside ${esc(displayName(section))}</p></div><button class="builder-settings-close" type="button" aria-label="Close settings">×</button></div><div class="builder-settings-scroll"><button class="secondary" type="button" data-back-section>← Section settings</button>${block.type === 'image' ? `<label class="field">Image URL<input data-block-field="url" value="${esc(block.url)}" placeholder="https://…"></label><label class="field">Image description<input data-block-field="alt" maxlength="300" value="${esc(block.alt)}"></label>` : `<label class="field">${block.type === 'button' ? 'Button label' : 'Text'}<textarea data-block-field="text" maxlength="5000">${esc(block.text)}</textarea></label>${block.type === 'button' ? `<label class="field">Button URL<input data-block-field="url" value="${esc(block.url)}" placeholder="/s/store/product"></label>` : ''}`}<label class="toggle-row"><span>Show block</span><input type="checkbox" data-block-visible ${block.visible !== false ? 'checked' : ''}></label><div class="builder-block-actions"><button class="secondary" type="button" data-block-move="-1" ${index === 0 ? 'disabled' : ''}>Move Up</button><button class="secondary" type="button" data-block-move="1" ${index === blocks.length - 1 ? 'disabled' : ''}>Move Down</button><button class="secondary danger-text" type="button" data-block-delete>Delete Block</button></div><button class="primary" type="button" data-block-save>Save Draft</button></div>`;
    panel.querySelectorAll('[data-block-field]').forEach(input => {
      let recorded = false;
      input.oninput = () => {
        if (!recorded) {
          builder.history.push(stateSnapshot());
          if (builder.history.length > 50) builder.history.shift();
          builder.future = [];
          recorded = true;
          $('#builder-undo').disabled = false;
          $('#builder-redo').disabled = true;
        }
        block[input.dataset.blockField] = input.value;
        markBuilderDirty();
        renderCanvas();
        const item = document.querySelector(`[data-block-section="${CSS.escape(section.id)}"][data-select-block="${CSS.escape(block.id)}"]`);
        if (item) item.textContent = `${block.type} · ${block.text || block.alt || 'Image'}`;
      };
    });
    panel.querySelector('[data-block-visible]').onchange = event => commit(() => { block.visible = event.target.checked; });
    panel.querySelectorAll('[data-block-move]').forEach(button => {
      button.onclick = () => commit(() => { blocks.splice(index, 1); blocks.splice(index + Number(button.dataset.blockMove), 0, block); });
    });
    panel.querySelector('[data-block-delete]').onclick = () => commit(() => { blocks.splice(index, 1); builder.selectedBlockId = null; });
    panel.querySelector('[data-back-section]').onclick = () => { builder.selectedBlockId = null; renderBuilder(); };
    panel.querySelector('.builder-settings-close').onclick = () => { builder.tabletSettingsOpen = false; builder.selectedBlockId = null; renderBuilder(); };
    panel.querySelector('[data-block-save]').onclick = () => saveVisualBuilder(false);
  }

  function sectionListItem(section) {
    if (sharedStoreSection(section))
      return `<article class="builder-section-item ${builder.selectedId === section.id ? "active" : ""}" data-builder-item="${esc(section.id)}"><span class="builder-drag" aria-hidden="true">↗</span><button class="builder-section-select" type="button"><strong>${esc(displayName(section))}</strong><small>Shared with Store</small></button></article>`;
    const sectionId = esc(section.id),
      name = esc(displayName(section)),
      index = builder.sections.findIndex((item) => item.id === section.id),
      deleteDisabled = section.connected ? " disabled" : "";
    return `<article class="builder-section-item ${builder.selectedId === section.id ? "active" : ""} ${section.settings.visible === false ? "is-hidden" : ""}" draggable="true" data-builder-item="${sectionId}"><button class="builder-drag" type="button" aria-label="Drag ${name}">☰</button><button class="builder-section-select" type="button"><strong>${name}</strong><small>${section.connected ? "Connected" : "Custom"}</small></button><details class="row-menu builder-more"><summary data-builder-actions="${sectionId}" aria-label="Actions for ${name}">•••</summary><div class="builder-item-menu"><button data-builder-id="${sectionId}" data-vb-action="up" type="button" ${index === 0 ? "disabled" : ""}>Move Up</button><button data-builder-id="${sectionId}" data-vb-action="down" type="button" ${index === builder.sections.length - 1 ? "disabled" : ""}>Move Down</button><button data-builder-id="${sectionId}" data-vb-action="duplicate" type="button">Duplicate</button><button data-builder-id="${sectionId}" data-vb-action="hide" type="button">${section.settings.visible === false ? "Show" : "Hide"}</button><button data-builder-id="${sectionId}" data-vb-action="delete" type="button"${deleteDisabled}>Delete${section.connected ? " (core section)" : ""}</button></div></details></article>`;
  }

  function sectionActionSheet(section) {
    const index = builder.sections.findIndex((item) => item.id === section.id),
      sectionId = esc(section.id),
      deleteDisabled = section.connected ? " disabled" : "";
    return `<div class="builder-sheet-handle" aria-hidden="true"></div><div class="builder-sheet-head"><small>SECTION ACTIONS</small><h3>${esc(displayName(section))}</h3></div><div class="builder-sheet-actions"><button data-builder-id="${sectionId}" data-vb-action="up" type="button" ${index === 0 ? "disabled" : ""}><span>↑</span> Move Up</button><button data-builder-id="${sectionId}" data-vb-action="down" type="button" ${index === builder.sections.length - 1 ? "disabled" : ""}><span>↓</span> Move Down</button><button data-builder-id="${sectionId}" data-vb-action="duplicate" type="button"><span>⧉</span> Duplicate</button><button data-builder-id="${sectionId}" data-vb-action="hide" type="button"><span>◉</span> ${section.settings.visible === false ? "Show" : "Hide"}</button><button class="danger-text" data-builder-id="${sectionId}" data-vb-action="delete" type="button"${deleteDisabled}><span>⌫</span> Delete${section.connected ? " (core section)" : ""}</button></div><button class="builder-sheet-cancel" data-builder-sheet-close type="button">Cancel</button>`;
  }

  function renderBuilder() {
    const pageName = hasConnectedProduct
        ? product.name
        : page.title || "Untitled Product Page",
      statusText = builder.dirty
        ? "Unsaved changes"
        : page.hasUnpublishedChanges ? 'Draft saved · Live unchanged'
        : page.status === "published"
          ? "Published"
          : "Draft";
    content.innerHTML = `<div class="visual-builder" data-mobile-tab="${builder.mobileTab}" data-tablet-settings="${builder.tabletSettingsOpen}">
      <header class="builder-toolbar">
        <div class="builder-title"><button class="back-link" id="back-pages" type="button" aria-label="Back to Product Pages">←</button><div><strong>Product Page</strong><small>${esc(pageName)}</small><span data-builder-status>${statusText}</span></div></div>
        <button class="builder-mobile-top-save" id="builder-mobile-top-save" type="button">Save</button>
        <div class="builder-history"><button class="secondary" id="builder-undo" ${builder.history.length ? "" : "disabled"} title="Undo">↶ <span>Undo</span></button><button class="secondary" id="builder-redo" ${builder.future.length ? "" : "disabled"} title="Redo">↷ <span>Redo</span></button></div>
        <div class="builder-view-switch" role="group" aria-label="Preview device"><button class="${builder.viewport === "desktop" ? "active" : ""}" data-builder-viewport="desktop">▣ Desktop</button><button class="${builder.viewport === "mobile" ? "active" : ""}" data-builder-viewport="mobile">▯ Mobile</button></div>
        <div class="builder-toolbar-actions"><button class="secondary" id="builder-page-settings">⚙ Page Settings</button><button class="secondary" id="save-as-template">Save as Template</button><button class="secondary" id="preview-page-editor">Preview</button><button class="secondary" id="save-page-editor">Save</button><button class="primary" id="publish-page-editor">Publish</button></div>
      </header>
      <nav class="builder-mobile-tabs" role="tablist" aria-label="Product Page editor panels">
        ${[["sections", "Sections"], ["preview", "Preview"], ["settings", "Settings"]].map(([id, label]) => `<button role="tab" type="button" data-builder-tab="${id}" aria-selected="${builder.mobileTab === id}" aria-controls="builder-${id}-panel" tabindex="${builder.mobileTab === id ? "0" : "-1"}">${label}</button>`).join("")}
      </nav>
      <div class="builder-workspace">
        <aside class="builder-structure" id="builder-sections-panel" data-builder-panel="sections"><div class="builder-pane-title"><span>PAGE</span><strong>Sections</strong><small>Arrange the storefront from top to bottom.</small></div><div id="builder-section-list">${builder.sections.map(section => sectionListItem(section) + blockTree(section)).join("")}</div><button class="builder-add-section" id="add-page-section">＋ Add Section</button></aside>
        <section class="builder-canvas-wrap" id="builder-preview-panel" data-builder-panel="preview" aria-label="Live page canvas"><div class="builder-canvas-label"><div><span class="builder-canvas-desktop-label">LIVE PAGE CANVAS</span><span class="builder-canvas-mobile-label">Preview</span><small>${builder.viewport === "desktop" ? "Desktop preview" : "Mobile preview"}</small></div><div class="builder-preview-device" role="group" aria-label="Preview size"><button class="${builder.viewport === "desktop" ? "active" : ""}" data-builder-viewport="desktop">Desktop</button><button class="${builder.viewport === "mobile" ? "active" : ""}" data-builder-viewport="mobile">Mobile</button></div></div><div id="builder-live-page"></div></section>
        <aside class="visual-builder-settings" id="builder-settings" data-builder-panel="settings"></aside>
      </div>
      <button class="builder-tablet-settings-backdrop" id="builder-tablet-settings-backdrop" type="button" aria-label="Close settings"></button>
      <div class="builder-section-sheet-layer" id="builder-section-sheet-layer" hidden><button class="builder-sheet-backdrop" data-builder-sheet-close type="button" aria-label="Close section actions"></button><section class="builder-section-sheet" id="builder-section-sheet" role="dialog" aria-modal="true" aria-label="Section actions"></section></div>
      <footer class="builder-mobile-actions" aria-label="Page actions"><button id="builder-mobile-preview" type="button"><span>▯</span>Preview</button><button id="builder-mobile-save" type="button"><span>✓</span>Save</button><button class="primary" id="builder-mobile-publish" type="button"><span>↑</span>Publish</button></footer>
    </div>`;
    $("#back-pages").onclick = () => navigateTo("/product-pages");
    $("#builder-page-settings").onclick = () => {
      builder.selectedId = "__page";
      if (mobileBuilderMedia.matches) builder.mobileTab = "settings";
      if (tabletBuilderMedia.matches) builder.tabletSettingsOpen = true;
      renderBuilder();
    };
    document.querySelectorAll("[data-builder-tab]").forEach((button) => {
      button.onclick = () => {
        builder.mobileTab = button.dataset.builderTab;
        if (builder.mobileTab === "preview") builder.viewport = "mobile";
        renderBuilder();
      };
      button.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const tabs = [...document.querySelectorAll("[data-builder-tab]")],
          current = tabs.indexOf(button),
          next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : event.key === "ArrowRight"
                  ? (current + 1) % tabs.length
                  : (current - 1 + tabs.length) % tabs.length;
        tabs[next].click();
      };
    });
    document.querySelectorAll("[data-builder-viewport]").forEach(
      (button) =>
        (button.onclick = () => {
          builder.viewport = button.dataset.builderViewport;
          renderBuilder();
        }),
    );
    $("#builder-undo").onclick = () => {
      const previous = builder.history.pop();
      if (!previous) return;
      builder.future.push(stateSnapshot());
      restore(previous);
    };
    $("#builder-redo").onclick = () => {
      const next = builder.future.pop();
      if (!next) return;
      builder.history.push(stateSnapshot());
      restore(next);
    };
    $("#add-page-section").onclick = openSectionDrawer;
    $("#preview-page-editor").onclick = previewVisualBuilder;
    $("#save-page-editor").onclick = () => saveVisualBuilder(false);
    $("#publish-page-editor").onclick = () => saveVisualBuilder(true);
    $("#save-as-template").onclick = saveAsTemplate;
    $("#builder-mobile-top-save").onclick = () => saveVisualBuilder(false);
    $("#builder-mobile-preview").onclick = () => {
      builder.mobileTab = "preview";
      builder.viewport = "mobile";
      renderBuilder();
    };
    $("#builder-mobile-save").onclick = () => saveVisualBuilder(false);
    $("#builder-mobile-publish").onclick = () => saveVisualBuilder(true);
    $("#builder-tablet-settings-backdrop").onclick = () => {
      builder.tabletSettingsOpen = false;
      renderBuilder();
    };
    wireStructure();
    renderCanvas();
    renderSettings();
  }

  function applySectionAction(id, action) {
    const index = builder.sections.findIndex((section) => section.id === id),
      section = builder.sections[index];
    if (!section) return;
    if (action === "delete" && section.connected) return;
    if (action === "up" && index === 0) return;
    if (action === "down" && index === builder.sections.length - 1) return;
    commit(() => {
      if (action === "duplicate") {
        const copy = clone(section);
        copy.id = `${section.type}-${Date.now()}`;
        copy.label = `${displayName(section)} Copy`;
        copy.connected = false;
        builder.sections.splice(index + 1, 0, copy);
        builder.selectedId = copy.id;
      } else if (action === "hide")
        section.settings.visible = section.settings.visible === false;
      else if (action === "up")
        builder.sections.splice(
          index - 1,
          0,
          builder.sections.splice(index, 1)[0],
        );
      else if (action === "down")
        builder.sections.splice(
          index + 1,
          0,
          builder.sections.splice(index, 1)[0],
        );
      else if (action === "delete") {
        builder.sections.splice(index, 1);
        builder.selectedId =
          builder.sections[Math.max(0, index - 1)]?.id || "__page";
      }
    });
  }

  function openSectionActionSheet(id) {
    const section = builder.sections.find((item) => item.id === id),
      layer = $("#builder-section-sheet-layer"),
      sheet = $("#builder-section-sheet");
    if (!section || !layer || !sheet) return;
    builder.actionSectionId = id;
    sheet.innerHTML = sectionActionSheet(section);
    layer.hidden = false;
    layer.querySelectorAll("[data-builder-sheet-close]").forEach(
      (button) =>
        (button.onclick = () => {
          layer.hidden = true;
          builder.actionSectionId = null;
        }),
    );
    layer.querySelectorAll("[data-vb-action]").forEach(
      (button) =>
        (button.onclick = () =>
          applySectionAction(button.dataset.builderId, button.dataset.vbAction)),
    );
    sheet.onkeydown = (event) => {
      if (event.key !== "Escape") return;
      layer.hidden = true;
      builder.actionSectionId = null;
    };
    requestAnimationFrame(() =>
      sheet.querySelector("button:not([disabled])")?.focus(),
    );
  }

  function wireStructure() {
    const list = $("#builder-section-list");
    list.querySelectorAll('[data-select-block]').forEach(button => {
      button.onclick = () => {
        builder.selectedId = button.dataset.blockSection;
        builder.selectedBlockId = button.dataset.selectBlock;
        if (mobileBuilderMedia.matches) builder.mobileTab = 'settings';
        if (tabletBuilderMedia.matches) builder.tabletSettingsOpen = true;
        renderBuilder();
      };
    });
    list.querySelectorAll('[data-section-add-block]').forEach(button => {
      button.onclick = () => openBlockDrawer(builder.sections.find(section => section.id === button.dataset.sectionAddBlock));
    });
    list.querySelectorAll(".builder-section-select").forEach(
      (button) =>
        (button.onclick = () => {
          builder.selectedId = button.closest(
            "[data-builder-item]",
          ).dataset.builderItem;
          builder.selectedBlockId = null;
          if (mobileBuilderMedia.matches) builder.mobileTab = "settings";
          if (tabletBuilderMedia.matches) builder.tabletSettingsOpen = true;
          renderBuilder();
        }),
    );
    list.querySelectorAll("[data-builder-actions]").forEach((button) => {
      button.onclick = (event) => {
        if (!mobileBuilderMedia.matches) return;
        event.preventDefault();
        event.stopPropagation();
        button.closest("details").open = false;
        button.setAttribute("aria-haspopup", "dialog");
        openSectionActionSheet(button.dataset.builderActions);
      };
    });
    list.querySelectorAll(".builder-more [data-vb-action]").forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.builderId;
        applySectionAction(id, button.dataset.vbAction);
      };
    });
    let draggedId = "";
    list.querySelectorAll("[data-builder-item]").forEach((item) => {
      if (sharedStoreSection(builder.sections.find((section) => section.id === item.dataset.builderItem))) return;
      item.ondragstart = () => {
        draggedId = item.dataset.builderItem;
        item.classList.add("dragging");
      };
      item.ondragend = () => item.classList.remove("dragging");
      item.ondragover = (event) => event.preventDefault();
      item.ondrop = (event) => {
        event.preventDefault();
        const targetId = item.dataset.builderItem;
        if (!draggedId || draggedId === targetId) return;
        commit(() => {
          const from = builder.sections.findIndex(
              (section) => section.id === draggedId,
            ),
            target = builder.sections.findIndex(
              (section) => section.id === targetId,
            ),
            moved = builder.sections.splice(from, 1)[0];
          builder.sections.splice(target, 0, moved);
          builder.selectedId = moved.id;
        });
      };
    });
  }

  function openSectionDrawer() {
    const groups = [
      [
        "PRODUCT",
        [
          ["product-media", "Product Media"],
          ["product-information", "Product Title & Price"],
          ["description", "Product Description"],
          ["bundle", "Product Options / Bundles"],
          ["checkout-button", "Checkout Button"],
        ],
      ],
      [
        "CONTENT",
        [
          ["blocks", "Custom Section (Blocks)"],
          ["heading", "Heading"],
          ["text", "Text"],
          ["image", "Image"],
          ["gif", "GIF"],
          ["video", "Video"],
          ["image-with-text", "Image With Text"],
        ],
      ],
      ["SOCIAL", [["reviews", "Reviews"]]],
      [
        "CONVERSION",
        [
          ["announcement-bar", "Announcement Bar"],
          ["urgency", "Urgency"],
        ],
      ],
      ["OTHER", [["policies-footer", "Footer / Policy"]]],
    ];
    modalContent.innerHTML = `<div class="component-drawer"><div><span>PAGE BUILDER</span><h2>Add Section</h2><p>Choose a component. It appears immediately on the canvas.</p></div>${groups.map(([group, items]) => `<section><h3>${group}</h3><div>${items.map(([type, label]) => `<button type="button" data-add-builder-section="${type}"><span>＋</span><strong>${label}</strong></button>`).join("")}</div></section>`).join("")}</div>`;
    $("#modal-form").onsubmit = (event) => event.preventDefault();
    document.querySelectorAll("[data-add-builder-section]").forEach(
      (button) =>
        (button.onclick = () => {
          const type = button.dataset.addBuilderSection,
            label = button.querySelector("strong").textContent,
            connected = [
              "product-media",
              "product-information",
              "description",
              "bundle",
              "reviews",
              "checkout-button",
              "policies-footer",
              "header",
            ].includes(type),
            section = {
              id: `${type}-${Date.now()}`,
              type,
              label,
              connected,
              visible: true,
            };
          section.settings = defaultSectionSettings(section);
          builder.mobileTab = "sections";
          builder.tabletSettingsOpen = false;
          commit(() => {
          builder.sections.push(section);
          builder.selectedId = section.id;
          builder.selectedBlockId = null;
          });
          modal.close();
        }),
    );
    modal.showModal();
  }

  function payloadFromBuilder() {
    const sectionSettings = Object.fromEntries(
        builder.sections.map((section) => [section.id, section.settings]),
      ),
      editorSections = builder.sections.map((section) => ({
        id: section.id,
        type: section.type,
        label: displayName(section),
        visible: section.settings.visible !== false,
        connected: section.connected === true,
      })),
      customTypes = new Set([
        "blocks",
        "text",
        "heading",
        "image",
        "gif",
        "video",
        "image-text",
        "image-with-text",
        "testimonials",
        "rating",
      ]),
      builderCustomSections = builder.sections
        .filter((section) => customTypes.has(section.type))
        .map((section) => ({
          id: section.id,
          type: section.type,
          title: section.settings.heading || displayName(section),
          body: section.settings.body || "",
          mediaDataUrl: section.settings.customMedia || "",
          mediaType: section.settings.customMediaType || "",
          mediaLink: section.settings.link || "",
          mediaPosition: section.settings.mediaPosition || "left",
          mediaWidth: Number(section.settings.mediaWidth) || 100,
          visible: section.settings.visible !== false,
          editorCustom: true,
          ...(section.type === 'blocks' ? { blocks: section.settings.blocks || [] } : {}),
        })),
      preservedSections = (pageContent.sections || []).filter(
        (section) => !section.editorCustom,
      ),
      byType = (type) =>
        builder.sections.find((section) => section.type === type),
      media = byType("product-media")?.settings || {},
      reviews = byType("reviews")?.settings || {},
      urgency = byType("urgency"),
      announcement = byType("announcement-bar"),
      checkoutButton = byType("checkout-button")?.settings || {};
    return {
      editorSections,
      sectionSettings,
      pageSettings: builder.pageSettings,
      mediaSettings: {
        mainImage: true,
        imageGallery: media.showThumbnails !== false,
        gif: media.showGif !== false,
        video: media.showVideo !== false,
      },
      reviewSettings: {
        showReviews: byType("reviews")?.settings.visible !== false,
        showRating: reviews.showRatingSummary !== false,
        showImages: reviews.showReviewImages !== false,
        limit: Number(reviews.reviewsPerPage) || 10,
      },
      sections: [...preservedSections, ...builderCustomSections],
      urgency: {
        enabled: Boolean(urgency && urgency.settings.visible !== false),
        type: urgency?.settings.urgencyType || "none",
        text: urgency?.settings.text || "",
      },
      announcement:
        announcement && announcement.settings.visible !== false
          ? announcement.settings.text || ""
          : "",
      ctaText: checkoutButton.buttonText || pageContent.ctaText || "Buy Now",
      checkoutAction:
        checkoutButton.action || pageContent.checkoutAction || "direct",
      redirectUrl: checkoutButton.redirectUrl || pageContent.redirectUrl || "",
      thankYou: {
        headline:
          builder.pageSettings.thankYouHeadline ||
          pageContent.thankYou?.headline ||
          "Thank you! Your order is confirmed.",
        body:
          builder.pageSettings.thankYouBody ||
          pageContent.thankYou?.body ||
          "Your order has been confirmed.",
        ctaText:
          builder.pageSettings.thankYouCta ||
          pageContent.thankYou?.ctaText ||
          "Continue shopping",
        animation: {
          enabled: builder.pageSettings.thankYouAnimationEnabled,
          style: builder.pageSettings.thankYouAnimationStyle,
          accent: "store",
        },
      },
    };
  }

  async function saveVisualBuilder(publish, { rerender = true } = {}) {
    const payload = payloadFromBuilder();
    if (payload.checkoutAction === "redirect" && !payload.redirectUrl)
      return toast("Redirect URL is required");
    try {
      await api(`/api/stores/${storeId}/pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (publish)
        await api(`/api/stores/${storeId}/pages/${page.id}/publish`, {
          method: "POST",
          body: "{}",
        });
      await helpers.refresh();
      builder.dirty = false;
      productPageDirty = false;
      toast(publish ? "Page published" : "Draft saved — publish to update the live page");
      if (rerender) openVisualProductPageBuilder(page.id, helpers);
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  }
  productPageSaveHandler = () =>
    saveVisualBuilder(false, { rerender: false });

  async function previewVisualBuilder() {
    const preview = open("about:blank", "_blank");
    const saved = await saveVisualBuilder(false, { rerender: false });
    if (saved && preview)
      preview.location = `/api/stores/${storeId}/pages/${page.id}/preview`;
    else if (!saved) preview?.close();
  }

  function saveAsTemplate() {
    modalContent.innerHTML = `<h2>Save as template</h2><label class="field">Template name<input name="name" value="${esc(`${page.title} Template`)}" required maxlength="80"></label><p class="notice">The reusable layout is isolated to this store and replaces product data when it is reused.</p><button class="primary" type="submit">Save template</button>`;
    const form = $("#modal-form");
    form.onsubmit = (event) => {
      event.preventDefault();
      const name = String(new FormData(form).get("name") || "").trim();
      if (!name) return;
      const storageKey = `commera2-page-templates-${storeId}`,
        templates = JSON.parse(localStorage.getItem(storageKey) || "[]");
      templates.push({
        id: `personal-${Date.now()}`,
        name,
        savedAt: new Date().toISOString(),
        editorSections: clone(builder.sections),
        pageSettings: clone(builder.pageSettings),
      });
      localStorage.setItem(storageKey, JSON.stringify(templates));
      modal.close();
      toast(`Saved “${name}” to My Templates`);
      };
    modal.classList.add("builder-section-picker-dialog");
    modal.addEventListener(
      "close",
      () => modal.classList.remove("builder-section-picker-dialog"),
      { once: true },
    );
    modal.showModal();
  }

  renderBuilder();
}

function newStore() {
  openForm(
    "Create a store",
    `<label class="field">Store name<input name="name" required></label><label class="field">Currency<select name="currency" required><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="GBP">GBP — British Pound</option><option value="EUR">EUR — Euro</option><option value="AED">AED — UAE Dirham</option><option value="CAD">CAD — Canadian Dollar</option><option value="AUD">AUD — Australian Dollar</option></select></label>`,
    "Create store",
    async (v) => {
      const store = await api("/api/stores", {
        method: "POST",
        body: JSON.stringify(v),
      });
      storeId = store.id;
    },
  );
}
const sidebar = $("#app-sidebar"),
  sidebarBackdrop = $("#sidebar-backdrop"),
  mobileMenu = $("#mobile-menu"),
  appMain = document.querySelector("main"),
  sidebarMedia = matchMedia("(max-width: 1023px)");
let sidebarReturnFocus = null;
function sidebarFocusableItems() {
  return [...sidebar.querySelectorAll("button:not([disabled]), select:not([disabled]), a[href]")].filter(
    (item) => item.getClientRects().length,
  );
}
function closeSidebar({ restoreFocus = true } = {}) {
  const wasOpen = document.body.classList.contains("sidebar-open");
  document.body.classList.remove("sidebar-open");
  mobileMenu?.setAttribute("aria-expanded", "false");
  if (appMain) appMain.inert = false;
  if (sidebar) sidebar.inert = sidebarMedia.matches;
  if (wasOpen && restoreFocus && sidebarReturnFocus?.isConnected)
    sidebarReturnFocus.focus();
  sidebarReturnFocus = null;
}
function openSidebar() {
  sidebarReturnFocus = document.activeElement;
  if (sidebar) sidebar.inert = false;
  document.body.classList.add("sidebar-open");
  mobileMenu?.setAttribute("aria-expanded", "true");
  if (appMain) appMain.inert = true;
  requestAnimationFrame(() => sidebarFocusableItems()[0]?.focus());
}
function syncSidebarAccessibility() {
  if (!sidebarMedia.matches) {
    document.body.classList.remove("sidebar-open");
    if (sidebar) sidebar.inert = false;
    if (appMain) appMain.inert = false;
    mobileMenu?.setAttribute("aria-expanded", "false");
    sidebarReturnFocus = null;
    return;
  }
  const isOpen = document.body.classList.contains("sidebar-open");
  if (sidebar) sidebar.inert = !isOpen;
  if (appMain) appMain.inert = isOpen;
  mobileMenu?.setAttribute("aria-expanded", String(isOpen));
}
syncSidebarAccessibility();
sidebarMedia.addEventListener?.("change", syncSidebarAccessibility);
mobileMenu.onclick = () =>
  document.body.classList.contains("sidebar-open")
    ? closeSidebar()
    : openSidebar();
sidebarBackdrop.onclick = closeSidebar;
document.addEventListener("keydown", (event) => {
  if (!document.body.classList.contains("sidebar-open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSidebar();
    return;
  }
  if (event.key !== "Tab") return;
  const items = sidebarFocusableItems();
  if (!items.length) return;
  const first = items[0],
    last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
$("#new-store").onclick = newStore;
setupWorkspaceSearch({ document, navigate: path => { closeSidebar(); return navigateTo(path); }, onError: error => toast(error.message) });
function updateAccountIdentity(user) {
  merchantIdentity = user;
  $("#account-name").textContent = user.displayName;
  $("#account-email").textContent = user.email;
  $("#mobile-account-link").title = `${user.displayName} (${user.email})`;
}
for (const id of ["brand-home", "mobile-brand-home", "account-link", "mobile-account-link"]) {
  $(`#${id}`).onclick = (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    event.preventDefault();
    closeSidebar();
    navigateTo(event.currentTarget.getAttribute("href")).catch((error) => toast(error.message));
  };
}
$("#logout").onclick = async () => {
  if (!await confirmEditorNavigation()) return;
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (error) {
    if (error.status !== 401) { toast(error.message); return; }
  }
  merchantIdentity = null;
  csrfToken = "";
  data = null;
  storeId = null;
  localStorage.removeItem(selectedStoreKey);
  history.replaceState({}, "", "/");
  renderAuthentication();
};
select.onchange = async () => {
  const nextStoreId = Number(select.value), previousStoreId = storeId;
  select.value = String(previousStoreId);
  if (nextStoreId === previousStoreId) return;
  select.disabled = true;
  try {
    // Save handlers must run while their original store is still active.
    if (!await confirmEditorNavigation()) return;
    storeId = nextStoreId;
    select.value = String(storeId);
    localStorage.setItem(selectedStoreKey, String(storeId));
    closeSidebar();
    const route = routeFromPath();
    // IDs belong to one store. Do not open another store with a stale detail ID.
    if (route.screen || route.onlineScreen) {
      const path = route.view === 'online-store'
        ? `/online-store/${route.onlineTab}` : viewPaths[route.view] || '/overview';
      history.replaceState({}, '', path);
      currentMerchantLocation = path;
    }
    await load();
  } catch (error) { toast(error.message); }
  finally { select.disabled = false; storeSwitcher.sync(); }
};
document.querySelectorAll("#app-sidebar nav button").forEach(
  (button) =>
    (button.onclick = () => {
      if (button.dataset.route) { closeSidebar(); return navigateTo(button.dataset.route); }
      view = button.dataset.view;
      closeSidebar();
      navigateTo(viewPaths[view]);
    }),
);
window.addEventListener("popstate", async () => {
  if (productPageDirty) {
    const destination = location.pathname + location.search;
    history.pushState({}, "", currentMerchantLocation);
    const choice = await unsavedNavigationChoice();
    if (choice === "continue") return;
    if (choice === "save") {
      const saved = await productPageSaveHandler?.();
      if (!saved) return;
    }
    history.pushState({}, "", destination);
  }
  productPageDirty = false;
  productPageSaveHandler = null;
  currentMerchantLocation = location.pathname + location.search;
  if (merchantIdentity) {
    if (data || routeFromPath().view === "account") render();
    else await load();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (!productPageDirty) return;
  event.preventDefault();
  event.returnValue = "";
});
bootstrap().catch((e) => toast(e.message));
