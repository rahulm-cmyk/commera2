import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./database.js";
import { CommerceService } from "./commerce-service.js";
import { ProductOperationsService } from "./product-operations-service.js";
import { ProjectService, staticImportedPageHtml } from "./project-service.js";
import { DeliveryService } from "./delivery-service.js";
import { DomainService } from "./domain-service.js";
import { createHttpsDomainProvider } from "./https-domain-provider.js";
import { PixelService } from "./pixel-service.js";
import { SettingsService, defaultSettings } from "./settings-service.js";
import { ShippingService } from "./shipping-service.js";
import { SalesChannelService } from "./sales-channel-service.js";
import { PincodeService } from "./pincode-service.js";
import { ReviewService } from "./review-service.js";
import { ReviewImportService } from "./review-import-service.js";
import { PolicyService } from "./policy-service.js";
import { StorefrontService } from "./storefront-service.js";
import { OnlineStoreService } from './online-store-service.js';
import { createStorePreviewTokens } from './store-preview-token.js';
import { renderStoreChrome } from "./store-site-layout.js";
import { LiveVisitorService } from "./live-visitor-service.js";
import { analyticsAllowed } from './tracking-consent.js';
import { OtpService } from "./otp-service.js";
import { configuredOtpProviders } from "./otp-providers.js";
import { OtpProviderConfigService } from "./otp-provider-config-service.js";
import { BotProtectionService } from "./bot-protection-service.js";
import { AuthService } from "./auth-service.js";
import { createGoogleAuthProvider } from "./google-auth-provider.js";
import { createAccountEmailProvider } from "./account-email.js";
import { pageTemplates } from "./page-templates.js";
import { renderBlocks, blockSectionStyle } from '../public/page-blocks.js';
import { confirmationAnimation, orderConfirmation, confirmationIcon } from "./confirmation.js";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const visitorTokenSecret =
  process.env.VISITOR_TOKEN_SECRET || randomBytes(32).toString("hex");
const createVisitorToken = (storeId, pageSlug) => {
  const payload = Buffer.from(
      JSON.stringify({
        storeId: Number(storeId),
        pageSlug: String(pageSlug),
        issuedAt: Date.now(),
      }),
    ).toString("base64url"),
    signature = createHmac("sha256", visitorTokenSecret)
      .update(payload)
      .digest("base64url");
  return `${payload}.${signature}`;
};
const verifyVisitorToken = (token, storeId, pageSlug) => {
  const [payload, provided] = String(token || "").split("."),
    expected = createHmac("sha256", visitorTokenSecret)
      .update(payload || "")
      .digest("base64url");
  if (
    !provided ||
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    throw new Error("Invalid visitor session token");
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid visitor session token");
  }
  if (
    Number(decoded.storeId) !== Number(storeId) ||
    String(decoded.pageSlug) !== String(pageSlug) ||
    !Number.isFinite(Number(decoded.issuedAt)) ||
    Date.now() - Number(decoded.issuedAt) > 2 * 60 * 60 * 1000
  )
    throw new Error("Visitor session token has expired or does not match");
};
const visitorTokenIsValid = (token, storeId, pageSlug) => {
  try {
    verifyVisitorToken(token, storeId, pageSlug);
    return true;
  } catch {
    return false;
  }
};
const json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const parseBoolean = (value) => {
  if (typeof value === "string") {
    const parsed = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(parsed)) return false;
    if (["true", "1", "on", "yes"].includes(parsed)) return true;
  }
  return Boolean(value);
};
const scriptJson = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
const customDomainHtml = (html, storeSlug) => {
  const prefix = `/s/${encodeURIComponent(storeSlug)}`;
  return String(html)
    .replaceAll(`${prefix}/checkout/`, "/checkout/")
    .replaceAll(`${prefix}/policies/`, "/policies/")
    .replaceAll(`${prefix}/thank-you/`, "/thank-you/")
    .replaceAll(`${prefix}/upsell/`, "/upsell/")
    .replaceAll(`${prefix}/products/`, "/products/")
    .replaceAll(`href="${prefix}#`, 'href="/#')
    .replaceAll(`href="${prefix}"`, 'href="/"')
    .replaceAll(`href='${prefix}'`, "href='/'")
    .replaceAll(`${prefix}/`, "/products/");
};
const secureResponse = (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (
    String(req.url || "").startsWith("/api/") ||
    ["/healthz", "/readyz"].includes(String(req.url || "").split("?")[0])
  )
    res.setHeader("cache-control", "no-store");
  if (process.env.NODE_ENV === "production")
    res.setHeader(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
};
const createRateLimiter = ({ limit, windowMs }) => {
  const attempts = new Map();
  return {
    take(key) {
      const now = Date.now();
      if (attempts.size > 2_000)
        for (const [candidate, entry] of attempts)
          if (entry.resetAt <= now) attempts.delete(candidate);
      const current = attempts.get(key);
      if (!current || current.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfter: 0 };
      }
      current.count += 1;
      return {
        allowed: current.count <= limit,
        retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    },
    clear(key) {
      attempts.delete(key);
    },
  };
};
const errorResponse = (res, error) => {
  const message = String(error?.message || ""),
    status = Number(error?.status) || (/not found/i.test(message) ? 404 : 400),
    unexpected = Boolean(error?.code) || error instanceof TypeError;
  if (unexpected) {
    console.error("Unexpected request failure", {
      code: error?.code || "UNEXPECTED_ERROR",
      message,
    });
    return json(res, 500, { error: "Internal server error" });
  }
  return json(res, status, { error: message || "Request failed" });
};
const cookies = (req) =>
  Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return index < 0
          ? [item, ""]
          : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      }),
  );
const merchantSessionCookie = (token, expiresAt) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `commera2_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
};
const expiredMerchantCookie = () =>
  `commera2_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
const googleOAuthCookie = (value, maxAge = 600) =>
  `commera2_google_oauth=${encodeURIComponent(value)}; Path=/api/auth/google/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
const safeReturnPath = (value) => {
  const path = String(value || "").trim();
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\")
    ? path
    : "/overview";
};
const htmlEscape = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
const formatCurrency = (minorUnits, currency = "INR") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(minorUnits || 0) / 100);
const money = formatCurrency;
const customerPageError = (res, status = 404) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page unavailable</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f3ec;color:#172019;font:16px/1.6 Inter,Segoe UI,sans-serif}.message{width:min(100%,560px);padding:42px;border:1px solid #deddd5;border-radius:18px;background:#fff;text-align:center;box-shadow:0 20px 70px #17201912}.message span{display:grid;place-items:center;width:54px;height:54px;margin:auto;border-radius:50%;background:#eef4ed;font-size:25px}.message h1{margin:18px 0 8px;font-size:32px}.message p{margin:0;color:#687169}</style></head><body><main class="message"><span>!</span><h1>This page is not available</h1><p>We could not open this product page right now. Please check the link or try again shortly.</p></main></body></html>',
  );
};
const indianStates = [
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
];

async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 8_000_000) throw new Error("Request body is too large");
  }
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function pixelScripts(
  pixels,
  storeId,
  pageSlug,
  { purchase = null, privacy = defaultSettings.privacy } = {},
) {
  const configs = scriptJson(
      pixels.map((pixel) => ({
        id: pixel.id,
        platform: pixel.platform,
        trackingId: pixel.trackingId,
        browserEnabled: pixel.browserEnabled,
        eventMappings: pixel.eventMappings || {},
      })),
    ),
    requireConsent = Boolean(privacy.requireMarketingConsent),
    visitorTracking = Boolean(privacy.allowVisitorTracking),
    visitorToken = scriptJson(createVisitorToken(storeId, pageSlug));
  const visitorCall = `(()=>{const form=document.querySelector('#cod-form');if(!form||!window.trackCommerceEvent)return;const visitorField=document.createElement('input'),stageField=document.createElement('input');visitorField.type=stageField.type='hidden';visitorField.name='visitorSessionId';visitorField.value=window.commera2VisitorSessionId;stageField.name='currentStage';stageField.value='checkout_opened';form.append(visitorField,stageField);const selection=()=>{const bundle=form.querySelector('[name="bundleId"]:checked')||form.querySelector('[name="bundleId"]');return{productId:Number(window.commera2ProductId||0),pageId:Number(window.commera2PageId||0),quantity:Number(form.querySelector('[name="quantity"]')?.value||1),bundleId:bundle?.value?Number(bundle.value):null,checkoutSessionId:window.commera2CheckoutSessionId||null}},stages=new Set(),checkoutStage=stage=>{stageField.value=stage;if(stages.has(stage))return;stages.add(stage);const selected=selection();trackCommerceEvent('checkout_progress',{...selected,eventId:'CHECKOUT-PROGRESS-'+(selected.checkoutSessionId||window.commera2VisitorSessionId)+'-'+stage,checkoutProgress:stage})};checkoutStage('checkout_opened');form.addEventListener('focusin',event=>{const name=event.target?.name;if(name==='address'||name==='addressLine2')checkoutStage('address_started')});form.addEventListener('input',event=>{const name=event.target?.name,value=String(event.target?.value||'').trim();if(name==='phone'&&value.length>=6)checkoutStage('phone_entered');if(name==='pincode'&&/^\\d{6}$/.test(value))checkoutStage('pincode_entered')});form.addEventListener('submit',()=>checkoutStage('details_completed'))})();`,
    securityCall = `(()=>{const form=document.querySelector('#cod-form');if(!form)return;const token=document.createElement('input'),device=document.createElement('input'),behavior=document.createElement('input'),deviceKey='commera2-device-id';let deviceId=localStorage.getItem(deviceKey);if(!deviceId){deviceId=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);localStorage.setItem(deviceKey,deviceId)}token.type=device.type=behavior.type='hidden';token.name='checkoutToken';token.value=VISITOR_TOKEN;device.name='deviceId';device.value=deviceId;behavior.name='behavior';const started=performance.now(),signals={pointerEvents:0,touchEvents:0,scrollEvents:0,focusEvents:0,corrections:0},previous=new Map(),sync=()=>{behavior.value=JSON.stringify({...signals,timeOnPageMs:Math.round(performance.now()-started)})};addEventListener('pointerdown',()=>{signals.pointerEvents++;sync()},{passive:true});addEventListener('touchstart',()=>{signals.touchEvents++;sync()},{passive:true});addEventListener('scroll',()=>{signals.scrollEvents++;sync()},{passive:true});form.addEventListener('focusin',()=>{signals.focusEvents++;sync()});form.addEventListener('change',event=>{const name=event.target?.name,value=event.target?.value;if(name&&previous.has(name)&&previous.get(name)!==value)signals.corrections++;if(name)previous.set(name,value);sync()});form.addEventListener('submit',sync,{capture:true});sync();form.append(token,device,behavior);const otpUi=document.createElement('script');otpUi.src='/otp-checkout.js';document.head.append(otpUi)})();`,
    purchaseCall =
      visitorCall +
      securityCall +
      (purchase
        ? `trackCommerceEvent('order_created',${scriptJson({ eventId: `ORDER-${purchase.id}`, orderId: purchase.id, value: purchase.totalPaise / 100, orderValue: purchase.totalPaise / 100, currency: purchase.storeCurrency || purchase.currency || "INR" })});`
        : "");
  return `<script>const PIXEL_STORE=${Number(storeId)},PIXEL_PAGE=${JSON.stringify(String(pageSlug))},PIXEL_CONFIGS=${configs},PIXEL_REQUIRE_CONSENT=${requireConsent},VISITOR_TRACKING_ENABLED=${visitorTracking},VISITOR_TOKEN=${visitorToken};let pixelsLoaded=false;const EVENT_ALIASES={product_page_view:'product_view',checkout_start:'checkout_started',purchase:'order_created'},META_STANDARD=new Set(['PageView','ViewContent','AddToCart','InitiateCheckout','Purchase']);function analyticsConsent(){const choice=localStorage.getItem('commera2_tracking_consent_'+PIXEL_STORE);return ${privacy.analyticsTracking !== false}&&choice!=='rejected'&&(!${Boolean(privacy.requireAnalyticsConsent)}||choice==='accepted')}function pixelConsent(){const choice=localStorage.getItem('commera2_tracking_consent_'+PIXEL_STORE);return analyticsConsent()&&choice!=='rejected'&&(!PIXEL_REQUIRE_CONSENT||choice==='accepted')}function addTrackingScript(src){const script=document.createElement('script');script.async=true;script.src=src;document.head.appendChild(script)}function loadPixels(){if(pixelsLoaded||!pixelConsent())return;pixelsLoaded=true;for(const pixel of PIXEL_CONFIGS){if(!pixel.browserEnabled)continue;if(pixel.platform==='meta'){window.fbq=window.fbq||function(){(fbq.q=fbq.q||[]).push(arguments)};addTrackingScript('https://connect.facebook.net/en_US/fbevents.js');fbq('init',pixel.trackingId)}else if(pixel.platform==='google'){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments)};addTrackingScript('https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(pixel.trackingId));gtag('js',new Date());gtag('config',pixel.trackingId)}else if(pixel.platform==='tiktok'){window.ttq=window.ttq||[];ttq.track=ttq.track||function(){ttq.push(['track',...arguments])};addTrackingScript('https://analytics.tiktok.com/i18n/pixel/events.js?sdkid='+encodeURIComponent(pixel.trackingId)+'&lib=ttq')}else if(pixel.platform==='snapchat'){window.snaptr=window.snaptr||function(){(snaptr.handleRequest?snaptr.handleRequest:snaptr.queue).apply(null,arguments)};snaptr.queue=[];addTrackingScript('https://sc-static.net/scevent.min.js');snaptr('init',pixel.trackingId)}else if(pixel.platform==='pinterest'){window.pintrk=window.pintrk||function(){(pintrk.queue=pintrk.queue||[]).push(Array.from(arguments))};addTrackingScript('https://s.pinimg.com/ct/core.js');pintrk('load',pixel.trackingId)}else if(pixel.platform==='microsoft'){window.uetq=window.uetq||[];window.uetq.push('config',pixel.trackingId);addTrackingScript('https://bat.bing.com/bat.js')}}}function fireBrowserEvent(name,eventId,details){if(!pixelConsent())return;loadPixels();for(const pixel of PIXEL_CONFIGS){if(!pixel.browserEnabled)continue;const external=pixel.eventMappings?.[name];if(!external)continue;try{if(pixel.platform==='meta'&&window.fbq)fbq(META_STANDARD.has(external)?'track':'trackCustom',external,details,{eventID:eventId});else if(pixel.platform==='google'&&window.gtag)gtag('event',external,{...details,event_id:eventId});else if(pixel.platform==='tiktok'&&window.ttq?.track)ttq.track(external,{...details,event_id:eventId});else if(pixel.platform==='snapchat'&&window.snaptr)snaptr('track',external,{...details,event_id:eventId});else if(pixel.platform==='pinterest'&&window.pintrk)pintrk('track',external,{...details,event_id:eventId});else if(pixel.platform==='microsoft'&&window.uetq)uetq.push('event',external,{...details,event_id:eventId});else if(pixel.platform==='custom')navigator.sendBeacon(pixel.trackingId,JSON.stringify({event_id:eventId,event_name:external,page:PIXEL_PAGE,data:details}))}catch{}}}const VISITOR_SESSION_KEY='commera2-live-visitor-'+PIXEL_STORE;let visitorSessionId=sessionStorage.getItem(VISITOR_SESSION_KEY);if(!visitorSessionId){visitorSessionId=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);sessionStorage.setItem(VISITOR_SESSION_KEY,visitorSessionId)}function trackCommerceEvent(rawName,details={}){const name=EVENT_ALIASES[rawName]||rawName,eventId=details.eventId||(name==='order_created'&&details.orderId?'ORDER-'+details.orderId:name==='checkout_started'&&details.checkoutSessionId?'CHECKOUT-'+details.checkoutSessionId:crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),payload={...details,eventId};delete payload.eventId;fireBrowserEvent(name,eventId,payload);return fetch('/api/public/stores/'+PIXEL_STORE+'/tracking-events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventName:name,eventId,source:'browser',sessionId:visitorSessionId,pageSlug:PIXEL_PAGE,visitorToken:VISITOR_TOKEN,consentGranted:pixelConsent(),analyticsConsentGranted:analyticsConsent(),timestamp:new Date().toISOString(),...payload}),keepalive:true}).catch(()=>{})}function sendVisitorHeartbeat(){if(!VISITOR_TRACKING_ENABLED||document.visibilityState!=='visible')return;fetch('/api/public/stores/'+PIXEL_STORE+'/live/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:visitorSessionId,pageSlug:PIXEL_PAGE,visitorToken:VISITOR_TOKEN,analyticsConsentGranted:analyticsConsent()}),keepalive:true}).catch(()=>{})}function trackPixelEvent(name,details={}){return trackCommerceEvent(name,details)}function trackVisitorEvent(name,details={}){if(!VISITOR_TRACKING_ENABLED)return Promise.resolve();return trackCommerceEvent(name,details)}window.commera2StoreId=PIXEL_STORE;window.commera2VisitorSessionId=visitorSessionId;window.trackCommerceEvent=trackCommerceEvent;window.trackPixelEvent=trackPixelEvent;window.trackVisitorEvent=trackVisitorEvent;window.commera2LoadPixels=loadPixels;window.commera2TrackingConsent=pixelConsent;window.commera2AnalyticsConsent=analyticsConsent;loadPixels();setInterval(sendVisitorHeartbeat,25000);${purchaseCall}</script>`;
}

function exitOfferExperience({
  offer,
  storeId,
  storeSlug,
  pageId,
  pageSlug,
  productId,
  currency = "INR",
  context = "product_page",
  checkoutSessionId = null,
}) {
  if (!offer) return "";
  const discountLabel =
      offer.discountType === "percent"
        ? `${Number(offer.discountValue)}% OFF`
        : `${formatCurrency(Number(offer.discountValue), currency)} OFF`,
    config = {
      id: Number(offer.id),
      storeId: Number(storeId),
      storeSlug: String(storeSlug),
      pageId: Number(pageId),
      pageSlug: String(pageSlug),
      productId: Number(productId),
      context,
      checkoutSessionId: checkoutSessionId ? String(checkoutSessionId) : null,
    };
  return `<dialog class="exit-offer-dialog" id="exit-offer-dialog" aria-labelledby="exit-offer-title"><form method="dialog" class="exit-offer-card"><button class="exit-offer-close" id="exit-offer-close" type="button" aria-label="Dismiss offer">×</button><span class="exit-offer-eyebrow">LIMITED CHECKOUT OFFER</span><strong class="exit-offer-value">${htmlEscape(discountLabel)}</strong><h2 id="exit-offer-title">${htmlEscape(offer.headline)}</h2>${offer.message ? `<p>${htmlEscape(offer.message)}</p>` : ""}<button class="exit-offer-claim" id="exit-offer-claim" type="button">${htmlEscape(offer.buttonText)}</button><button class="exit-offer-reject" id="exit-offer-reject" type="button">${htmlEscape(offer.rejectText)}</button><small id="exit-offer-status" role="status" aria-live="polite"></small></form></dialog><script type="application/json" id="exit-offer-config">${scriptJson(config)}</script><dialog class="exit-offer-dialog" id="exit-confirm-dialog" aria-labelledby="exit-confirm-title"><div class="exit-offer-card"><h2 id="exit-confirm-title">Are you sure you want to leave?</h2><p>Would you like to stay on this page or continue leaving?</p><button class="exit-offer-claim" id="exit-confirm-stay" type="button">Stay on this page</button><button class="exit-offer-reject" id="exit-confirm-leave" type="button">Continue exit</button></div></dialog><script defer src="/exit-offer.js"></script>`;
}

function publicPage({
  page,
  product,
  bundles = [],
  upsells = [],
  downsells = [],
  pixels = [],
  settings = defaultSettings,
  reviewsData = {
    summary: {
      count: 0,
      average: 0,
      breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    },
    reviews: [],
  },
  writtenPolicies = [],
  storefrontProduct = null,
  storefront = null,
  branding = storefront?.branding || null,
  storeData = null,
  exitOffer = null,
}) {
  const title = htmlEscape(page.title),
    store = htmlEscape(page.storeSlug),
    slug = htmlEscape(page.slug),
    storeName = String(storeData?.name || page.storeName || page.storeSlug),
    currency = String(
      storeData?.currency || page.storeCurrency || "INR",
    ).toUpperCase(),
    money = (minorUnits) => formatCurrency(minorUnits, currency);
  let content = {};
  try {
    content = JSON.parse(page.contentJson || "{}");
  } catch {}
  const template =
      pageTemplates.find((item) => item.key === page.templateKey) ||
      pageTemplates[0],
    tokens = template.designTokens,
    pageSettings = content.pageSettings || {},
    pageBackground = pageSettings.backgroundColor || tokens.background,
    pageText = pageSettings.textColor || tokens.text,
    pageAccent = pageSettings.primaryColor || branding?.primaryColor || tokens.accent,
    pageRadius = Number.isFinite(Number(pageSettings.borderRadius))
      ? `${Math.max(0, Math.min(80, Number(pageSettings.borderRadius)))}px`
      : tokens.radius,
    pageMaxWidth = Number.isFinite(Number(pageSettings.maxWidth))
      ? `${Math.max(720, Math.min(1800, Number(pageSettings.maxWidth)))}px`
      : "1180px",
    requestedPageFont = pageSettings.bodyFont || branding?.bodyFont,
    pageFont = ["Inter", "Georgia", "Arial", "Poppins"].includes(
      requestedPageFont,
    )
      ? requestedPageFont
      : tokens.font;
  const hero = content.hero || {
    eyebrow: "PRODUCT HIGHLIGHT",
    headline: page.title,
    subheadline: page.body,
  };
  const redirectUrl = String(content.redirectUrl || "").trim();
  const directCheckout = content.checkoutAction !== "redirect";
  const cod = settings.codForm || defaultSettings.codForm,
    checkoutSettings = settings.checkout || defaultSettings.checkout;
  const privacy = settings.privacy || defaultSettings.privacy;
  const storePrivacyPath = `/s/${encodeURIComponent(page.storeSlug)}/policies/privacy`;
  const configuredPrivacyLink = String(privacy.privacyPolicyLink || '').trim();
  const builtInPrivacyLink = ['/privacy', '/policies/privacy', storePrivacyPath].includes(configuredPrivacyLink);
  const privacyLink = builtInPrivacyLink
    ? (writtenPolicies.some(policy => policy.type === 'privacy') ? storePrivacyPath : '')
    : configuredPrivacyLink;
  const privacyBanner = privacy.cookieBannerEnabled
    ? `<aside id="cookie-banner" class="cookie-banner"><p>${htmlEscape(privacy.bannerMessage)}</p>${privacyLink ? `<a href="${htmlEscape(privacyLink)}">Privacy Policy</a>` : ""}<button id="accept-cookies" type="button">${htmlEscape(privacy.acceptButtonText)}</button><button id="reject-cookies" type="button">${htmlEscape(privacy.rejectButtonText)}</button></aside><script>document.querySelector('#accept-cookies').onclick=()=>{localStorage.setItem('commera2_tracking_consent_${Number(page.storeId)}','accepted');document.querySelector('#cookie-banner').remove();window.commera2LoadPixels?.()};document.querySelector('#reject-cookies').onclick=()=>{localStorage.setItem('commera2_tracking_consent_${Number(page.storeId)}','rejected');document.querySelector('#cookie-banner').remove()};if(localStorage.getItem('commera2_tracking_consent_${Number(page.storeId)}'))document.querySelector('#cookie-banner')?.remove()</script>`
    : "";
  const field = (
    key,
    name,
    type = "text",
    autocomplete = "off",
    attributes = "",
    helper = "",
    liveStatusId = "",
  ) => {
    const config = cod.fields[key];
    if (!config?.show) return "";
    const auto =
      cod.addressAutofill && checkoutSettings.addressAutofill
        ? autocomplete
        : "off";
    const placeholder = config.placeholder
      ? ` placeholder="${htmlEscape(config.placeholder)}"`
      : "";
    const required = config.required ? " required" : "";
    return `<label>${htmlEscape(config.label)}<input name="${name}" type="${type}" autocomplete="${htmlEscape(auto)}"${placeholder}${required}${attributes}></label>`;
  };
  const sections = (content.sections || [])
    .filter(
      (section) => !["proof", "reviews"].includes(String(section.type || "")),
    )
    .map((section) => {
      if (section.type === 'blocks') {
        const blockSettings = content.sectionSettings?.[section.id] || {};
        return section.visible === false || blockSettings.visible === false ? '' : `<section class="landing-section section-blocks${blockSettings.desktop === false ? ' blocks-hide-desktop' : ''}${blockSettings.mobile === false ? ' blocks-hide-mobile' : ''}" style="${blockSectionStyle(blockSettings)}">${renderBlocks(section.blocks || [])}</section>`;
      }
      const displaySection = section,
        type = String(displaySection.type || "text"),
        items = Array.isArray(displaySection.items)
          ? `<ul>${displaySection.items.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>`
          : "",
        mediaSource = String(displaySection.mediaDataUrl || "").trim(),
        mediaUrl = /^(?:https?:\/\/|data:(?:image\/(?:png|jpe?g|webp|gif)|video\/(?:mp4|webm));base64,)/i.test(
          mediaSource,
        )
          ? mediaSource
          : "",
        mediaLinkSource = String(displaySection.mediaLink || "").trim(),
        mediaLink = /^(?:https?:\/\/|\/|#)/i.test(mediaLinkSource)
          ? mediaLinkSource
          : "",
        mediaWidth = Math.max(
          10,
          Math.min(100, Number(displaySection.mediaWidth) || 100),
        ),
        isVideo =
          type === "video" ||
          String(displaySection.mediaType || "").startsWith("video/"),
        mediaElement = mediaUrl
          ? isVideo
            ? `<video class="landing-section-media" style="max-width:${mediaWidth}%" src="${htmlEscape(mediaUrl)}" controls preload="metadata"></video>`
            : `<img class="landing-section-media" style="max-width:${mediaWidth}%" src="${htmlEscape(mediaUrl)}" alt="${htmlEscape(displaySection.title || type.replaceAll("-", " "))}">`
          : "",
        linkedMedia =
          mediaElement && mediaLink
            ? `<a class="landing-section-media-link" href="${htmlEscape(mediaLink)}">${mediaElement}</a>`
            : mediaElement,
        copy = `<span class="section-label">${htmlEscape(type.replaceAll("_", " ").replaceAll("-", " "))}</span>${displaySection.title ? `<h2>${htmlEscape(displaySection.title)}</h2>` : ""}${displaySection.body ? `<p>${htmlEscape(displaySection.body)}</p>` : ""}${items}`;
      if (["image", "gif", "video"].includes(type))
        return `<section class="landing-section section-${htmlEscape(type)} section-media">${linkedMedia}${copy}</section>`;
      if (["image-with-text", "image-text"].includes(type))
        return `<section class="landing-section section-image-with-text ${displaySection.mediaPosition === "right" ? "media-right" : ""}"><div>${linkedMedia}</div><div>${copy}</div></section>`;
      return `<section class="landing-section section-${htmlEscape(type)}">${copy}</section>`;
    })
    .join("");
  const stars = (rating) =>
    "★".repeat(Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))) +
    "☆".repeat(
      5 - Math.max(0, Math.min(5, Math.round(Number(rating) || 0))),
    );
  const approvedReviewCards = reviewsData.reviews
    .map((review) => {
      const badges = [
          review.featured ? "Featured Review" : "",
          review.verifiedPurchase
            ? review.verificationSource === "imported"
              ? "Verified Purchase · Imported"
              : "Platform Verified Purchase"
            : "",
        ]
          .filter(Boolean)
          .map(
            (label) => `<span class="review-badge">${htmlEscape(label)}</span>`,
          )
          .join(""),
        video = review.videoUrl
          ? `<video class="review-video" controls preload="metadata" src="${htmlEscape(review.videoUrl)}"></video>`
          : "",
        reply = review.merchantReply
          ? `<div class="merchant-reply"><strong>Merchant reply</strong><p>${htmlEscape(review.merchantReply)}</p>${review.replyAt ? `<small>${htmlEscape(review.replyAt)}</small>` : ""}</div>`
          : "";
      return `<article class="review-card">${badges ? `<div class="review-badges">${badges}</div>` : ""}<div class="review-card-head"><strong>${htmlEscape(review.customerName)}</strong><span aria-label="${review.rating} out of 5 stars">${stars(review.rating)}</span></div>${review.title ? `<h3>${htmlEscape(review.title)}</h3>` : ""}${review.text ? `<p>${htmlEscape(review.text)}</p>` : ""}${review.images.length ? `<div class="review-images">${review.images.map((image) => `<img src="${image.dataUrl}" alt="Review image from ${htmlEscape(review.customerName)}">`).join("")}</div>` : ""}${video}${reply}<small>${htmlEscape(review.reviewDate || review.createdAt)}</small></article>`;
    })
    .join("");
  const ratingBreakdown = [5, 4, 3, 2, 1]
    .map((rating) => {
      const count = reviewsData.summary.breakdown[String(rating)] || 0,
        width = reviewsData.summary.count
          ? Math.round((count / reviewsData.summary.count) * 100)
          : 0;
      return `<li><span>${rating} ★</span><i><b style="width:${width}%"></b></i><strong>${count}</strong></li>`;
    })
    .join("");
  const reviewSection = `<section class="product-reviews" id="reviews"><div class="reviews-heading"><div><span class="eyebrow">CUSTOMER REVIEWS</span><h2>Customer Reviews</h2></div><button id="open-review-form" class="review-open" type="button">Write Review</button></div>${reviewsData.summary.count ? `<div class="reviews-summary"><strong>${Number(reviewsData.summary.average).toFixed(1)}</strong><div><span aria-label="${Number(reviewsData.summary.average).toFixed(1)} out of 5 stars">${stars(reviewsData.summary.average)}</span><p>Based on ${reviewsData.summary.count} approved ${reviewsData.summary.count === 1 ? "review" : "reviews"}</p></div><ul class="rating-breakdown">${ratingBreakdown}</ul></div><div class="review-list">${approvedReviewCards}</div>` : '<div class="reviews-empty"><strong>No reviews yet</strong><p>Be the first customer to share your experience.</p></div>'}<form id="review-form" hidden><div class="review-form-head"><div><span class="eyebrow">SHARE YOUR EXPERIENCE</span><h2>Write a Review</h2></div><button id="close-review-form" type="button" aria-label="Close review form">×</button></div><fieldset class="star-rating"><legend>Your Rating *</legend>${[5, 4, 3, 2, 1].map((rating) => `<input id="rating-${rating}" name="rating" type="radio" value="${rating}" aria-label="${rating} ${rating === 1 ? 'star' : 'stars'}" required><label for="rating-${rating}" title="${rating} stars">★</label>`).join("")}</fieldset><label>Your Name *<input name="customerName" required minlength="2" autocomplete="name"></label><label>Review Title<input name="title" maxlength="160"></label><label>Your Review *<textarea name="text" required maxlength="5000" rows="5"></textarea></label><div class="review-upload"><input id="review-images" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple><label for="review-images"><strong>Upload review photos</strong><span>JPG, PNG or WEBP · up to 5 images</span><b>Choose Images</b></label></div><div id="review-image-preview" class="review-images"></div><div class="review-form-actions"><button id="cancel-review" class="review-cancel" type="button">Cancel</button><button type="submit">Submit Review</button></div><p id="review-status" role="status"></p></form></section>`;
  const footerSection = (content.editorSections || []).find(
      (section) =>
        section.id === "policies-footer" || section.type === "policies-footer",
    ),
    footerSettings = footerSection
      ? content.sectionSettings?.[footerSection.id] || {}
      : {},
    policyEnabled = (type) =>
      ({
        "return-refund": footerSettings.showReturnPolicy,
        privacy: footerSettings.showPrivacyPolicy,
        terms: footerSettings.showTerms,
        shipping: footerSettings.showShippingPolicy,
        contact: footerSettings.showContact,
      })[type] !== false,
    footerPolicies = writtenPolicies.filter((policy) =>
      policyEnabled(policy.type),
    ),
    footerStyle = `text-align:${footerSettings.alignment || "center"};background:${footerSettings.backgroundColor || "transparent"};color:${footerSettings.textColor || "inherit"};padding:${Number(footerSettings.paddingTop) || 20}px ${Number(footerSettings.paddingRight) || 20}px ${Number(footerSettings.paddingBottom) || 20}px ${Number(footerSettings.paddingLeft) || 20}px`,
    policyFooter = footerPolicies.length
      ? `<footer class="store-policy-footer" style="${footerStyle}">${footerSettings.showStoreName !== false ? `<strong>${htmlEscape(storeName)}</strong>` : ""}<nav>${footerPolicies.map((policy) => `<a href="/s/${encodeURIComponent(page.storeSlug)}/policies/${encodeURIComponent(policy.type)}">${htmlEscape(policy.label)}</a>`).join("")}</nav></footer>`
      : "";
  const headerSection = (content.editorSections || []).find(
      (section) => section.id === "header" || section.type === "header",
    ),
    headerSettings = headerSection
      ? content.sectionSettings?.[headerSection.id] || {}
      : {},
    logoSource = headerSettings.logoSource || "store-logo",
    headerContent =
      logoSource === "custom-logo" && headerSettings.logoData
        ? `<img class="store-logo" src="${htmlEscape(headerSettings.logoData)}" alt="${htmlEscape(headerSettings.customLogoAlt || storeName)}">`
        : logoSource === "custom-text"
          ? `<strong>${htmlEscape(headerSettings.customText || storeName)}</strong>`
          : logoSource === "store-name"
            ? `<strong>${htmlEscape(storeName)}</strong>`
            : branding?.dataUrl
              ? `<img class="store-logo" src="${branding.dataUrl}" alt="${htmlEscape(branding.alt || storeName)}">`
              : `<strong>${htmlEscape(storeName)}</strong>`,
    storeHeader = `<header class="store-header"><a href="/s/${encodeURIComponent(page.storeSlug)}">${headerContent}</a></header>`;
  const sectionVisible = (type) => !(content.editorSections || []).some(
    (section) => (section.id === type || section.type === type) && section.visible === false,
  );
  const sharedWebsite = Boolean(storefront?.home?.banner);
  const site = storefront ? renderStoreChrome(storefront, writtenPolicies, {
    logoHtml: !sharedWebsite && headerSettings.logoSource ? headerContent : undefined,
    header: sharedWebsite || sectionVisible("header"),
    footer: sharedWebsite || sectionVisible("policies-footer"),
    announcement: sharedWebsite || sectionVisible("announcement-bar"),
  }) : null;
  if (site && !sharedWebsite && content.announcement && sectionVisible("announcement-bar"))
    site.announcement = `<div class="announcement">${htmlEscape(content.announcement)}</div>`;
  const storefrontDetails = storefrontProduct
    ? `<section class="product-storefront-details"><article class="product-rich-description">${storefrontProduct.description || product.description || ""}</article>${storefrontProduct.media.gif ? `<img class="product-gif" src="${storefrontProduct.media.gif.dataUrl}" alt="${htmlEscape(product.name)} demonstration" data-name="${htmlEscape(storefrontProduct.media.gif.name)}">` : ""}</section>`
    : "";
  const urgency =
    content.urgency &&
    content.urgency.enabled !== false &&
    content.urgency.type !== "none"
      ? content.urgency
      : null;
  const urgencyMessage = String(
    urgency?.text || "Limited stock available",
  ).replaceAll("{stock}", String(product.stock));
  const urgencyHtml = urgency
    ? `<div class="urgency" role="status"><strong>${htmlEscape(urgencyMessage)}</strong></div>`
    : "";
  const isImportedPage =
      page.creationMethod === "upload" && Boolean(page.importedHtml),
    imported = isImportedPage
      ? `<section class="imported-safe">${staticImportedPageHtml(page.importedHtml)}</section>`
      : "";
  const ctaText = htmlEscape(
    (content.ctaText || "").trim() || "Order with COD",
  );
  const checkoutHref = directCheckout ? "#" : redirectUrl;
  const media = storefrontProduct?.media || {},
    galleryMedia = [
      ...(media.main?.dataUrl
        ? [{ ...media.main, name: media.main?.name || product.name }]
        : []),
      ...(media.additional || []),
      ...(media.gif ? [media.gif] : []),
      ...(media.videos || []),
    ],
    renderProductMedia = (item, main = false) =>
      item?.type?.startsWith("video/")
        ? `<video ${main ? "controls" : "muted"} src="${item.dataUrl}" aria-label="${htmlEscape(item.name || product.name)}"></video>`
        : `<img src="${item.dataUrl}" alt="${main ? htmlEscape(product.name) : ""}">`,
    mainMedia = galleryMedia[0] || null,
    productGallery = mainMedia
      ? `<div class="product-gallery"><div class="product-main-media" id="product-main-media">${renderProductMedia(mainMedia, true)}</div>${galleryMedia.length > 1 ? `<div class="product-thumbnails">${galleryMedia.map((item, index) => `<button type="button" class="product-thumbnail ${index === 0 ? "active" : ""}" data-product-media="${item.dataUrl}" data-product-media-type="${htmlEscape(item.type || "image/jpeg")}" data-product-media-name="${htmlEscape(item.name || product.name)}" aria-label="View ${htmlEscape(item.name || `product media ${index + 1}`)}">${renderProductMedia(item)}</button>`).join("")}</div>` : ""}</div>`
      : "",
    ratingMarkup = reviewsData.summary.count
      ? `<a class="product-rating" href="#reviews"><span aria-label="${Number(reviewsData.summary.average).toFixed(1)} out of 5 stars">${stars(reviewsData.summary.average)}</span><strong>${Number(reviewsData.summary.average).toFixed(1)}</strong><small>${reviewsData.summary.count} ${reviewsData.summary.count === 1 ? "Review" : "Reviews"}</small></a>`
      : '<a class="product-rating empty-rating" href="#reviews"><span>☆☆☆☆☆</span><small>No reviews yet</small></a>',
    discountPercent = product.comparePricePaise
      ? Math.max(
          0,
          Math.round(
            (1 - product.pricePaise / product.comparePricePaise) * 100,
          ),
        )
      : 0,
    heroBundleOptions = bundles.length
      ? `<fieldset class="hero-bundles"><legend>Choose an option</legend><label><input type="radio" name="heroBundleId" value="" data-quantity="1" data-price="${product.pricePaise}" checked><span><strong>Single item</strong><small>${money(product.pricePaise)}</small></span></label>${bundles.map((bundle) => `<label><input type="radio" name="heroBundleId" value="${bundle.id}" data-quantity="${bundle.quantity}" data-price="${bundle.pricePaise}"><span><strong>${htmlEscape(bundle.name)}</strong><small>${bundle.quantity} items · ${money(bundle.pricePaise)}</small></span></label>`).join("")}</fieldset>`
      : "",
    heroProductInfo = `<div class="product-purchase"><span class="eyebrow">${htmlEscape(hero.eyebrow || "SHOP THE PRODUCT")}</span><p class="product-name">${htmlEscape(product.name)}</p><h1>${htmlEscape(hero.headline || product.name)}</h1>${ratingMarkup}<div class="product-price"><strong id="hero-price">${money(product.pricePaise)}</strong>${product.comparePricePaise ? `<del>${money(product.comparePricePaise)}</del>` : ""}${discountPercent ? `<b>Save ${discountPercent}%</b>` : ""}</div>${hero.subheadline || product.description ? `<p class="product-short-description">${htmlEscape(hero.subheadline || product.description)}</p>` : ""}${urgencyHtml}${heroBundleOptions}<label class="hero-quantity">Quantity<input id="hero-quantity" type="number" min="1" max="${product.stock}" value="1"></label><a href="${checkoutHref}" class="hero-cta" ${directCheckout ? 'data-direct-checkout="true"' : ""}>${ctaText}</a><small class="buy-note">Cash on Delivery available · Secure order confirmation</small><small id="checkout-launch-status" class="checkout-launch-status" role="status"></small></div>`;
  // Upsells are offered only after the main order has been created.
  const upsellOptions = "";
  const downsellOptions = downsells.length
    ? `<fieldset class="bundle-options downsell-options"><legend>COD Downsell</legend><p>Prefer a lower-priced alternative?</p><label class="bundle-choice"><input type="radio" name="downsellId" value="" checked><span><strong>Keep original product</strong><small>${htmlEscape(product.name)} · ${money(product.pricePaise)}</small></span></label>${downsells.map((downsell) => `<label class="bundle-choice"><input type="radio" name="downsellId" value="${downsell.id}"><span><strong>${htmlEscape(downsell.title)}</strong><small>${htmlEscape(downsell.downsellProductName)} · ${money(downsell.pricePaise)}</small></span></label>`).join("")}</fieldset>`
    : "";
  const checkout =
    cod.enabled && checkoutSettings.enabled && content.codEnabled !== false
      ? `
  <section class="checkout-wrap" id="checkout"><div class="checkout-form-panel buy-card"><span class="eyebrow">CASH ON DELIVERY</span><h2>${htmlEscape(cod.heading)}</h2><p>${htmlEscape(cod.subheading || "Complete your verified delivery details to place this COD order.")}</p><form id="cod-form"><input name="bundleId" type="hidden" value=""><div class="checkout-fields"><label>Quantity<input name="quantity" type="number" min="1" max="${product.stock}" value="1" required></label>${cod.summary.couponField && checkoutSettings.couponField ? '<label>Discount coupon code<input name="couponCode" autocomplete="off" placeholder="SAVE10"></label>' : ""}${field("fullName", "name", "text", "name", ' minlength="2" pattern=".*[A-Za-z].*"')}${field("phone", "phone", "tel", "tel", ' inputmode="numeric" pattern="[6-9][0-9]{9}" maxlength="10"')}${field("alternatePhone", "alternatePhone", "tel", "tel", ' inputmode="numeric" pattern="[6-9][0-9]{9}" maxlength="10"')}${field("email", "email", "email", "email")}${field("address1", "address", "text", "street-address", ' minlength="10"')}${field("address2", "addressLine2", "text", "address-line2")}${field("landmark", "landmark", "text", "off")}${field("pincode", "pincode", "text", "postal-code", ' inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength="6"')}<p id="pincode-status" role="status"></p>${field("city", "city", "text", "address-level2", ' pattern="[A-Za-z ]{2,}"')}${cod.fields.state.show ? `<label>${htmlEscape(cod.fields.state.label)}<select name="state" autocomplete="${cod.addressAutofill && checkoutSettings.addressAutofill ? "address-level1" : "off"}"${cod.fields.state.required ? " required" : ""}><option value="">${htmlEscape(cod.fields.state.placeholder || "Select state")}</option>${indianStates.map((state) => `<option value="${state}">${state}</option>`).join("")}</select></label>` : ""}${field("country", "country", "text", "country-name", " readonly")}</div>${upsellOptions}${downsellOptions}<fieldset class="payment-option"><legend>Payment method</legend><label><input type="radio" name="paymentMethod" value="cod" checked required><strong>Cash on Delivery (COD)</strong></label><small>Pay when your order reaches you.</small></fieldset><label class="field checkbox checkout-terms"><input name="termsAccepted" type="checkbox" checked required> <span>I agree to the Terms &amp; Conditions and confirm this COD order.</span></label><label aria-hidden="true" style="position:absolute;left:-10000px">Website<input name="website" tabindex="-1" autocomplete="off"></label><button class="place-order-button" type="submit" ${product.stock < 1 || !cod.buttonEnabled ? "disabled" : ""}>${htmlEscape(cod.submitButtonText)}</button><p id="status" role="status"></p></form></div>${upsellOptions}${downsellOptions}<aside class="checkout-summary checkout-copy"><span class="eyebrow">ORDER SUMMARY</span><div class="checkout-product">${mainMedia?.type?.startsWith("image/") ? `<img src="${mainMedia.dataUrl}" alt="${htmlEscape(product.name)}">` : `<span>${htmlEscape(product.name.charAt(0))}</span>`}<div><strong>${htmlEscape(product.name)}</strong><small id="summary-bundle">Single item · Quantity 1</small></div></div><dl><div><dt>Product</dt><dd id="summary-product-price">${money(product.pricePaise)}</dd></div><div><dt>Discount</dt><dd id="summary-discount">—</dd></div><div><dt>Shipping</dt><dd>Calculated by location</dd></div><div class="summary-total"><dt>Total</dt><dd class="price" id="checkout-price">${money(product.pricePaise)}</dd></div></dl><p class="stock">${product.stock > 0 ? `${product.stock} available` : "Out of stock"}</p><small>Final price, bundle, discounts, and shipping are confirmed before the COD order is placed.</small></aside></section>`
      : "";
  const checkoutSection = (content.editorSections || []).find(
      (section) =>
        section.id === "checkout-button" || section.type === "checkout-button",
    ),
    checkoutDisplay = checkoutSection
      ? content.sectionSettings?.[checkoutSection.id] || {}
      : {},
    stickyMobile = checkoutDisplay.stickyMobile !== false,
    sameTab = checkoutDisplay.sameTab !== false,
    customerExperienceScript = `<script>(()=>{const checkout=document.querySelector('#checkout'),form=document.querySelector('#cod-form'),firstField=form?.querySelector('[name="name"]'),quantity=form?.querySelector('[name="quantity"]'),bundleField=form?.querySelector('[name="bundleId"]'),summaryBundle=document.querySelector('#summary-bundle'),summaryPrice=document.querySelector('#summary-product-price'),heroPrice=document.querySelector('#hero-price'),submit=form?.querySelector('.place-order-button');document.querySelectorAll('a.hero-cta[href="#checkout"]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();checkout?.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>firstField?.focus({preventScroll:true}),550)}));document.querySelectorAll('[data-product-media]').forEach(button=>button.addEventListener('click',()=>{const host=document.querySelector('#product-main-media'),type=button.dataset.productMediaType||'image/jpeg',name=button.dataset.productMediaName||'Product media';if(host)host.innerHTML=type.startsWith('video/')?'<video controls src="'+button.dataset.productMedia+'" aria-label="'+name.replace(/["<>]/g,'')+'"></video>':'<img src="'+button.dataset.productMedia+'" alt="'+name.replace(/["<>]/g,'')+'">';document.querySelectorAll('[data-product-media]').forEach(item=>item.classList.toggle('active',item===button))}));document.querySelectorAll('[name="heroBundleId"]').forEach(option=>option.addEventListener('change',()=>{if(!option.checked)return;if(bundleField)bundleField.value=option.value;if(quantity){quantity.value=option.dataset.quantity||1;quantity.readOnly=Boolean(option.value);quantity.dispatchEvent(new Event('input',{bubbles:true}))}const label=option.closest('label')?.querySelector('strong')?.textContent||'Single item',formatted=FORMAT_MONEY(Number(option.dataset.price||${Number(product.pricePaise)}));if(summaryBundle)summaryBundle.textContent=label+' · Quantity '+(option.dataset.quantity||1);if(summaryPrice)summaryPrice.textContent=formatted;if(heroPrice)heroPrice.textContent=formatted}));const reviewForm=document.querySelector('#review-form'),openReview=document.querySelector('#open-review-form'),closeReview=document.querySelector('#close-review-form'),cancelReview=document.querySelector('#cancel-review');const showReview=show=>{if(!reviewForm)return;reviewForm.hidden=!show;if(show){document.querySelector('#review-status').textContent='';reviewForm.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>reviewForm.querySelector('[name="rating"]')?.focus(),350)}};openReview?.addEventListener('click',()=>showReview(true));closeReview?.addEventListener('click',()=>showReview(false));cancelReview?.addEventListener('click',()=>showReview(false));const filesInput=document.querySelector('#review-images'),preview=document.querySelector('#review-image-preview');let chosenFiles=[];reviewForm?.addEventListener('reset',()=>{chosenFiles=[];if(preview)preview.innerHTML=''});const syncFiles=()=>{if(typeof DataTransfer==='undefined')return;const transfer=new DataTransfer();chosenFiles.forEach(file=>transfer.items.add(file));filesInput.files=transfer.files};const drawFiles=()=>{if(!preview)return;preview.innerHTML='';chosenFiles.forEach((file,index)=>{const item=document.createElement('span'),image=document.createElement('img'),remove=document.createElement('button');image.src=URL.createObjectURL(file);image.alt='Selected review image';remove.type='button';remove.textContent='Remove';remove.addEventListener('click',()=>{chosenFiles.splice(index,1);syncFiles();drawFiles()});item.append(image,remove);preview.append(item)})};filesInput?.addEventListener('change',()=>{chosenFiles=[...filesInput.files].slice(0,5);syncFiles();drawFiles()});const pincodeStatus=document.querySelector('#pincode-status');if(pincodeStatus){const cleanStatus=()=>{const value=pincodeStatus.textContent;if(value==='Checking delivery location…')pincodeStatus.textContent='Fetching location...';else if(value.startsWith('Delivery available · ')){const location=value.replace('Delivery available · ','').replace(/, India$/,'');pincodeStatus.textContent='✓ Delivery available in '+location;pincodeStatus.dataset.state='success'}else if(value==='Please enter a valid pincode')pincodeStatus.textContent='Please enter a valid six-digit pincode.';else if(value==='Delivery is not available at this pincode')pincodeStatus.textContent='Sorry, delivery is currently unavailable at this pincode.'};new MutationObserver(cleanStatus).observe(pincodeStatus,{childList:true,characterData:true,subtree:true})}if(submit&&!form?.querySelector('[name="pincode"]')?.value)submit.disabled=true;})();</script>`;
  const directCheckoutScript = directCheckout
    ? `<script>(()=>{document.querySelectorAll('.imported-safe a[href="#buy"],.imported-safe a[href="#checkout"],.imported-safe a[class*="btn"],.imported-safe a[class*="cta"],.imported-safe button[class*="btn"],.imported-safe button[class*="cta"]').forEach(button=>button.dataset.directCheckout='true');const STORE=${scriptJson(page.storeSlug)},PAGE=${scriptJson(page.slug)},SAME_TAB=${sameTab},quantity=document.querySelector('#hero-quantity'),buttons=[...document.querySelectorAll('[data-direct-checkout]')],launchStatus=document.querySelector('#checkout-launch-status'),deviceKey='commera2-device-id';let deviceId=localStorage.getItem(deviceKey);if(!deviceId){deviceId=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);localStorage.setItem(deviceKey,deviceId)}document.querySelectorAll('[name="heroBundleId"]').forEach(option=>option.addEventListener('change',()=>{if(!option.checked)return;const chosen=Number(option.dataset.quantity||1);if(quantity){quantity.value=chosen;quantity.readOnly=Boolean(option.value)}const price=document.querySelector('#hero-price');if(price)price.textContent=FORMAT_MONEY(Number(option.dataset.price||${Number(product.pricePaise)}))}));buttons.forEach(button=>button.addEventListener('click',async event=>{event.preventDefault();if(button.dataset.loading==='true')return;if(launchStatus)launchStatus.textContent='';const selected=document.querySelector('[name="heroBundleId"]:checked'),payload={intent:'open',quantity:Number(selected?.dataset.quantity||quantity?.value||1),bundleId:selected?.value?Number(selected.value):null,visitorSessionId:window.commera2VisitorSessionId||null,checkoutToken:VISITOR_TOKEN,deviceId,analyticsConsentGranted:window.commera2AnalyticsConsent?.()??false,consentGranted:window.commera2TrackingConsent?window.commera2TrackingConsent():true,behavior:{timeOnPageMs:Math.round(performance.now()),source:'product_page'}};let nextWindow=null;if(!SAME_TAB)nextWindow=open('about:blank','_blank');buttons.forEach(item=>{item.dataset.loading='true';item.setAttribute('aria-disabled','true');item.dataset.label=item.textContent;item.textContent='Opening checkout…'});try{const response=await fetch('/api/public/'+encodeURIComponent(STORE)+'/'+encodeURIComponent(PAGE)+'/checkouts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),out=await response.json();if(!response.ok)throw Error(out.error||'Could not open checkout');const url='/s/'+encodeURIComponent(STORE)+'/checkout/'+encodeURIComponent(out.id);if(nextWindow)nextWindow.location=url;else location.assign(url)}catch(error){nextWindow?.close();buttons.forEach(item=>{item.dataset.loading='false';item.removeAttribute('aria-disabled');item.textContent=item.dataset.label||${scriptJson(String(content.ctaText || "Buy Now"))}});if(launchStatus)launchStatus.textContent=error.message||'Could not open checkout'}}))})();</script>`
      : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${branding?.favicon?.dataUrl ? `<link rel="icon" href="${branding.favicon.dataUrl}">` : ""}<link rel="stylesheet" href="/store.css"></head><body class="theme-${htmlEscape(template.key)}${site ? " store-site-shell" : ""}" style="${site?.style || ""}--page-bg:${htmlEscape(pageBackground)};--page-surface:${tokens.surface};--page-text:${htmlEscape(pageText)};--page-muted:${tokens.muted};--page-accent:${htmlEscape(pageAccent)};--page-accent-text:${tokens.accentText};--page-radius:${htmlEscape(pageRadius)};--page-font:${htmlEscape(pageFont)};--page-max-width:${htmlEscape(pageMaxWidth)}">
  ${privacyBanner}${isImportedPage ? "" : site ? site.announcement + site.header : content.announcement ? `<div class="announcement">${htmlEscape(content.announcement)}</div>` : ""}<main class="landing${isImportedPage ? " imported-page" : ""}">${isImportedPage ? imported : `${site ? "" : storeHeader}<section class="landing-hero ${productGallery ? "" : "no-media"}">${productGallery}${heroProductInfo}</section>${storefrontDetails}<div class="section-grid">${sections}</div>${reviewSection}${site ? "" : policyFooter}`}
  </main>${isImportedPage ? "" : site?.footer || ""}
  ${stickyMobile ? `<div class="sticky-mobile-buy"><strong>${money(product.pricePaise)}</strong><a href="${checkoutHref}" class="hero-cta" ${directCheckout ? 'data-direct-checkout="true"' : ""}>${ctaText}</a></div>` : ""}
  ${pixelScripts(pixels, page.storeId, page.slug, { privacy })}<script>const STORE='${store}',PAGE='${slug}',STORE_ID=${product.storeId},CURRENCY='${htmlEscape(currency)}',FORMAT_MONEY=value=>new Intl.NumberFormat(undefined,{style:'currency',currency:CURRENCY,maximumFractionDigits:2}).format(Number(value||0)/100);window.commera2ProductId=${Number(product.id)};window.commera2PageId=${Number(page.id)};if(window.trackCommerceEvent){trackCommerceEvent('page_view',{pageId:${Number(page.id)}});trackCommerceEvent('product_view',{productId:${Number(product.id)},pageId:${Number(page.id)},quantity:1,productPrice:${Number(product.pricePaise) / 100},currency:CURRENCY});}const reviewForm=document.querySelector('#review-form'),reviewStatus=document.querySelector('#review-status'),reviewFiles=reviewForm?.querySelector('[name="images"]'),reviewPreview=document.querySelector('#review-image-preview'),reviewSubmit=reviewForm?.querySelector('[type="submit"]');let reviewSubmitting=false;const filePayload=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,type:file.type,data:String(reader.result).split(',')[1]});reader.onerror=()=>reject(Error('Could not read review image'));reader.readAsDataURL(file)});if(reviewFiles)reviewFiles.addEventListener('change',()=>{reviewPreview.innerHTML='';for(const file of [...reviewFiles.files].slice(0,5)){const image=document.createElement('img');image.src=URL.createObjectURL(file);image.alt='Selected review image';reviewPreview.appendChild(image)}});if(reviewForm)reviewForm.addEventListener('submit',async event=>{event.preventDefault();if(reviewSubmitting)return;reviewSubmitting=true;reviewSubmit.disabled=true;reviewStatus.textContent='';try{const files=[...reviewFiles.files];if(files.length>5)throw Error('A review can have at most 5 images');if(files.some(file=>file.size>1024*1024))throw Error('Each review image must be 1 MB or smaller');const values=Object.fromEntries(new FormData(reviewForm));values.rating=Number(values.rating);const images=await Promise.all(files.map(filePayload));const response=await fetch('/api/public/stores/'+STORE_ID+'/products/${Number(product.id)}/reviews',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...values,images})}),out=await response.json();if(!response.ok)throw Error(out.error);reviewForm.reset();reviewPreview.innerHTML='';reviewForm.hidden=true;document.querySelector('#open-review-form')?.focus({preventScroll:true});}catch(error){reviewStatus.textContent=error.message;}finally{reviewSubmitting=false;reviewSubmit.disabled=false;}});</script>${customerExperienceScript}${directCheckoutScript}${exitOfferExperience({ offer: exitOffer, storeId: page.storeId, storeSlug: page.storeSlug, pageId: page.id, pageSlug: page.slug, productId: product.id, currency, context: "product_page" })}</body></html>`;
}

function checkoutPage({
  checkout,
  page,
  product,
  bundle = null,
  upsells = [],
  downsells = [],
  pixels = [],
  settings = defaultSettings,
  storefrontProduct = null,
  storefront = null,
  branding = storefront?.branding || null,
  writtenPolicies = [],
  exitOffer = null,
}) {
  const site = renderStoreChrome(storefront, writtenPolicies);
  let content = {};
  try {
    content = JSON.parse(page.contentJson || "{}");
  } catch {}
  const template =
      pageTemplates.find((item) => item.key === page.templateKey) ||
      pageTemplates[0],
    tokens = template.designTokens,
    pageSettings = content.pageSettings || {},
    cod = settings.codForm || defaultSettings.codForm,
    checkoutSettings = settings.checkout || defaultSettings.checkout,
    privacy = settings.privacy || defaultSettings.privacy,
    currency = String(page.storeCurrency || "INR").toUpperCase(),
    format = (value) => formatCurrency(value, currency),
    value = (input) => htmlEscape(input ?? ""),
    selectedQuantity = Number(checkout.quantity || bundle?.quantity || 1),
    selectedPrice = bundle?.pricePaise || product.pricePaise,
    mainMedia = storefrontProduct?.media?.main || null;
  const field = (
    key,
    name,
    type = "text",
    autocomplete = "off",
    attributes = "",
    helper = "",
    liveStatusId = "",
  ) => {
    const config = cod.fields[key];
    if (!config?.show) return "";
    const auto =
        cod.addressAutofill && checkoutSettings.addressAutofill
          ? autocomplete
          : "off",
      placeholder = config.placeholder
        ? ` placeholder="${htmlEscape(config.placeholder)}"`
        : "",
      required = config.required ? " required" : "",
      optional = config.required
        ? ""
        : '<small class="checkout-field-optional">Optional</small>',
      readonly = attributes.includes("readonly")
        ? " checkout-field--readonly"
        : "";
    return `<label class="checkout-field${readonly}" data-field="${name}"><span class="checkout-field-label">${htmlEscape(config.label)}${optional}</span><input id="checkout-${name}" name="${name}" type="${type}" autocomplete="${htmlEscape(auto)}" value="${value(checkout[name])}" aria-describedby="${liveStatusId ? `${liveStatusId} ` : ""}error-${name}"${placeholder}${required}${attributes}>${helper ? `<small class="checkout-field-help">${htmlEscape(helper)}</small>` : ""}${liveStatusId ? `<small id="${liveStatusId}" class="checkout-field-help checkout-field-live" role="status"></small>` : ""}<small class="checkout-field-error" id="error-${name}" data-error-for="${name}" role="alert"></small></label>`;
  };
  const offerOptions = "",
    downsellOptions = downsells.length
      ? `<fieldset class="bundle-options downsell-options"><legend>Lower-priced alternative</legend><label class="bundle-choice"><input type="radio" name="downsellId" value="" ${checkout.downsellId ? "" : "checked"}><span><strong>Keep original product</strong><small>${htmlEscape(product.name)}</small></span></label>${downsells.map((downsell) => `<label class="bundle-choice"><input type="radio" name="downsellId" value="${downsell.id}" ${Number(checkout.downsellId) === Number(downsell.id) ? "checked" : ""}><span><strong>${htmlEscape(downsell.title)}</strong><small>${htmlEscape(downsell.downsellProductName)} · ${format(downsell.pricePaise)}</small></span></label>`).join("")}</fieldset>`
      : "",
    policyLinks = writtenPolicies.length
      ? `<nav class="checkout-policy-links">${writtenPolicies.map((policy) => `<a href="/s/${encodeURIComponent(page.storeSlug)}/policies/${encodeURIComponent(policy.type)}">${htmlEscape(policy.label)}</a>`).join("")}</nav>`
      : "",
    headerContent = branding?.dataUrl
      ? `<img class="store-logo" src="${branding.dataUrl}" alt="${htmlEscape(branding.alt || page.storeName)}">`
      : `<strong>${htmlEscape(page.storeName || page.storeSlug)}</strong>`,
    giftCard = `<details class="checkout-coupon-disclosure"${checkout.giftCardCode ? " open" : ""}><summary>Have a gift card?</summary><div class="checkout-coupon"><label for="checkout-gift-card-code">Gift card code</label><input id="checkout-gift-card-code" name="giftCardCode" value="${value(checkout.giftCardCode)}" autocomplete="off" placeholder="Enter code"><small class="checkout-coupon-status">Gift card credit is applied before the COD amount is confirmed.</small></div></details>`,
    coupon =
      (cod.summary.couponField && checkoutSettings.couponField
        ? `<details class="checkout-coupon-disclosure"${checkout.couponCode ? " open" : ""}><summary>Have a coupon?</summary><div class="checkout-coupon"><label for="checkout-coupon-code">Coupon code</label><div><input id="checkout-coupon-code" name="couponCode" value="${value(checkout.couponCode)}" autocomplete="off" placeholder="Enter code"><button id="apply-coupon" type="button">Apply</button></div><small id="coupon-status" class="checkout-coupon-status" role="status"></small></div></details>`
        : "") + giftCard,
    primaryContactFields = `${field("fullName", "name", "text", "name", ' minlength="2" pattern=".*[A-Za-z].*"')}${field("phone", "phone", "tel", "tel", ' inputmode="numeric" pattern="[6-9][0-9]{9}" maxlength="10"', "Used for delivery updates and order confirmation.")}`,
    optionalContactFields = `${field("alternatePhone", "alternatePhone", "tel", "tel", ' inputmode="numeric" pattern="[6-9][0-9]{9}" maxlength="10"')}${field("email", "email", "email", "email")}`,
    optionalContact = optionalContactFields
      ? `<details class="checkout-secondary-contact"${checkout.alternatePhone || checkout.email ? " open" : ""}><summary>Add more contact information</summary><div class="checkout-fields">${optionalContactFields}</div></details>`
      : "",
    deliveryFields = `${field("address1", "address", "text", "street-address", ' minlength="10"')}${field("address2", "addressLine2", "text", "address-line2")}${field("landmark", "landmark", "text", "off")}${field("pincode", "pincode", "text", "postal-code", ' inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength="6"', "City and state fill automatically.", "pincode-status")}${field("city", "city", "text", "address-level2", ' pattern="[A-Za-z ]{2,}" readonly aria-readonly="true"')}${field("state", "state", "text", "address-level1", ' readonly aria-readonly="true"')}${field("country", "country", "text", "country-name", ' readonly aria-readonly="true"')}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout · ${htmlEscape(product.name)}</title>${branding?.favicon?.dataUrl ? `<link rel="icon" href="${branding.favicon.dataUrl}">` : ""}<link rel="stylesheet" href="/store.css"></head><body class="checkout-page theme-${htmlEscape(template.key)} store-site-shell" style="${site.style}--checkout-accent:${htmlEscape(pageSettings.primaryColor || branding?.primaryColor || tokens.accent)};--page-bg:${htmlEscape(pageSettings.backgroundColor || tokens.background)};--page-surface:${tokens.surface};--page-text:${htmlEscape(pageSettings.textColor || tokens.text)};--page-muted:${tokens.muted};--page-accent:${htmlEscape(pageSettings.primaryColor || branding?.primaryColor || tokens.accent)};--page-accent-text:${tokens.accentText};--page-radius:${Math.max(0, Math.min(80, Number(pageSettings.borderRadius) || 14))}px;--page-font:${htmlEscape(pageSettings.bodyFont || branding?.bodyFont || tokens.font)};--page-max-width:${Math.max(720, Math.min(1800, Number(pageSettings.maxWidth) || 1180))}px">
  ${site.announcement}${site.header}<header class="checkout-header"><a href="/s/${encodeURIComponent(page.storeSlug)}/${encodeURIComponent(page.slug)}">${site.header ? "← Back to product" : headerContent}</a><span>Secure checkout</span></header>
  <main class="checkout-shell"><div class="checkout-progress" aria-label="Checkout progress"><strong class="is-complete">Contact</strong><i></i><strong aria-current="step">Delivery</strong><i></i><strong>Confirm</strong></div>
  <form id="cod-form" class="checkout-wrap dedicated-checkout-form"><input name="bundleId" type="hidden" value="${bundle?.id || ""}"><input name="quantity" type="hidden" value="${selectedQuantity}">
    <section class="checkout-form-panel buy-card"><div class="checkout-intro"><span class="eyebrow">SECURE CASH ON DELIVERY</span><h1>${htmlEscape(cod.heading)}</h1><p>${htmlEscape(cod.subheading || "Enter your delivery details to confirm this order.")}</p></div><section class="checkout-section" aria-labelledby="contact-heading"><div class="checkout-section-heading"><span>1</span><div><small>Contact</small><h2 id="contact-heading">How can we reach you?</h2></div></div><div class="checkout-fields checkout-fields--contact">${primaryContactFields}</div>${optionalContact}</section><section class="checkout-section" aria-labelledby="delivery-heading"><div class="checkout-section-heading"><span>2</span><div><small>Delivery</small><h2 id="delivery-heading">Where should we deliver?</h2></div></div><div class="checkout-fields checkout-fields--delivery">${deliveryFields}</div></section>${offerOptions}${downsellOptions}<section class="checkout-section checkout-payment" aria-labelledby="payment-heading"><div class="checkout-section-heading"><span>3</span><div><small>Confirm</small><h2 id="payment-heading">Payment method</h2></div></div><label class="payment-option"><input type="radio" name="paymentMethod" value="cod" checked required><span><strong>Cash on Delivery (COD)</strong><small>Pay when your order reaches you. No online payment required.</small></span><b aria-hidden="true">✓</b></label><div class="checkout-terms-wrap" data-field="termsAccepted"><label class="checkout-terms"><input name="termsAccepted" type="checkbox" checked required aria-describedby="error-termsAccepted"><span>I agree to the Terms &amp; Conditions and confirm this COD order.</span></label><small class="checkout-field-error" id="error-termsAccepted" data-error-for="termsAccepted" role="alert"></small></div><label aria-hidden="true" class="checkout-honeypot">Website<input name="website" tabindex="-1" autocomplete="off"></label><button class="place-order-button" type="submit" ${product.stock < 1 || !cod.buttonEnabled ? "disabled" : ""}>${htmlEscape(cod.submitButtonText)}</button><p id="status" class="checkout-form-status" role="alert" hidden></p><ul class="checkout-trust" aria-label="Checkout assurances"><li><span aria-hidden="true">✓</span> Cash on Delivery</li><li><span aria-hidden="true">✓</span> Secure checkout</li><li><span aria-hidden="true">✓</span> Delivery verified by pincode</li></ul></section></section>
    <aside class="checkout-summary checkout-copy is-collapsed"><button class="checkout-summary-toggle" id="checkout-summary-toggle" type="button" aria-expanded="false" aria-controls="checkout-summary-body"><span>Order summary</span><strong id="checkout-total-compact">${format(checkout.totalPaise)}</strong><i aria-hidden="true"></i></button><div class="checkout-summary-body" id="checkout-summary-body"><span class="eyebrow">ORDER SUMMARY</span><div class="checkout-product">${mainMedia?.type?.startsWith("image/") ? `<img src="${mainMedia.dataUrl}" alt="${htmlEscape(product.name)}">` : `<span>${htmlEscape(product.name.charAt(0))}</span>`}<div><strong>${htmlEscape(product.name)}</strong><small>${bundle ? htmlEscape(bundle.name) : "Single item"} · Quantity ${selectedQuantity}</small></div></div><dl><div><dt>Product</dt><dd id="summary-product-price">${format(selectedPrice)}</dd></div><div><dt>Discount</dt><dd id="summary-discount">${checkout.discountPaise ? `−${format(checkout.discountPaise)}` : "—"}</dd></div><div><dt>Shipping</dt><dd id="summary-shipping">${checkout.shippingPaise ? format(checkout.shippingPaise) : "Calculated by location"}</dd></div><div class="summary-total"><dt>Total</dt><dd class="price" id="checkout-price">${format(checkout.totalPaise)}</dd></div></dl>${coupon}<p class="stock">${product.stock > 0 ? `${product.stock} available` : "Out of stock"}</p><small>Price, discount, and shipping are calculated securely by the store.</small></div></aside>
  </form>${policyLinks}</main>${site.footer}
  <script>window.commera2CheckoutSessionId=${scriptJson(checkout.id)};window.commera2StoreId=${Number(page.storeId)};window.commera2ProductId=${Number(product.id)};window.commera2PageId=${Number(page.id)};</script>${pixelScripts(pixels, page.storeId, page.slug, { privacy })}
  <script>const SESSION_ID=${scriptJson(checkout.id)},STORE_ID=${Number(page.storeId)},CURRENCY=${scriptJson(currency)},SAVE_INCOMPLETE=${Boolean(cod.saveIncompleteCheckout && checkoutSettings.captureAbandonedCheckout && privacy.allowAbandonedCheckoutData)},FORMAT_MONEY=value=>new Intl.NumberFormat(undefined,{style:'currency',currency:CURRENCY,maximumFractionDigits:2}).format(Number(value||0)/100);const form=document.querySelector('#cod-form'),status=document.querySelector('#status'),price=document.querySelector('#checkout-price'),discount=document.querySelector('#summary-discount'),shipping=document.querySelector('#summary-shipping'),pincode=form.querySelector('[name="pincode"]'),city=form.querySelector('[name="city"]'),state=form.querySelector('[name="state"]'),country=form.querySelector('[name="country"]'),pincodeStatus=document.querySelector('#pincode-status'),submitButton=form.querySelector('.place-order-button'),applyCoupon=document.querySelector('#apply-coupon');let timer,pincodeReady=${checkout.pincodeValidated ? "true" : "false"},validatedPincode=${scriptJson(checkout.pincodeValidated ? checkout.pincode : "")};function setSummary(out){price.textContent=FORMAT_MONEY(out.totalPaise);if(discount)discount.textContent=out.discountPaise?'−'+FORMAT_MONEY(out.discountPaise):'—';if(shipping)shipping.textContent=out.shippingPaise?FORMAT_MONEY(out.shippingPaise):'Calculated by location';status.textContent=out.discountPaise?'Coupon '+out.couponCode+' applied · You save '+FORMAT_MONEY(out.discountPaise):'Details saved';}function values(intent='draft'){const data=Object.fromEntries(new FormData(form));data.intent=intent;data.quantity=Number(data.quantity||1);data.bundleId=data.bundleId?Number(data.bundleId):null;data.upsellId=data.upsellId?Number(data.upsellId):null;data.downsellId=data.downsellId?Number(data.downsellId):null;data.storeId=STORE_ID;data.analyticsConsentGranted=window.commera2AnalyticsConsent?.()??false;data.consentGranted=window.commera2TrackingConsent?window.commera2TrackingConsent():true;return data;}async function save(intent='draft'){const response=await fetch('/api/public/checkouts/'+encodeURIComponent(SESSION_ID),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(values(intent))}),out=await response.json();if(!response.ok)throw Error(out.error||'Could not save checkout');setSummary(out);return out;}async function lookupPincode(force=false){const code=String(pincode?.value||'').trim();if(!/^[1-9][0-9]{5}$/.test(code)){pincodeReady=false;validatedPincode='';submitButton.disabled=true;if(city)city.value='';if(state)state.value='';if(country)country.value='';if(pincodeStatus)pincodeStatus.textContent=code.length>=6||force?'Please enter a valid six-digit pincode.':'';if(force)throw Error('Please enter a valid pincode');return false;}if(pincodeReady&&validatedPincode===code)return true;submitButton.disabled=true;if(pincodeStatus)pincodeStatus.textContent='Fetching location...';try{const response=await fetch('/api/public/stores/'+STORE_ID+'/pincodes/'+encodeURIComponent(code)),out=await response.json();if(!response.ok)throw Error(out.error||'Please enter a valid pincode');if(city)city.value=out.city;if(state)state.value=out.state;if(country)country.value=out.country;pincodeReady=true;validatedPincode=code;pincodeStatus.textContent='✓ Delivery available in '+out.city+', '+out.state;pincodeStatus.dataset.state='success';await save('draft');return true;}catch(error){pincodeReady=false;validatedPincode='';if(city)city.value='';if(state)state.value='';if(country)country.value='';pincodeStatus.textContent=error.message==='Delivery is not available at this pincode'?'Sorry, delivery is currently unavailable at this pincode.':'Please enter a valid six-digit pincode.';throw error;}finally{submitButton.disabled=!pincodeReady||${product.stock < 1 || !cod.buttonEnabled};}}pincode?.addEventListener('input',()=>{pincodeReady=false;validatedPincode='';submitButton.disabled=true;if(city)city.value='';if(state)state.value='';if(country)country.value='';clearTimeout(pincode._lookupTimer);if(pincode.value.trim().length===6)pincode._lookupTimer=setTimeout(()=>lookupPincode().catch(()=>{}),250)});applyCoupon?.addEventListener('click',async()=>{applyCoupon.disabled=true;try{await save('draft')}catch(error){status.textContent=error.message}finally{applyCoupon.disabled=false}});if(SAVE_INCOMPLETE)form.addEventListener('input',event=>{if(event.target===pincode||event.target.name==='couponCode')return;clearTimeout(timer);timer=setTimeout(()=>save().catch(error=>status.textContent=error.message),600)});form.addEventListener('change',event=>{if(['upsellId','downsellId'].includes(event.target.name))save().catch(error=>status.textContent=error.message)});form.addEventListener('submit',async event=>{event.preventDefault();try{if(!form.reportValidity())return;await lookupPincode(true);await save('submit');const response=await fetch('/api/public/checkouts/'+encodeURIComponent(SESSION_ID)+'/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({storeId:STORE_ID,visitorSessionId:window.commera2VisitorSessionId||null,analyticsConsentGranted:window.commera2AnalyticsConsent?.()??false,consentGranted:window.commera2TrackingConsent?window.commera2TrackingConsent():true})}),out=await response.json();if(!response.ok)throw Error(out.error||'Could not place order');location.assign(out.thankYouUrl)}catch(error){status.textContent=error.message}});if(window.trackCommerceEvent){trackCommerceEvent('page_view',{pageId:${Number(page.id)}});trackCommerceEvent('checkout_started',{eventId:'CHECKOUT-'+SESSION_ID,productId:${Number(product.id)},pageId:${Number(page.id)},quantity:${selectedQuantity},bundleId:${bundle?.id || "null"},checkoutSessionId:SESSION_ID,checkoutValue:${Number(checkout.totalPaise) / 100},currency:CURRENCY})}if(pincode&&/^[1-9][0-9]{5}$/.test(pincode.value))lookupPincode().catch(()=>{});else submitButton.disabled=true;</script>
  <script>(()=>{const hardDisabled=${product.stock < 1 || !cod.buttonEnabled},summary=document.querySelector('.checkout-summary'),summaryToggle=document.querySelector('#checkout-summary-toggle'),summaryTotal=document.querySelector('#checkout-total-compact'),couponStatus=document.querySelector('#coupon-status'),mobileSummary=matchMedia('(max-width: 1023px)'),fieldNames={name:'full name',phone:'mobile number',alternatePhone:'alternate phone number',email:'email address',address:'address line 1',addressLine2:'address line 2',landmark:'landmark',pincode:'six-digit pincode',city:'city',state:'state',country:'country',termsAccepted:'the terms and conditions'};let couponPending=false,checkoutSubmitting=false;
  function errorTarget(control){return control?.name?document.getElementById('error-'+control.name):null}
  function fieldMessage(control){const label=fieldNames[control.name]||'this field';if(control.validity.valueMissing)return control.type==='checkbox'?'Please accept the terms and conditions to continue.':'Please enter your '+label+'.';if(control.validity.typeMismatch)return 'Please enter a valid '+label+'.';if(control.validity.patternMismatch){if(control.name==='phone'||control.name==='alternatePhone')return 'Enter a valid 10-digit Indian mobile number.';if(control.name==='pincode')return 'Enter a valid six-digit pincode.';return 'Please check your '+label+'.'}if(control.validity.tooShort)return 'Please enter a complete '+label+'.';return control.validationMessage||'Please check this field.'}
  function validateControl(control){if(!control||control.disabled||control.readOnly||['hidden','radio','button','submit'].includes(control.type))return true;if(control.name==='alternatePhone'){const primary=form.elements.phone?.value.trim(),alternate=control.value.trim();control.setCustomValidity(alternate&&alternate===primary?'Use a different number for the alternate phone.':'')}const target=errorTarget(control),valid=control.checkValidity();control.classList.toggle('is-invalid',!valid);control.setAttribute('aria-invalid',String(!valid));if(target)target.textContent=valid?'':fieldMessage(control);return valid}
  function routeError(message){const routes=[[/alternate/i,'alternatePhone'],[/email/i,'email'],[/pincode|postal/i,'pincode'],[/address/i,'address'],[/terms|condition/i,'termsAccepted'],[/phone|mobile|otp/i,'phone'],[/name/i,'name']],match=routes.find(([pattern])=>pattern.test(message)),control=match?form.elements[match[1]]:null;if(control){control.setCustomValidity(message);validateControl(control);control.focus({preventScroll:true});control.closest('[data-field]')?.scrollIntoView({behavior:'smooth',block:'center'})}}
  function handleStatus(){const message=status.textContent.trim();if(!message){status.hidden=true;return}if(message==='Details saved'){status.textContent='';status.hidden=true;return}if(message.startsWith('Coupon ')){if(couponStatus){couponStatus.textContent=message;couponStatus.dataset.state='success'}couponPending=false;status.textContent='';status.hidden=true;return}if(couponPending&&couponStatus){couponStatus.textContent=message;couponStatus.dataset.state='error';couponPending=false;status.textContent='';status.hidden=true}else{status.hidden=false;status.dataset.state='error';routeError(message)}checkoutSubmitting=false;if(!hardDisabled)submitButton.disabled=false}
  function syncSummary(){if(!summary||!summaryToggle)return;if(!mobileSummary.matches){summary.classList.remove('is-collapsed');summaryToggle.setAttribute('aria-expanded','true')}else if(!summary.dataset.mobileReady){summary.classList.add('is-collapsed');summaryToggle.setAttribute('aria-expanded','false');summary.dataset.mobileReady='true'}}
  summaryToggle?.addEventListener('click',()=>{const collapsed=summary.classList.toggle('is-collapsed');summaryToggle.setAttribute('aria-expanded',String(!collapsed))});mobileSummary.addEventListener?.('change',syncSummary);syncSummary();
  form.addEventListener('invalid',event=>{event.preventDefault();validateControl(event.target)},true);form.addEventListener('input',event=>{const control=event.target;if(control.name==='phone')validateControl(form.elements.alternatePhone);validateControl(control);if(control===pincode){if(pincodeStatus){pincodeStatus.textContent='';delete pincodeStatus.dataset.state}if(!hardDisabled)submitButton.disabled=false}},true);
  form.addEventListener('submit',event=>{const controls=[...form.elements].filter(control=>control.name&&control.name!=='website'),valid=controls.map(validateControl).every(Boolean);if(!valid){event.preventDefault();event.stopImmediatePropagation();form.querySelector('.is-invalid')?.focus();return}checkoutSubmitting=true;status.textContent='';status.hidden=true;submitButton.disabled=true},true);
  applyCoupon?.addEventListener('click',()=>{couponPending=true;if(couponStatus){couponStatus.textContent='Applying coupon…';delete couponStatus.dataset.state}},true);new MutationObserver(handleStatus).observe(status,{childList:true,characterData:true,subtree:true});if(price&&summaryTotal)new MutationObserver(()=>{summaryTotal.textContent=price.textContent}).observe(price,{childList:true,characterData:true,subtree:true});new MutationObserver(()=>{if(!hardDisabled&&!checkoutSubmitting&&submitButton.disabled)submitButton.disabled=false}).observe(submitButton,{attributes:true,attributeFilter:['disabled']});if(!hardDisabled)submitButton.disabled=false;handleStatus()})();</script>
  <script>(()=>{const initial=${scriptJson({ exitOfferId: checkout.exitOfferId, exitOfferDiscountPaise: checkout.exitOfferDiscountPaise, discountPaise: checkout.discountPaise, totalPaise: checkout.totalPaise, shippingPaise: checkout.shippingPaise })};let exitApplied=Boolean(initial.exitOfferId);function syncExitOffer(out,message='Exit offer applied ✓'){if(!out)return;exitApplied=Boolean(out.exitOfferId);if(!exitApplied)return;const summary=document.querySelector('#checkout-summary-body'),dl=summary?.querySelector('dl');let note=document.querySelector('#exit-offer-applied-note');if(!note&&summary){note=document.createElement('p');note.id='exit-offer-applied-note';note.className='exit-offer-applied-note';summary.insertBefore(note,dl)}if(note){note.hidden=false;note.textContent=message}const total=document.querySelector('#checkout-price'),compact=document.querySelector('#checkout-total-compact'),discount=document.querySelector('#summary-discount'),shipping=document.querySelector('#summary-shipping'),format=value=>new Intl.NumberFormat(undefined,{style:'currency',currency:${scriptJson(currency)},maximumFractionDigits:2}).format(Number(value||0)/100);if(total)total.textContent=format(out.totalPaise);if(compact)compact.textContent=format(out.totalPaise);if(discount)discount.textContent=out.discountPaise?'−'+format(out.discountPaise):'—';if(shipping)shipping.textContent=out.shippingPaise?format(out.shippingPaise):'Calculated by location'}syncExitOffer(initial);addEventListener('commera2:exit-offer-claimed',event=>syncExitOffer(event.detail?.checkout,event.detail?.message||'Exit offer applied ✓'));const status=document.querySelector('#status');if(status)new MutationObserver(()=>{if(exitApplied&&/^Coupon null\b/.test(status.textContent.trim()))status.textContent=''}).observe(status,{childList:true,characterData:true,subtree:true})})();</script>
  ${exitOfferExperience({ offer: checkout.exitOfferId ? null : exitOffer, storeId: page.storeId, storeSlug: page.storeSlug, pageId: page.id, pageSlug: page.slug, productId: product.id, currency, context: "checkout", checkoutSessionId: checkout.id })}
  </body></html>`;
}

function executablePublicPage(input) {
  let content = {};
  try {
    content = JSON.parse(input.page?.contentJson || "{}");
  } catch {}
  const editorSections = Array.isArray(content.editorSections)
    ? content.editorSections
    : [];
  const visible = (id) => {
    const matching = editorSections.filter(
      (section) => section.id === id || section.type === id,
    );
    return (
      !matching.length || matching.some((section) => section.visible !== false)
    );
  };
  const reviewSettings = {
    showReviews: true,
    showRating: true,
    showImages: true,
    limit: 6,
    ...(content.reviewSettings || {}),
  };
  const preparedReviews = {
    ...(input.reviewsData || {}),
    reviews: (input.reviewsData?.reviews || [])
      .slice(0, Math.max(1, Math.min(50, Number(reviewSettings.limit) || 6)))
      .map((review) =>
        reviewSettings.showImages ? review : { ...review, images: [] },
      ),
  };
  const preparedContent = {
    ...content,
    sections: (content.sections || []).filter(
      (section) => section.visible !== false,
    ),
  };
  let html = publicPage({
    ...input,
    page: { ...input.page, contentJson: JSON.stringify(preparedContent) },
    reviewsData: preparedReviews,
  });
  html = html.replace(
    "Pay when your order reaches you.",
    "Pay when your order reaches you. Other payment options can be added in a future update.",
  );
  if (!visible("reviews") || reviewSettings.showReviews === false)
    html = html.replace(
      /<section class="product-reviews"[\s\S]*?<\/section>/,
      "",
    );
  else if (reviewSettings.showRating === false)
    html = html.replace(/<div class="reviews-summary">[\s\S]*?<\/div>/, "");
  if (!visible("social-proof") || content.socialProofEnabled === false)
    html = html.replace(
      /<section class="landing-section section-proof">[\s\S]*?<\/section>/g,
      "",
    );
  if (!visible("urgency"))
    html = html.replace(/<div class="urgency"[^>]*>[\s\S]*?<\/div>/, "");
  if (!visible("announcement-bar"))
    html = html.replace(/<div class="announcement">[\s\S]*?<\/div>/, "");
  if (!visible("product-media"))
    html = html.replace(
      /<div class="product-gallery">[\s\S]*?<\/div><div class="product-purchase">/,
      '<div class="product-purchase">',
    );
  if (!visible("product-information"))
    html = html.replace(
      /<div class="product-purchase">[\s\S]*?<\/div><\/section>/,
      "</section>",
    );
  if (!visible("description"))
    html = html.replace(
      /<p class="product-short-description">[\s\S]*?<\/p>/,
      "",
    );
  if (!visible("bundle"))
    html = html.replace(
      /<fieldset class="hero-bundles">[\s\S]*?<\/fieldset>/,
      "",
    );
  if (!visible("checkout-button"))
    html = html
      .replace(/<a href="[^"]*" class="hero-cta">[\s\S]*?<\/a>/g, "")
      .replace(/<div class="sticky-mobile-buy">[\s\S]*?<\/div>/, "");
  if (!visible("header"))
    html = html.replace(/<header class="store-header">[\s\S]*?<\/header>/, "");
  if (!visible("policies-footer"))
    html = html.replace(
      /<footer class="store-policy-footer">[\s\S]*?<\/footer>/,
      "",
    );
  return html
    .replace(
      "})});function validateCustomerFields",
      "})}});function validateCustomerFields",
    )
    .replace(
      /<input name="city"([^>]*)>/,
      '<input name="city"$1 readonly aria-readonly="true">',
    )
    .replace(
      /<select name="state"([^>]*)>[\s\S]*?<\/select>/,
      '<input name="state" type="text"$1 readonly aria-readonly="true">',
    )
    .replace(
      "if(country)country.value='';if(state)state.value='';const message=",
      "if(city)city.value='';if(state)state.value='';if(country)country.value='';const message=",
    )
    .replace(
      "catch(error){pincodeReady=false;validatedPincode='';if(pincodeStatus)",
      "catch(error){pincodeReady=false;validatedPincode='';if(city)city.value='';if(state)state.value='';if(country)country.value='';if(pincodeStatus)",
    )
    .replace(
      "if(pincode)pincode.addEventListener('input',()=>{pincodeReady=false;validatedPincode='';clearTimeout",
      "if(pincode)pincode.addEventListener('input',()=>{pincodeReady=false;validatedPincode='';if(city)city.value='';if(state)state.value='';if(country)country.value='';clearTimeout",
    );
}

function storefrontHomePage({ storefront: model, writtenPolicies = [], preferences = {} }) {
  const store = model?.store || {};
  const home = model?.home || {};
  const homeStatus = home?.status || "";
  const heading = String(home.heading || "Welcome");
  const subheading = String(home.subheading || "");
  const sectionHeading = htmlEscape(
    String(home.sectionHeading || "Featured Products"),
  );

  const { announcement, header, footer: policyFooter, favicon, style } = renderStoreChrome(model, writtenPolicies);

  const bannerImage = home.banner?.dataUrl
    ? `<img class="store-home-banner" src="${home.banner.dataUrl}" alt="${htmlEscape(heading)}">`
    : "";

  const featured = (home.featuredProducts || [])
    .filter((item) => item && item.active !== 0 && item.productPageStatus === "published")
    .map((item) => {
      const itemSlug = encodeURIComponent(item.slug || String(item.id || ""));
      const itemHref = `/s/${encodeURIComponent(store.slug || "")}/products/${itemSlug}`;
      const itemName = htmlEscape(item.name || "Product");
      const itemImage = item.mainImage?.dataUrl
        ? `<img src="${item.mainImage.dataUrl}" alt="${itemName}">`
        : "";
      const rating = Number(item.ratingAverage || 0),
        ratingCount = Number(item.ratingCount || 0);
      return `
        <article class="featured-product-card">
          <a href="${itemHref}">
            ${itemImage}
            <div>
              <h3>${itemName}</h3>
              ${ratingCount ? `<small aria-label="${rating.toFixed(1)} out of 5 stars">★ ${rating.toFixed(1)} · ${ratingCount} review${ratingCount === 1 ? "" : "s"}</small>` : ""}
              <p>${money(item.pricePaise || 0, store.currency || "INR")}</p>
              <span>View product</span>
            </div>
          </a>
        </article>`;
    })
    .filter(Boolean)
    .join("");

  const buttonText = String(home.buttonText || "").trim();
  const buttonHref = home.buttonTargetUrl || "#products";
  const buttonHtml = buttonText
    ? `<a class="hero-cta" href="${htmlEscape(buttonHref)}">${htmlEscape(buttonText)}</a>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(preferences.title || store.name || "")}</title><meta name="description" content="${htmlEscape(preferences.description || "")}">${favicon}<link rel="stylesheet" href="/store.css"></head><body class="storefront-site store-site-shell" style="${style}">${announcement}${header}<main class="storefront-home" data-status="${homeStatus}"><section class="storefront-home-content"><div class="store-home-hero">${bannerImage}<div class="store-home-hero-copy"><span class="eyebrow">${htmlEscape(store.name || "")}</span>${heading ? `<h1>${htmlEscape(heading)}</h1>` : ""}${subheading ? `<p>${htmlEscape(subheading)}</p>` : ""}${buttonHtml}</div></div><div class="store-home-products" id="products"><h2>${sectionHeading}</h2><div class="featured-grid">${featured || "<p>No featured products are published yet.</p>"}</div></div></section></main>${policyFooter}</body></html>`;
}

function thankYouPage(
  details,
  pixels = [],
  settings = defaultSettings,
  writtenPolicies = [],
  storefront = null,
  preview = false,
) {
  const branding = storefront?.branding || null;
  const site = renderStoreChrome(storefront, writtenPolicies);
  let content = {};
  try {
    content = JSON.parse(details.contentJson || "{}");
  } catch {}
  const config = content.thankYou || {};
  const result = orderConfirmation(details);
  const animation = confirmationAnimation(config.animation);
  const headline = htmlEscape(
    String(result.success ? config.headline || result.heading : result.heading),
  );
  const message = htmlEscape(
    String(
      result.success ? config.body || "" : "",
    ),
  );
  const button = htmlEscape(String(config.ctaText || "Continue shopping"));
  const items = details.items
    .map(
      (item) =>
        `<li><span>${item.quantity} × ${htmlEscape(item.name)}</span><strong>${money(item.lineTotalPaise, details.storeCurrency || "INR")}</strong></li>`,
    )
    .join("");
  const deliveryAddress = [
      details.customerAddress,
      details.customerAddressLine2,
      details.customerLandmark,
      details.customerCity,
      details.customerState,
      details.customerPincode,
      details.customerCountry,
    ]
      .filter(Boolean)
      .map(htmlEscape)
      .join(", "),
    policyLinks = writtenPolicies.length
      ? `<nav class="checkout-policy-links" aria-label="Store policies">${writtenPolicies.map((policy) => `<a href="/s/${encodeURIComponent(details.storeSlug)}/policies/${encodeURIComponent(policy.type)}">${htmlEscape(policy.label)}</a>`).join("")}</nav>`
      : "",
    favicon = branding?.favicon?.dataUrl
      ? `<link rel="icon" href="${branding.favicon.dataUrl}">`
      : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(result.label)} · ${htmlEscape(details.storeName)}</title>${favicon}<link rel="stylesheet" href="/store.css"><link rel="stylesheet" href="/confirmation-animation.css"><script defer src="/confirmation-animation.js"></script></head><body class="store-site-shell thank-you-site" style="${site.style}--page-accent:${htmlEscape(branding?.primaryColor || "#0f5132")};--page-font:${htmlEscape(branding?.bodyFont || "Inter")}">${preview ? '<div class="confirmation-preview-note">Animation preview · Sample order only · No payment or tracking</div>' : site.announcement + site.header}
  <main class="landing thank-you-page" data-confirmation="${result.success ? "success" : "other"}" data-animation-enabled="${animation.enabled}" data-animation-style="${animation.style}" data-order-key="${htmlEscape(`${details.storeId}:${details.id}`)}" data-confirmation-preview="${preview}">
    <section class="checkout-wrap"><div class="checkout-copy">${result.success ? confirmationIcon : ""}<span class="eyebrow">${htmlEscape(result.label)}</span><h1 class="confirmation-heading">${headline}</h1><p class="confirmation-status">${htmlEscape(result.message)}</p>${message ? `<p>${message}</p>` : ""}${preview ? `<button class="hero-cta" type="button" disabled>${button}</button>` : `<a class="hero-cta" href="/s/${encodeURIComponent(details.storeSlug)}">${button}</a>`}</div>
    <div class="buy-card confirmation-summary"><span class="eyebrow">${htmlEscape(details.orderNumber)}</span><h2>Order summary</h2><ul class="order-items">${items}</ul><div class="price">${money(details.totalPaise, details.storeCurrency || "INR")}</div><p><strong>Payment:</strong> ${htmlEscape(result.payment)}</p><p><strong>Customer:</strong> ${htmlEscape(details.customerName)}</p>${details.customerPhone ? `<p><strong>Phone:</strong> ${htmlEscape(details.customerPhone)}</p>` : ""}${deliveryAddress ? `<p><strong>Deliver to:</strong> ${deliveryAddress}</p>` : ""}<p>${preview ? "Sample information. No order has been placed." : "Your order details are saved. Keep this order number for reference."}</p></div></section>${preview ? "" : policyLinks}</main>${preview ? "" : site.footer}${preview || !result.success ? "" : pixelScripts(pixels, details.storeId, details.pageSlug, { purchase: details, privacy: settings.privacy })}</body></html>`;
}

function upsellPage(details, { acceptUrl, rejectUrl, thankYouUrl, storefront = null, writtenPolicies = [] }) {
  const site = renderStoreChrome(storefront, writtenPolicies);
  const { interaction, upsell, product, media, modifiable } = details,
    currency = interaction.storeCurrency || "INR",
    quantity = Number(upsell.quantity || 1),
    regularTotal = Number(product.pricePaise) * quantity,
    offerTotal = Number(upsell.pricePaise) * quantity,
    savings = Math.max(0, regularTotal - offerTotal),
    finished = ["ACCEPTED", "REJECTED", "FAILED"].includes(interaction.status),
    stateTitle =
      interaction.status === "ACCEPTED"
        ? "Added to your order"
        : interaction.status === "REJECTED"
          ? "Your original order is confirmed"
          : !modifiable
            ? "Your order can no longer be changed"
            : "One last offer for your order",
    image = media?.dataUrl
      ? `<img src="${media.dataUrl}" alt="${htmlEscape(product.name)}">`
      : `<div class="upsell-product-placeholder" aria-hidden="true">${htmlEscape(product.name.charAt(0))}</div>`,
    actions =
      finished || !modifiable
        ? `<a class="hero-cta" href="${thankYouUrl}">View confirmed order</a>`
        : `<div class="upsell-actions"><button class="hero-cta" id="accept-upsell" type="button">${htmlEscape(upsell.acceptButtonText || "Yes, add this to my order")}</button><button class="upsell-reject" id="reject-upsell" type="button">${htmlEscape(upsell.rejectButtonText || "No thanks")}</button></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(stateTitle)} · ${htmlEscape(interaction.storeName)}</title><link rel="stylesheet" href="/store.css"></head><body class="upsell-page store-site-shell" style="${site.style}">${site.announcement}${site.header}<main class="upsell-shell"><header class="upsell-confirmation"><span aria-hidden="true">✓</span><div><strong>Order ${htmlEscape(interaction.orderNumber)} is confirmed</strong><small>Cash on Delivery · No details to enter again</small></div></header><section class="upsell-offer"><div class="upsell-media">${image}</div><div class="upsell-copy"><span class="eyebrow">POST-PURCHASE OFFER</span><h1>${htmlEscape(upsell.headline || stateTitle)}</h1>${upsell.subheadline ? `<p class="upsell-subheadline">${htmlEscape(upsell.subheadline)}</p>` : ""}<h2>${htmlEscape(product.name)}</h2>${upsell.description || product.description ? `<p>${htmlEscape(upsell.description || product.description)}</p>` : ""}<div class="upsell-price"><strong>${money(offerTotal, currency)}</strong>${regularTotal > offerTotal ? `<del>${money(regularTotal, currency)}</del><b>Save ${money(savings, currency)}</b>` : ""}</div><p class="upsell-quantity">Quantity ${quantity} · Added to this same order</p><p id="upsell-status" role="status"></p>${actions}</div></section></main>${site.footer}${finished || !modifiable ? "" : `<div class="upsell-sticky-cta"><button class="hero-cta" data-upsell-mobile-accept type="button">${htmlEscape(upsell.acceptButtonText || "Add to my order")}</button></div><script>const STATUS=document.querySelector('#upsell-status'),ACCEPT=${scriptJson(acceptUrl)},REJECT=${scriptJson(rejectUrl)},THANK_YOU=${scriptJson(thankYouUrl)};let BUSY=false;async function decide(url){if(BUSY)return;BUSY=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);STATUS.textContent='Updating your order…';try{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({storeSlug:${scriptJson(interaction.storeSlug)},checkoutSessionId:${scriptJson(interaction.checkoutSessionId)},token:${scriptJson(details.token)}})}),out=await response.json();if(!response.ok)throw Error(out.error||'Could not update your order');location.assign(out.nextUrl||THANK_YOU)}catch(error){STATUS.textContent=error.message;BUSY=false;document.querySelectorAll('button').forEach(button=>button.disabled=false)}}document.querySelector('#accept-upsell')?.addEventListener('click',()=>decide(ACCEPT));document.querySelector('[data-upsell-mobile-accept]')?.addEventListener('click',()=>decide(ACCEPT));document.querySelector('#reject-upsell')?.addEventListener('click',()=>decide(REJECT));</script>`}</body></html>`;
}

function policyPage(store, policy, privacy, preview = false, storefront = null, writtenPolicies = []) {
  const site = renderStoreChrome(storefront, writtenPolicies);
  const contact = policy.contact || {},
    contactHtml =
      policy.type === "contact"
        ? `<dl class="contact-policy"><dt>Business / Store Name</dt><dd>${htmlEscape(contact.storeName || "")}</dd><dt>Support Email</dt><dd><a href="mailto:${htmlEscape(contact.supportEmail || "")}">${htmlEscape(contact.supportEmail || "")}</a></dd>${contact.phone ? `<dt>Phone Number</dt><dd>${htmlEscape(contact.phone)}</dd>` : ""}${contact.address ? `<dt>Address</dt><dd>${htmlEscape(contact.address)}</dd>` : ""}${contact.supportHours ? `<dt>Support Hours</dt><dd>${htmlEscape(contact.supportHours)}</dd>` : ""}</dl>`
        : policy.content,
    privacyHtml =
      policy.type === "privacy"
        ? `<aside class="privacy-operations"><h2>Current Customer Privacy Controls</h2><p>${privacy.requireAnalyticsConsent ? "Analytics consent required" : "Analytics consent not required"}</p><p>${privacy.requireMarketingConsent ? "Marketing consent required" : "Marketing consent not required"}</p><p>${privacy.allowCustomerDataCollection ? "Customer data collection enabled" : "Customer data collection disabled"}</p><p>${privacy.allowAbandonedCheckoutData ? "Abandoned checkout data collection enabled" : "Abandoned checkout data collection disabled"}</p></aside>`
        : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${site.favicon}<title>${htmlEscape(policy.title)} · ${htmlEscape(store.name)}</title><link rel="stylesheet" href="/store.css"></head><body class="store-site-shell" style="${site.style}">${site.announcement}${site.header}<main class="policy-page"><header><span class="eyebrow">${preview ? "POLICY PREVIEW" : "STORE POLICY"}</span><h1>${htmlEscape(policy.title)}</h1><p>${htmlEscape(store.name)}</p></header><article class="policy-content">${contactHtml}${privacyHtml}</article>${preview ? '<p class="policy-preview-note">Draft preview — this policy is not public until published.</p>' : ""}</main>${site.footer}</body></html>`;
}

function onlineContentPage(model, page, policies, preview = false) {
  const site = renderStoreChrome(model, policies);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(page.title)} · ${htmlEscape(model.store.name)}</title>${preview ? '<meta name="robots" content="noindex,nofollow">' : ''}<link rel="stylesheet" href="/store.css"></head><body class="store-site-shell" style="${site.style}">${site.announcement}${site.header}<main class="policy-page" style="max-width:900px;margin:40px auto;padding:24px">${preview ? '<p>Draft preview — not visible to customers</p>' : ''}<h1>${htmlEscape(page.title)}</h1><article>${page.content}</article></main>${site.footer}</body></html>`;
}

export function createApp({
  db = createDatabase(),
  port = Number(process.env.PORT || 4173),
  projectOptions = {},
  deliveryAdapters = {},
  domainOptions = {},
  domainSyncIntervalMs = Number(process.env.DOMAIN_SYNC_INTERVAL_MS || 60_000),
  salesChannelAdapters = {},
  pincodeOptions = {},
  reviewImportOptions = {},
  otpProviders = configuredOtpProviders(),
  otpProviderConfiguration,
  otpCredentialSecret,
  otpFetch = globalThis.fetch,
  otpSecret,
  pixelAdapters = {},
  pixelCredentialSecret,
  pixelFetch = globalThis.fetch,
  pixelDnsLookup,
  ipReputationProvider,
  challengeProvider,
  merchantAuth = !db.__commera2TestDatabase,
  authOptions = {},
  googleAuthProvider,
  oauthStateSecret,
  accountEmailProvider = createAccountEmailProvider(),
} = {}) {
  const settingsService = new SettingsService(db);
  const shipping = new ShippingService(db);
  const pincodes = new PincodeService(db, pincodeOptions);
  const reviews = new ReviewService(db);
  const reviewImports = new ReviewImportService(db, reviewImportOptions);
  const policies = new PolicyService(db);
  const salesChannels = new SalesChannelService(db, {
    adapters: salesChannelAdapters,
  });
  const service = new CommerceService(db);
  const operations = new ProductOperationsService(db);
  const projects = new ProjectService(db, projectOptions);
  const storefront = new StorefrontService(db);
  const onlineStore = new OnlineStoreService(db);
  const delivery = new DeliveryService(db, { adapters: deliveryAdapters });
  const hostedByRender = process.env.RENDER === "true",
    domainSslMode = String(
      process.env.DOMAIN_SSL_PROVIDER ||
        (hostedByRender ? "https" : "manual"),
    ).toLowerCase(),
    domains = new DomainService(db, {
    cnameTarget: process.env.DOMAIN_CNAME_TARGET,
    apexTarget: process.env.DOMAIN_APEX_TARGET,
    platformDomain: process.env.DOMAIN_PLATFORM_HOST,
    provider: process.env.DOMAIN_PROVIDER,
    requireOwnershipTxt: !hostedByRender,
    ...(domainSslMode === "https"
      ? { sslProvider: createHttpsDomainProvider() }
      : {}),
    ...domainOptions,
  });
  const liveVisitors = new LiveVisitorService(db);
  const pixels = new PixelService(db, {
    adapters: pixelAdapters,
    credentialSecret: pixelCredentialSecret,
    fetchImpl: pixelFetch,
    dnsLookupImpl: pixelDnsLookup,
    liveVisitors,
  });
  const otpConfiguration =
    otpProviderConfiguration ||
    new OtpProviderConfigService(db, {
      credentialSecret: otpCredentialSecret,
      fetchImpl: otpFetch,
    });
  const otp = new OtpService(db, {
    providers: otpProviders,
    providerResolver: (storeId, provider) =>
      otpConfiguration.provider(storeId, provider),
    secret: otpSecret,
  });
  const auth = new AuthService(db, authOptions);
  const storePreviewTokens = createStorePreviewTokens({ secret: process.env.PREVIEW_TOKEN_SECRET || undefined });
  const googleAuth =
      googleAuthProvider === undefined
        ? createGoogleAuthProvider()
        : googleAuthProvider,
    googleStateSecret =
      String(
        oauthStateSecret ||
          process.env.AUTH_OAUTH_STATE_SECRET ||
          process.env.GOOGLE_CLIENT_SECRET ||
          "",
      ) || randomBytes(32).toString("hex"),
    signGoogleState = (details) => {
      const payload = Buffer.from(JSON.stringify(details)).toString("base64url"),
        signature = createHmac("sha256", googleStateSecret)
          .update(payload)
          .digest("base64url");
      return `${payload}.${signature}`;
    },
    readGoogleState = (token) => {
      const [payload, provided] = String(token || "").split("."),
        expected = createHmac("sha256", googleStateSecret)
          .update(payload || "")
          .digest("base64url");
      if (
        !provided ||
        provided.length !== expected.length ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
      )
        throw Error("Google sign-in session is invalid or expired");
      let details;
      try {
        details = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        throw Error("Google sign-in session is invalid or expired");
      }
      if (!details.expiresAt || Number(details.expiresAt) <= Date.now())
        throw Error("Google sign-in session is invalid or expired");
      return details;
    };
  const botProtection = new BotProtectionService(db, {
    ipReputationProvider,
    challengeProvider,
  });
  const loginLimiter = createRateLimiter({ limit: 6, windowMs: 15 * 60_000 }),
    registrationLimiter = createRateLimiter({
      limit: 5,
      windowMs: 60 * 60_000,
    }),
    domainCheckLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 }),
    recoveryLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60_000 }),
    securityLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60_000 });
  let actualPort = port,
    domainSyncTimer = null;
  const server = createServer(async (req, res) => {
    secureResponse(req, res);
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    try {
      const resolvedDomain = domains.resolveHost(req.headers.host || "");
      if (path === '/_preview/store') {
        res.setHeader('cache-control', 'private, no-store');
        res.setHeader('referrer-policy', 'no-referrer');
        res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
        if (req.method !== 'GET' || !resolvedDomain ||
            !storePreviewTokens.verify(url.searchParams.get('token'), resolvedDomain.storeId, resolvedDomain.hostname)) {
          res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
          return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview unavailable</title></head><body><h1>This preview link has expired or is invalid</h1><p>Open Preview saved draft again from your merchant workspace.</p></body></html>');
        }
        const html = storefrontHomePage({
          storefront: storefront.get(resolvedDomain.storeId),
          preferences: onlineStore.preferences(resolvedDomain.storeId),
          writtenPolicies: policies.listPublished(resolvedDomain.storeId),
        });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(customDomainHtml(html, resolvedDomain.storeSlug));
      }
      if (
        !resolvedDomain &&
        domains.isDisconnectedHost(req.headers.host || "") &&
        ["GET", "HEAD"].includes(req.method) &&
        !path.startsWith("/api/")
      )
        return json(res, 404, { error: "Domain not connected" });
      if (
        resolvedDomain &&
        !resolvedDomain.primary &&
        resolvedDomain.primaryHostname !== resolvedDomain.hostname &&
        ["GET", "HEAD"].includes(req.method) &&
        !path.startsWith("/api/")
      ) {
        res.writeHead(308, {
          location: `https://${resolvedDomain.primaryHostname}${path}${url.search}`,
          "cache-control": "public, max-age=300",
        });
        return res.end();
      }
      const sessionToken = cookies(req).commera2_session || "";
      if (path === "/healthz" && req.method === "GET")
        return json(res, 200, {
          status: "ok",
          database: {
            mode: db.__commera2DatabaseMode || "unknown",
            persistent: Boolean(db.__commera2Persistent),
          },
        });
      if (path === "/readyz" && req.method === "GET") {
        db.prepare("SELECT 1 ok").get();
        return json(res, 200, {
          status: "ready",
          database: {
            mode: db.__commera2DatabaseMode || "unknown",
            persistent: Boolean(db.__commera2Persistent),
          },
        });
      }
      if (path === "/api/auth/register" && req.method === "POST") {
        if (!merchantAuth)
          return json(res, 404, { error: "Authentication is not enabled" });
        const rateKey = String(req.socket.remoteAddress || "unknown"),
          rate = registrationLimiter.take(rateKey);
        if (!rate.allowed) {
          res.setHeader("retry-after", String(rate.retryAfter));
          return json(res, 429, {
            error: "Too many account attempts. Try again later",
          });
        }
        const user = auth.register(await body(req)),
          session = auth.createSession(user.id);
        res.setHeader(
          "set-cookie",
          merchantSessionCookie(session.token, session.expiresAt),
        );
        return json(res, 201, {
          authenticated: true,
          user,
          csrfToken: session.csrfToken,
        });
      }
      if (path === "/api/auth/google/status" && req.method === "GET")
        return json(res, 200, { enabled: Boolean(merchantAuth && googleAuth) });
      if (path === "/api/auth/recovery/status" && req.method === "GET")
        return json(res, 200, { enabled: Boolean(merchantAuth && accountEmailProvider) });
      if (["/api/auth/forgot-password", "/api/auth/reset-password"].includes(path) && req.method === "POST") {
        if (!merchantAuth) return json(res, 404, { error: "Authentication is not enabled" });
        const input = await body(req),
          rate = recoveryLimiter.take(String(req.socket.remoteAddress || "unknown"));
        if (!rate.allowed) {
          res.setHeader("retry-after", String(rate.retryAfter));
          return json(res, 429, { error: "Too many recovery attempts. Try again later" });
        }
        if (path.endsWith("/reset-password")) return json(res, 200, auth.resetPassword(input));
        if (!accountEmailProvider) return json(res, 503, { error: "Password recovery email is not configured. Use Google sign-in if linked, or contact the platform administrator" });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email || "")) || String(input.email).length > 254)
          return json(res, 400, { error: "Enter a valid email address" });
        const reset = auth.requestPasswordReset(input.email);
        if (reset) {
          try { await accountEmailProvider.sendPasswordReset(reset); }
          catch {
            auth.cancelPasswordReset(reset.token);
            console.error("Account recovery email delivery failed");
          }
        }
        return json(res, 200, { message: "If an account matches that email, a reset link will be sent. Check your inbox and spam folder" });
      }
      if (path === "/api/auth/google" && req.method === "GET") {
        if (!merchantAuth || !googleAuth)
          return json(res, 503, { error: "Google sign-in is not configured" });
        const reauthSession = url.searchParams.get("reauth") === "1" ? auth.authenticate(sessionToken) : null;
        if (url.searchParams.get("reauth") === "1" && !reauthSession)
          return json(res, 401, { error: "Sign in to continue" });
        const state = randomBytes(32).toString("base64url"),
          nonce = randomBytes(32).toString("base64url"),
          returnTo = safeReturnPath(url.searchParams.get("returnTo")),
          started = await googleAuth.begin({ state, nonce });
        res.setHeader(
          "set-cookie",
          googleOAuthCookie(
            signGoogleState({
              state,
              nonce,
              codeVerifier: started.codeVerifier,
              returnTo,
              expectedUserId: reauthSession?.user.id || null,
              expiresAt: Date.now() + 10 * 60_000,
            }),
          ),
        );
        res.writeHead(302, {
          location: started.authorizationUrl,
          "cache-control": "no-store",
        });
        return res.end();
      }
      if (path === "/api/auth/google/callback" && req.method === "GET") {
        const clearGoogleCookie = googleOAuthCookie("", 0),
          fail = (message) => {
            res.setHeader("set-cookie", clearGoogleCookie);
            res.writeHead(302, {
              location: `/?authError=${encodeURIComponent(message)}`,
              "cache-control": "no-store",
            });
            return res.end();
          };
        if (!merchantAuth || !googleAuth)
          return fail("Google sign-in is not configured");
        if (url.searchParams.get("error"))
          return fail("Google sign-in was cancelled");
        try {
          const pending = readGoogleState(cookies(req).commera2_google_oauth),
            returnedState = String(url.searchParams.get("state") || ""),
            code = String(url.searchParams.get("code") || "");
          if (!returnedState || returnedState !== pending.state || !code)
            throw Error("Google sign-in session is invalid or expired");
          const profile = await googleAuth.complete({
              code,
              codeVerifier: pending.codeVerifier,
              nonce: pending.nonce,
            });
          if (pending.expectedUserId && auth.getUser(pending.expectedUserId).google_subject !== profile.subject)
            throw Error("Sign in using the Google account linked to this merchant");
          const user = auth.loginWithGoogle(profile),
            session = auth.createSession(user.id, "google");
          res.setHeader("set-cookie", [
            merchantSessionCookie(session.token, session.expiresAt),
            clearGoogleCookie,
          ]);
          res.writeHead(302, {
            location: safeReturnPath(pending.returnTo),
            "cache-control": "no-store",
          });
          return res.end();
        } catch (error) {
          if (!/invalid or expired/i.test(String(error?.message || "")))
            console.error("Google sign-in failed", {
              message: String(error?.message || "Unknown error"),
            });
          return fail("Google sign-in could not be completed. Please try again");
        }
      }
      if (path === "/api/auth/login" && req.method === "POST") {
        if (!merchantAuth)
          return json(res, 404, { error: "Authentication is not enabled" });
        const input = await body(req),
          rateKey = `${String(req.socket.remoteAddress || "unknown")}:${String(input.email || "").trim().toLowerCase()}`,
          rate = loginLimiter.take(rateKey);
        if (!rate.allowed) {
          res.setHeader("retry-after", String(rate.retryAfter));
          return json(res, 429, {
            error: "Too many sign-in attempts. Try again later",
          });
        }
        const user = auth.login(input),
          session = auth.createSession(user.id);
        loginLimiter.clear(rateKey);
        res.setHeader(
          "set-cookie",
          merchantSessionCookie(session.token, session.expiresAt),
        );
        return json(res, 200, {
          authenticated: true,
          user,
          csrfToken: session.csrfToken,
        });
      }
      if (path === "/api/auth/me" && req.method === "GET") {
        if (!merchantAuth)
          return json(res, 200, {
            authenticated: true,
            user: { id: "test", email: "test@local", displayName: "Test" },
            csrfToken: "",
          });
        const session = auth.authenticate(sessionToken);
        if (!session)
          return json(res, 401, { error: "Sign in to continue" });
        return json(res, 200, {
          authenticated: true,
          user: session.user,
          csrfToken: session.csrfToken,
        });
      }
      if (path === "/api/auth/logout" && req.method === "POST") {
        const session = merchantAuth ? auth.authenticate(sessionToken) : null;
        if (
          session &&
          req.headers["x-csrf-token"] !== session.csrfToken
        )
          return json(res, 403, { error: "Invalid security token" });
        if (merchantAuth) auth.logout(sessionToken);
        res.setHeader("set-cookie", expiredMerchantCookie());
        return json(res, 200, { loggedOut: true });
      }

      if (path === "/api/account" || path.startsWith("/api/account/")) {
        const session = merchantAuth ? auth.authenticate(sessionToken) : null;
        if (!session) return json(res, 401, { error: "Sign in to continue" });
        if (!["GET", "HEAD"].includes(req.method) && req.headers["x-csrf-token"] !== session.csrfToken)
          return json(res, 403, { error: "Invalid security token" });
        if (path === "/api/account" && req.method === "GET")
          return json(res, 200, { ...auth.security(session), recoveryEnabled: Boolean(accountEmailProvider) });
        if (path === "/api/account/profile" && req.method === "PATCH")
          return json(res, 200, { user: auth.updateProfile(session.user.id, await body(req)) });
        if (path === "/api/account/password" && req.method === "POST") {
          const rate = securityLimiter.take(session.user.id);
          if (!rate.allowed) return json(res, 429, { error: "Too many password attempts. Try again later" });
          const replacement = auth.changePassword(session, await body(req));
          res.setHeader("set-cookie", merchantSessionCookie(replacement.token, replacement.expiresAt));
          return json(res, 200, { changed: true, csrfToken: replacement.csrfToken });
        }
        if (path === "/api/account/sessions/others" && req.method === "DELETE") {
          auth.revokeOtherSessions(session);
          return json(res, 200, { revoked: true });
        }
        const sessionMatch = path.match(/^\/api\/account\/sessions\/([a-f0-9-]+)$/);
        if (sessionMatch && req.method === "DELETE") {
          auth.revokeSession(session.user.id, sessionMatch[1]);
          if (sessionMatch[1] === session.sessionId) res.setHeader("set-cookie", expiredMerchantCookie());
          return json(res, 200, { revoked: true });
        }
        return json(res, 404, { error: "Not found" });
      }

      let merchantSession = null;
      const merchantApi =
        path === "/api/stores" || /^\/api\/stores\//.test(path);
      if (merchantAuth && merchantApi) {
        merchantSession = auth.authenticate(sessionToken);
        if (!merchantSession)
          return json(res, 401, { error: "Sign in to continue" });
        const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
        if (
          write &&
          req.headers["x-csrf-token"] !== merchantSession.csrfToken
        )
          return json(res, 403, { error: "Invalid security token" });
        const storeMatch = path.match(/^\/api\/stores\/(\d+)(?:\/|$)/);
        if (storeMatch) {
          try {
            auth.requireStore(
              merchantSession.user.id,
              Number(storeMatch[1]),
              { write },
            );
          } catch (error) {
            return json(res, 403, { error: error.message });
          }
        }
      }
      if (req.method === "GET" && path === "/api/stores")
        return json(
          res,
          200,
          merchantAuth
            ? auth.listStores(merchantSession.user.id)
            : service.listStores(),
        );
      if (req.method === "POST" && path === "/api/stores") {
        const store = service.createStore(await body(req));
        if (merchantAuth)
          auth.addStore(merchantSession.user.id, store.id, "owner");
        return json(res, 201, store);
      }
      let match = path.match(/^\/api\/stores\/(\d+)\/dashboard$/);
      if (req.method === "GET" && match) {
        const id = Number(match[1]);
        return json(res, 200, {
          store: service.getStore(id),
          settings: settingsService.get(id),
          storefront: storefront.get(id),
          storefrontPublication: storefront.publicationStatus(id),
          shipping: {
            methods: shipping.listMethods(id),
            zones: shipping.listZones(id),
          },
          salesChannels: salesChannels.list(id).map((channel) => ({
            ...channel,
            availability: salesChannels.availability(id, channel.id),
          })),
          metrics: service.getStoreMetrics(id),
          products: service.listProducts(id),
          reviews: reviews.list(id),
          reviewImports: reviewImports.list(id),
          policies: {
            defaultRules: policies.getDefault(id),
            rules: policies.listRules(id),
            written: policies.listWritten(id),
            contact: policies.getWritten(id, 'contact'),
          },
          bundles: service.listBundles(id),
          exitOffers: service.listExitOffers(id),
          upsells: service.listUpsells(id),
          downsells: service.listDownsells(id),
          coupons: service.listCoupons(id),
          projects: projects.listProjects(id),
          pages: projects.listPages(id),
          orders: service.listOrders(id),
          ordersWorkspace: service.getOrdersWorkspace(
            id,
            merchantSession?.user?.id || "test",
            {
              abandonedCheckoutTimeoutMinutes:
                settingsService.get(id).checkout.abandonedCheckoutTimeoutMinutes,
            },
          ),
          customers: service.listCustomers(id),
          abandoned: service.listAbandonedCheckouts(id, {
            timeoutMinutes:
              settingsService.get(id).checkout.abandonedCheckoutTimeoutMinutes,
          }),
          delivery: {
            partners: delivery.listPartners(id),
            shipments: delivery.listShipments(id),
          },
          domains: domains.listDomains(id),
          domainOverview: domains.overview(id),
          pixels: {
            configurations: pixels.listPixels(id),
            events: pixels.listEvents(id),
            funnel: pixels.funnelMetrics(id),
            mappings: pixels.listMappings(id),
            deliveries: pixels.listDeliveries(id),
            platforms: pixels.platformCatalog(),
          },
          codProtection: {
            blocklist: service.listCodBlocklist(id),
            riskEvents: service.listCodRiskEvents(id),
            botAttempts: botProtection.list(id),
          },
          otpProvider: otpConfiguration.status(id),
          liveVisitors: liveVisitors.list(id, {
            timeoutMinutes:
              settingsService.get(id).privacy.visitorSessionTimeoutMinutes,
          }),
        });
      }
      match = path.match(/^\/api\/stores\/(\d+)\/online-store\/preferences$/);
      if (match && req.method === 'GET') return json(res,200,onlineStore.preferences(Number(match[1])));
      if (match && req.method === 'PATCH') return json(res,200,onlineStore.savePreferences(Number(match[1]),await body(req)));
      match = path.match(/^\/api\/stores\/(\d+)\/online-store\/pages$/);
      if (match && req.method === 'GET') return json(res,200,onlineStore.list(Number(match[1])));
      if (match && req.method === 'POST') return json(res,201,onlineStore.save(Number(match[1]),null,await body(req)));
      match = path.match(/^\/api\/stores\/(\d+)\/online-store\/pages\/([a-f0-9-]+)(?:\/(preview|publish|unpublish))?$/);
      if (match) {
        const id=Number(match[1]), pageId=match[2], action=match[3];
        if (!action && req.method==='GET') return json(res,200,onlineStore.get(id,pageId));
        if (!action && req.method==='PATCH') return json(res,200,onlineStore.save(id,pageId,await body(req)));
        if (action==='publish' && req.method==='POST') return json(res,200,onlineStore.publish(id,pageId));
        if (action==='unpublish' && req.method==='POST') return json(res,200,onlineStore.unpublish(id,pageId));
        if (action==='preview' && req.method==='GET') {
          const page=onlineStore.get(id,pageId);
          res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
          return res.end(onlineContentPage(storefront.get(id),page,policies.listPublished(id),true));
        }
      }
      match = path.match(/^\/s\/([^/]+)\/pages\/([^/]+)$/);
      if (match && req.method==='GET') {
        const store=policies.storeBySlug(decodeURIComponent(match[1]));
        const page=onlineStore.publicPage(store.id,decodeURIComponent(match[2]));
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
        return res.end(onlineContentPage(storefront.getPublic(store.id),page,policies.listPublished(store.id)));
      }
      match = path.match(/^\/api\/stores\/(\d+)\/storefront$/);
      if (match && req.method === "GET")
        return json(res, 200, storefront.get(Number(match[1])));
      match = path.match(/^\/api\/stores\/(\d+)\/storefront\/preview\/open$/);
      if (match && req.method === 'GET') {
        const store = service.getStore(Number(match[1])),
          domain = domains.activeDomainForStoreSlug(store.slug);
        const destination = domain?.openUrl
          ? `${domain.openUrl.replace(/\/+$/, '')}/_preview/store?token=${storePreviewTokens.issue(store.id, domain.domainName)}`
          : `/api/stores/${store.id}/storefront/preview`;
        res.writeHead(303, { location: destination, 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
        return res.end();
      }
      match = path.match(/^\/api\/stores\/(\d+)\/storefront\/preview$/);
      if (match && req.method === "GET") {
        const id = Number(match[1]);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        return res.end(
          storefrontHomePage({
            storefront: storefront.get(id),
            preferences: onlineStore.preferences(id),
            writtenPolicies: policies.listPublished(id),
          }),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/storefront\/branding$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          storefront.saveBranding(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/storefront\/home$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          storefront.saveHome(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/storefront\/home\/publish$/);
      if (match && req.method === "POST")
        return json(res, 200, storefront.publishHome(Number(match[1])));
      match = path.match(/^\/api\/stores\/(\d+)\/storefront\/products\/(\d+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          storefront.getProduct(Number(match[1]), Number(match[2])),
        );
      if (match && req.method === "PATCH") {
        const input = await body(req),
          storeId = Number(match[1]),
          productId = Number(match[2]);
        storefront.getProduct(storeId, productId);
        const page = projects.ensureStorefrontPage(
          storeId,
          productId,
          input.buttonText,
        );
        return json(
          res,
          200,
          storefront.saveProduct(storeId, productId, input, page.id),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/storefront\/products\/(\d+)\/page$/);
      if (match && req.method === "PATCH") {
        const input = await body(req);
        return json(res, 200, storefront.connectPage(Number(match[1]), Number(match[2]), input.pageId));
      }
      match = path.match(/^\/api\/stores\/(\d+)\/products\/(\d+)\/media$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          storefront.saveProductMedia(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/settings$/);
      if (match && req.method === "GET")
        return json(res, 200, settingsService.get(Number(match[1])));
      match = path.match(
        /^\/api\/stores\/(\d+)\/settings\/(cod-form|checkout|shipping|privacy)$/,
      );
      if (match && req.method === "PATCH") {
        const storeId = Number(match[1]),
          input = await body(req),
          module = {
            "cod-form": "codForm",
            checkout: "checkout",
            shipping: "shipping",
            privacy: "privacy",
          }[match[2]];
        if (
          module === "codForm" &&
          Object.prototype.hasOwnProperty.call(input, "otp") &&
          Object.prototype.hasOwnProperty.call(input.otp, "enabled") &&
          parseBoolean(input.otp.enabled) &&
          !otp.hasProvider(
            storeId,
            input.otp.provider || settingsService.get(storeId).codForm.otp.provider,
          )
        )
          throw new Error("Connect the selected OTP provider before enabling OTP verification");
        return json(
          res,
          200,
          settingsService.update(storeId, module, input),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/shipping-methods$/);
      if (match && req.method === "GET")
        return json(res, 200, shipping.listMethods(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          shipping.createMethod(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/shipping-methods\/(\d+)$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          shipping.updateMethod(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          shipping.deleteMethod(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/shipping-zones$/);
      if (match && req.method === "GET")
        return json(res, 200, shipping.listZones(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          shipping.createZone(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/shipping-zones\/(\d+)$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          shipping.updateZone(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          shipping.deleteZone(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/sales-channels$/);
      if (match && req.method === "GET")
        return json(res, 200, salesChannels.list(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          salesChannels.create(Number(match[1]), await body(req)),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/sales-channels\/(\d+)\/(connect|enable|disable|disconnect)$/,
      );
      if (match && req.method === "POST") {
        if (match[3] === "connect")
          return json(
            res,
            200,
            await salesChannels.connect(
              Number(match[1]),
              Number(match[2]),
              await body(req),
            ),
          );
        if (match[3] === "disconnect")
          return json(
            res,
            200,
            salesChannels.disconnect(Number(match[1]), Number(match[2])),
          );
        return json(
          res,
          200,
          salesChannels.toggle(
            Number(match[1]),
            Number(match[2]),
            match[3] === "enable",
          ),
        );
      }
      match = path.match(
        /^\/api\/stores\/(\d+)\/sales-channels\/(\d+)\/products$/,
      );
      if (match && req.method === "GET")
        return json(
          res,
          200,
          salesChannels.availability(Number(match[1]), Number(match[2])),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/sales-channels\/(\d+)\/products\/(\d+)$/,
      );
      if (match && req.method === "PUT") {
        const input = await body(req);
        return json(
          res,
          200,
          salesChannels.setAvailability(
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
            Boolean(input.available),
          ),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/cod-blocklist$/);
      if (match && req.method === "GET")
        return json(res, 200, service.listCodBlocklist(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.blockCodPhone(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/tags$/);
      if (match && req.method === "PATCH") {
        const input = await body(req);
        return json(
          res,
          200,
          service.bulkSetOrderTags(
            Number(match[1]),
            input.orderIds,
            input.tags,
          ),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/workspace$/);
      if (match && req.method === "GET")
        return json(res,200,service.getOrdersWorkspace(Number(match[1]),merchantSession?.user?.id||"test",{range:url.searchParams.get("range")||"today",start:url.searchParams.get("start")||"",end:url.searchParams.get("end")||"",search:url.searchParams.get("search")||"",paymentStatus:url.searchParams.get("paymentStatus")||"all",fulfillmentStatus:url.searchParams.get("fulfillmentStatus")||"all",deliveryStatus:url.searchParams.get("deliveryStatus")||"all"}));
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/preferences$/);
      if (match && req.method === "PATCH") return json(res,200,service.saveOrderPreferences(Number(match[1]),merchantSession?.user?.id||"test",await body(req)));
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/archive$/);
      if (match && req.method === "PATCH") { const input=await body(req);return json(res,200,service.archiveOrders(Number(match[1]),input.orderIds,input.archived!==false)); }
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/drafts$/);
      if (match && req.method === "GET") return json(res,200,service.listDraftOrders(Number(match[1])));
      if (match && req.method === "POST") return json(res,201,service.createDraftOrder(Number(match[1]),await body(req),merchantSession?.user?.id||"test"));
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/drafts\/(\d+)\/convert$/);
      if (match && req.method === "POST") return json(res,201,service.convertDraftOrder(Number(match[1]),Number(match[2]),merchantSession?.user?.id||"test"));
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/manual$/);
      if (match && req.method === "POST") { const input=await body(req),draft=service.createDraftOrder(Number(match[1]),input,merchantSession?.user?.id||"test"); return json(res,input.saveAsDraft?201:201,input.saveAsDraft?draft:service.convertDraftOrder(Number(match[1]),draft.id,merchantSession?.user?.id||"test")); }
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/export\.csv$/);
      if (match && req.method === "GET") { const ids=new Set(String(url.searchParams.get("ids")||"").split(",").map(Number).filter(Boolean)),orders=service.listOrders(Number(match[1]),{hideArchived:url.searchParams.get("hideArchived")!=="false",search:url.searchParams.get("search")||"",paymentStatus:url.searchParams.get("paymentStatus")||"all",fulfillmentStatus:url.searchParams.get("fulfillmentStatus")||"all",deliveryStatus:url.searchParams.get("deliveryStatus")||"all"}).filter((order)=>!ids.size||ids.has(order.id)), headings=["Order","Date","Customer","Phone","Email","Channel","Items","Total","Payment status","Fulfillment status","Delivery status","Delivery method","Tags"],lines=[headings,...orders.map((order)=>[order.orderNumber,order.createdAt,order.customerName,order.customerPhone,order.customerEmail,order.channel,order.itemCount,order.totalPaise,order.paymentStatus,order.fulfillmentStatus,order.deliveryStatus,order.deliveryMethod,order.tags.join(" | ")])].map((line)=>line.map(csvCell).join(","));res.writeHead(200,{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="orders-${Number(match[1])}.csv"`});return res.end(`\uFEFF${lines.join("\r\n")}`); }
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/(\d+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.getOrderDetails(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/customers\/(\d+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.getCustomerDetails(Number(match[1]), Number(match[2])),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/orders\/(\d+)\/payment-status$/,
      );
      if (match && req.method === "PATCH") {
        const input = await body(req);
        return json(
          res,
          200,
          service.setOrderPaymentStatus(
            Number(match[1]),
            Number(match[2]),
            input.status,
          ),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/(\d+)\/cancel$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          service.cancelOrder(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/(\d+)\/fulfillment-status$/);
      if(match&&req.method==="PATCH"){const input=await body(req);return json(res,200,service.setOrderFulfillmentStatus(Number(match[1]),Number(match[2]),input.status));}
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/(\d+)\/delivery-status$/);
      if(match&&req.method==="PATCH"){const input=await body(req);return json(res,200,service.setOrderDeliveryStatus(Number(match[1]),Number(match[2]),input.status));}
      match = path.match(/^\/api\/stores\/(\d+)\/delivery-partners$/);
      if (match && req.method === "GET")
        return json(res, 200, delivery.listPartners(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          delivery.createPartner(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/delivery-partners\/(\d+)$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          delivery.updatePartner(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/delivery-partners\/(\d+)\/test-connection$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          await delivery.testConnection(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/delivery-partners\/(\d+)\/(enable|disable|disconnect)$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          match[3] === "disconnect"
            ? delivery.disconnectPartner(Number(match[1]), Number(match[2]))
            : delivery.setPartnerEnabled(
                Number(match[1]),
                Number(match[2]),
                match[3] === "enable",
              ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/shipments$/);
      if (match && req.method === "GET")
        return json(res, 200, delivery.listShipments(Number(match[1])));
      match = path.match(/^\/api\/stores\/(\d+)\/orders\/(\d+)\/shipments$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          await delivery.dispatchOrder(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/shipments\/(\d+)\/status$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          delivery.updateShipmentStatus(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/domains$/);
      if (match && req.method === "GET")
        return json(res, 200, domains.listDomains(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          domains.addDomain(
            Number(match[1]),
            await body(req),
            merchantSession?.user?.email || "merchant",
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/overview$/);
      if (match && req.method === "GET")
        return json(res, 200, domains.overview(Number(match[1])));
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/(\d+)\/instructions$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          domains.getDomainInstructions(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/audit-log$/);
      if (match && req.method === "GET")
        return json(res, 200, domains.listAuditLog(Number(match[1])));
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/(\d+)\/check-dns$/);
      if (match && req.method === "POST") {
        const rate = domainCheckLimiter.take(
          `${merchantSession?.user?.id || req.socket.remoteAddress || "test"}:${match[1]}:${match[2]}`,
        );
        if (!rate.allowed) {
          res.setHeader("retry-after", String(rate.retryAfter));
          return json(res, 429, {
            error: "Too many domain checks. Please wait before checking again.",
          });
        }
        return json(
          res,
          200,
          await domains.checkDns(
            Number(match[1]),
            Number(match[2]),
            merchantSession?.user?.email || "merchant",
          ),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/(\d+)\/verify$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          await domains.verifyDomain(
            Number(match[1]),
            Number(match[2]),
            merchantSession?.user?.email || "merchant",
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/(\d+)\/sync$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          await domains.syncDomainStatus(
            Number(match[1]),
            Number(match[2]),
            merchantSession?.user?.email || "merchant",
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/(\d+)\/primary$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          domains.setPrimary(
            Number(match[1]),
            Number(match[2]),
            merchantSession?.user?.email || "merchant",
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/domains\/(\d+)$/);
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          domains.disconnect(
            Number(match[1]),
            Number(match[2]),
            merchantSession?.user?.email || "merchant",
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pixels$/);
      if (match && req.method === "GET")
        return json(res, 200, pixels.listPixels(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          pixels.addPixel(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pixels\/(\d+)$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          pixels.savePixel(Number(match[1]), Number(match[2]), await body(req)),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          pixels.deletePixel(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pixels\/(\d+)\/verify$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          await pixels.verifyPixel(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pixels\/(\d+)\/mappings$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          pixels.listMappings(Number(match[1]), Number(match[2])),
        );
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          pixels.saveMappings(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/pixels\/(\d+)\/(enable|disable)$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          pixels.enablePixel(
            Number(match[1]),
            Number(match[2]),
            match[3] === "enable",
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pixel-events$/);
      if (match && req.method === "GET")
        return json(res, 200, pixels.listLegacyEvents(Number(match[1])));
      match = path.match(/^\/api\/stores\/(\d+)\/tracking-events$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          pixels.listEvents(Number(match[1]), {
            eventName: url.searchParams.get("event") || "",
            source: url.searchParams.get("source") || "",
            status: url.searchParams.get("status") || "",
          }),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pixel-deliveries$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          pixels.listDeliveries(Number(match[1]), {
            connectionId: url.searchParams.get("connectionId") || "",
            status: url.searchParams.get("status") || "",
          }),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/pixel-deliveries\/(\d+)\/retry$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          await pixels.retryDelivery(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/public\/stores\/(\d+)\/pixel-events$/);
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          input = await body(req);
        verifyVisitorToken(input.visitorToken, storeId, input.pageSlug);
        const privacy = settingsService.get(storeId).privacy;
        if (privacy.requireMarketingConsent && input.consentGranted !== true)
          throw new Error("Marketing tracking consent is required");
        return json(
          res,
          201,
          await pixels.track(
            storeId,
            { ...input, source: "browser" },
            {
              strict: true,
              ipAddress: req.socket.remoteAddress || "",
              userAgent: req.headers["user-agent"] || "",
            },
          ),
        );
      }
      match = path.match(
        /^\/api\/public\/stores\/(\d+)\/exit-offers\/(\d+)\/(shown|reject)$/,
      );
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          offerId = Number(match[2]),
          action = match[3],
          input = await body(req),
          checkout = input.checkoutSessionId
            ? service.getCheckout(storeId, input.checkoutSessionId)
            : null,
          page = service.getPage(
            storeId,
            checkout?.pageId ?? Number(input.pageId),
          );
        verifyVisitorToken(input.visitorToken, storeId, input.pageSlug);
        if (page.slug !== String(input.pageSlug || "").trim())
          throw new Error("Exit offer page does not match this session");
        if (
          !checkout &&
          Number(page.productId) !== Number(input.productId)
        )
          throw new Error("Exit offer product does not match this page");
        return json(
          res,
          200,
          action === "shown"
            ? service.showExitOffer(storeId, offerId, input)
            : service.rejectExitOffer(storeId, offerId, input),
        );
      }
      match = path.match(
        /^\/api\/public\/checkouts\/([^/]+)\/exit-offers\/(\d+)\/claim$/,
      );
      if (match && req.method === "POST") {
        const input = await body(req),
          checkoutId = decodeURIComponent(match[1]),
          checkoutScope = db
            .prepare("SELECT store_id FROM checkout_sessions WHERE id=?")
            .get(checkoutId);
        if (!checkoutScope) throw new Error("Checkout not found");
        const storeId = Number(checkoutScope.store_id),
          checkout = service.getCheckout(storeId, checkoutId),
          page = service.getPage(storeId, checkout.pageId);
        verifyVisitorToken(input.visitorToken, storeId, input.pageSlug);
        if (page.slug !== String(input.pageSlug || "").trim())
          throw new Error("Exit offer page does not match this checkout");
        return json(
          res,
          200,
          service.claimExitOffer(
            storeId,
            checkout.id,
            Number(match[2]),
            input,
          ),
        );
      }
      match = path.match(/^\/api\/public\/stores\/(\d+)\/tracking-events$/);
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          input = await body(req);
        verifyVisitorToken(input.visitorToken, storeId, input.pageSlug);
        return json(
          res,
          201,
          await pixels.track(storeId, input, {
            strict: true,
            ipAddress: req.socket.remoteAddress || "",
            userAgent: req.headers["user-agent"] || "",
          }),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/live-visitors$/);
      if (match && req.method === "GET") {
        const id = Number(match[1]),
          timeoutMinutes =
            settingsService.get(id).privacy.visitorSessionTimeoutMinutes;
        return json(res, 200, liveVisitors.list(id, { timeoutMinutes }));
      }
      match = path.match(/^\/api\/stores\/(\d+)\/live-visitors\/stream$/);
      if (match && req.method === "GET") {
        const id = Number(match[1]),
          timeoutMinutes =
            settingsService.get(id).privacy.visitorSessionTimeoutMinutes,
          sendSnapshot = () => {
            if (res.writableEnded) return;
            res.write(
              `event: snapshot\ndata: ${JSON.stringify(
                liveVisitors.list(id, { timeoutMinutes }),
              )}\n\n`,
            );
          };
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.flushHeaders?.();
        sendSnapshot();
        const unsubscribe = liveVisitors.subscribe(id, sendSnapshot),
          timer = setInterval(sendSnapshot, 15_000),
          close = () => {
            clearInterval(timer);
            unsubscribe();
          };
        req.once("close", close);
        res.once("close", close);
        return;
      }
      match = path.match(/^\/api\/stores\/(\d+)\/live-visitors\/([^/]+)$/);
      if (match && req.method === "GET") {
        const id = Number(match[1]),
          timeoutMinutes =
            settingsService.get(id).privacy.visitorSessionTimeoutMinutes;
        return json(
          res,
          200,
          liveVisitors.detail(id, decodeURIComponent(match[2]), {
            timeoutMinutes,
          }),
        );
      }
      match = path.match(/^\/api\/public\/stores\/(\d+)\/visitor-events$/);
      if (match && req.method === "POST") {
        const id = Number(match[1]),
          privacy = settingsService.get(id).privacy,
          input = await body(req);
        verifyVisitorToken(input.visitorToken, id, input.pageSlug);
        return json(
          res,
          201,
          liveVisitors.record(id, input, {
            allowTracking: privacy.allowVisitorTracking && analyticsAllowed(privacy,input),
            ipAddress: req.socket.remoteAddress || "",
            userAgent: req.headers["user-agent"] || "",
          }),
        );
      }
      match = path.match(/^\/api\/public\/stores\/(\d+)\/live\/heartbeat$/);
      if (match && req.method === "POST") {
        const id = Number(match[1]),
          privacy = settingsService.get(id).privacy,
          input = await body(req);
        verifyVisitorToken(input.visitorToken, id, input.pageSlug);
        return json(
          res,
          200,
          liveVisitors.heartbeat(id, input, {
            allowTracking: privacy.allowVisitorTracking && analyticsAllowed(privacy,input),
          }),
        );
      }
      if (
        req.method === "POST" &&
        (path === "/otp/send" || path === "/api/public/otp/send")
      ) {
        const input = await body(req),
          storeId = Number(input.storeId ?? input.store_id),
          settings = settingsService.get(storeId).codForm.otp,
          result = await otp.send(storeId, input, settings),
          checkout = service.getCheckout(storeId, input.checkoutSessionId);
        await pixels.track(storeId, {
          eventName: "otp_started",
          source: "server",
          sessionId: String(input.visitorSessionId || "").trim(),
          checkoutSessionId: checkout.id,
          productId: checkout.productId,
          pageId: checkout.pageId,
          analyticsConsentGranted: input.analyticsConsentGranted,
          consentGranted: input.consentGranted === true,
        });
        return json(res, 201, result);
      }
      match = path.match(/^\/api\/public\/stores\/(\d+)\/otp-config$/);
      if (match && req.method === "GET") {
        const configured = settingsService.get(Number(match[1])).codForm.otp;
        return json(res, 200, {
          enabled: configured.enabled,
          requiredForCod: configured.requiredForCod,
          length: configured.length,
          verificationPosition: configured.verificationPosition,
          resendDelaySeconds: configured.resendDelaySeconds,
        });
      }
      if (
        req.method === "POST" &&
        (path === "/otp/verify" || path === "/api/public/otp/verify")
      ) {
        const input = await body(req),
          storeId = Number(input.storeId ?? input.store_id),
          settings = settingsService.get(storeId).codForm.otp,
          result = await otp.verify(storeId, input, settings),
          checkout = service.getCheckout(storeId, input.checkoutSessionId);
        await pixels.track(storeId, {
          eventName: "otp_verified",
          eventId: `OTP-VERIFIED-${checkout.id}`,
          source: "server",
          sessionId: String(input.visitorSessionId || "").trim(),
          checkoutSessionId: checkout.id,
          productId: checkout.productId,
          pageId: checkout.pageId,
          analyticsConsentGranted: input.analyticsConsentGranted,
          consentGranted: input.consentGranted === true,
        });
        return json(res, 200, result);
      }
      match = path.match(/^\/api\/stores\/(\d+)\/otp\/test$/);
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          input = await body(req),
          settings = settingsService.get(storeId).codForm.otp;
        return json(
          res,
          200,
          await otp.testProvider(storeId, input.phone, settings),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/otp\/provider$/);
      if (match && req.method === "GET")
        return json(res, 200, otpConfiguration.status(Number(match[1])));
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          store = service.getStore(storeId),
          connected = await otpConfiguration.connect(storeId, await body(req), {
            friendlyName: `${store.name} OTP`,
          });
        settingsService.update(storeId, "codForm", {
          otp: { provider: "twilio" },
        });
        return json(res, 200, connected);
      }
      match = path.match(/^\/api\/stores\/(\d+)\/products$/);
      if (match && req.method === "GET")
        return json(res, 200, service.listProducts(Number(match[1])));
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          product = service.createProduct(storeId, await body(req));
        operations.initializeProduct(storeId, product.id, product.stock);
        return json(res, 201, product);
      }
      match = path.match(/^\/api\/stores\/(\d+)\/products\/(\d+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.getProduct(Number(match[1]), Number(match[2])),
        );
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          service.updateProduct(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/bundles$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.listBundles(
            Number(match[1]),
            url.searchParams.get("productId"),
          ),
        );
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.createBundle(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/exit-offers$/);
      if (match && req.method === "GET")
        return json(res, 200, service.listExitOffers(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.createExitOffer(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/exit-offers\/(\d+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.getExitOffer(Number(match[1]), Number(match[2])),
        );
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          service.updateExitOffer(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          service.deleteExitOffer(Number(match[1]), Number(match[2])),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/exit-offers\/(\d+)\/duplicate$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.duplicateExitOffer(Number(match[1]), Number(match[2])),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/exit-offers\/(\d+)\/analytics$/,
      );
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.exitOfferAnalytics(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/upsells$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.listUpsells(
            Number(match[1]),
            url.searchParams.get("productId"),
          ),
        );
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.createUpsell(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/upsells\/(\d+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.getUpsell(Number(match[1]), Number(match[2])),
        );
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          service.updateUpsell(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          service.deleteUpsell(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/upsells\/(\d+)\/duplicate$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.duplicateUpsell(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/upsells\/(\d+)\/analytics$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.upsellAnalytics(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/downsells$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          service.listDownsells(
            Number(match[1]),
            url.searchParams.get("productId"),
          ),
        );
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.createDownsell(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/coupons$/);
      if (match && req.method === "GET")
        return json(res, 200, service.listCoupons(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          service.createCoupon(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/product-operations$/);
      if (match && req.method === "GET") {
        const id = Number(match[1]);
        return json(res, 200, {
          collections: operations.listCollections(id),
          inventory: operations.listInventory(id),
          movements: operations.listInventoryMovements(id),
          locations: operations.listLocations(id),
          purchaseOrders: operations.listPurchaseOrders(id),
          transfers: operations.listTransfers(id),
          giftCards: operations.listGiftCards(id),
        });
      }
      match = path.match(/^\/api\/stores\/(\d+)\/collections$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          operations.createCollection(Number(match[1]), await body(req)),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/collections\/(\d+)\/products\/(\d+)$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          operations.addProductToCollection(
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          operations.removeProductFromCollection(
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/locations$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          operations.createLocation(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/purchase-orders$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          operations.createPurchaseOrder(Number(match[1]), await body(req)),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/purchase-orders\/(\d+)\/receive$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          operations.receivePurchaseOrder(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/transfers$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          operations.createTransfer(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/transfers\/(\d+)\/receive$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          operations.receiveTransfer(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/gift-cards$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          operations.issueGiftCard(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/gift-cards\/(\d+)\/disable$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          operations.disableGiftCard(Number(match[1]), Number(match[2])),
        );
      if (req.method === "GET" && path === "/api/page-templates")
        return json(res, 200, projects.listTemplates());
      match = path.match(/^\/api\/stores\/(\d+)\/projects$/);
      if (match && req.method === "GET")
        return json(res, 200, projects.listProjects(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          projects.createProject(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/page-imports\/preview$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          projects.previewPageImport(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pages$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          projects.listPages(
            Number(match[1]),
            url.searchParams.get("productId"),
          ),
        );
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          input = await body(req),
          method = input.creationMethod || "blank";
        const requestedStatus = String(input.status || "draft")
          .trim()
          .toLowerCase();
        if (!["draft", "published"].includes(requestedStatus))
          throw Error("Status must be draft or published");
        if (!["default", "template", "upload", "blank", "ai"].includes(method))
          throw Error("Unsupported product page creation method");
        if (method === "upload") {
          if (input.fileContentBase64)
            projects.previewPageImport(storeId, input);
          else if (!String(input.html || "").trim())
            throw Error("Page File / Supported Import is required");
        }
        if (!input.projectId) {
          let project = projects
            .listProjects(storeId)
            .find((item) => item.productId === Number(input.productId));
          if (!project)
            project = projects.createProject(storeId, {
              name: `${input.title} Project`,
              slug: `${input.slug}-project`,
              productId: Number(input.productId),
            });
          input.projectId = project.id;
        }
        if (method === "template" || method === "default")
          return json(
            res,
            201,
            projects.createPageFromTemplate(storeId, input),
          );
        if (method === "upload")
          return json(res, 201, projects.importPrebuiltPage(storeId, input));
        if (method === "ai")
          return json(res, 201, await projects.createAIPage(storeId, input));
        return json(res, 201, projects.createBlankPage(storeId, input));
      }
      match = path.match(/^\/api\/stores\/(\d+)\/pages\/(\d+)\/thank-you\/preview$/);
      if (match && req.method === "POST") {
        const storeId = Number(match[1]);
        const page = projects.getPage(storeId, Number(match[2]));
        const store = service.getStore(storeId);
        const input = await body(req);
        // Only sample data goes into this renderer. No order or tracking service calls.
        const sample = {
          id: "preview", storeId, storeSlug: store.slug, storeName: store.name,
          storeCurrency: store.currency, pageSlug: page.slug,
          orderNumber: "SAMPLE-1001", paymentMethod: "cod", paymentStatus: "pending",
          totalPaise: 79900, customerName: "Sample Customer",
          customerAddress: "12 Example Road", customerCity: "Bengaluru",
          customerState: "Karnataka", customerPincode: "560001",
          items: [{ name: "Sample product", quantity: 1, lineTotalPaise: 79900 }],
          contentJson: JSON.stringify({ thankYou: input.thankYou || {} }),
        };
        return json(res, 200, { html: thankYouPage(sample, [], defaultSettings, [], storefront.get(storeId), true) });
      }
      match = path.match(/^\/api\/stores\/(\d+)\/pages\/(\d+)$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          projects.updatePageContent(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          projects.deletePage(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pages\/(\d+)\/duplicate$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          projects.duplicatePage(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pages\/(\d+)\/unpublish$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          projects.unpublishPage(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/pages\/(\d+)\/preview$/);
      if (match && req.method === "GET") {
        const storeId = Number(match[1]),
          page = projects.getPage(storeId, Number(match[2])),
          store = service.getStore(storeId),
          product = service.getProduct(storeId, page.productId);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(
          executablePublicPage({
            page: { ...page, storeSlug: store.slug },
            product,
            bundles: service
              .listBundles(storeId, product.id)
              .filter((item) => item.active),
            upsells: service
              .listUpsells(storeId, product.id)
              .filter((item) => item.active),
            downsells: service
              .listDownsells(storeId, product.id)
              .filter((item) => item.active),
            exitOffer: service.eligibleExitOffer(storeId, {
              productId: product.id,
              pageId: page.id,
              context: "product_page",
            }),
            pixels: [],
            settings: settingsService.get(storeId),
            reviewsData: reviews.publicProduct(storeId, product.id),
            writtenPolicies: policies.listPublished(storeId),
            storefrontProduct: storefront.getProduct(storeId, product.id),
            storefront: storefront.get(storeId),
            storeData: store,
          }),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/pages\/(\d+)\/publish$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          projects.publishPage(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/ai-page-status$/);
      if (match && req.method === "GET") {
        service.getStore(Number(match[1]));
        return json(res, 200, projects.aiStatus());
      }
      match = path.match(/^\/api\/stores\/(\d+)\/policies\/rules\/default$/);
      if (match && req.method === "GET")
        return json(res, 200, policies.getDefault(Number(match[1])));
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          policies.updateDefault(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/policies\/rules\/evaluate$/);
      if (match && req.method === "POST")
        return json(
          res,
          200,
          policies.evaluate(Number(match[1]), await body(req)),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/orders\/(\d+)\/policy-eligibility$/,
      );
      if (match && req.method === "GET")
        return json(
          res,
          200,
          policies.evaluateOrder(Number(match[1]), Number(match[2]), {
            reason: url.searchParams.get("reason") || "standard",
          }),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/policies\/rules$/);
      if (match && req.method === "GET")
        return json(res, 200, policies.listRules(Number(match[1])));
      if (match && req.method === "POST")
        return json(
          res,
          201,
          policies.createRule(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/policies\/rules\/(\d+)$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          policies.updateRule(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          policies.deleteRule(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/policies\/written$/);
      if (match && req.method === "GET")
        return json(res, 200, policies.listWritten(Number(match[1])));
      match = path.match(
        /^\/api\/stores\/(\d+)\/policies\/written\/([^/]+)\/preview$/,
      );
      if (match && req.method === "GET") {
        const store = service.getStore(Number(match[1])),
          policy = policies.getWritten(store.id, decodeURIComponent(match[2]));
        if (policy.status === "no_policy") throw Error("Policy is not set");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(
          policyPage(
            store,
            policy,
            settingsService.get(store.id).privacy,
            true,
            storefront.get(store.id),
            policies.listPublished(store.id),
          ),
        );
      }
      match = path.match(
        /^\/api\/stores\/(\d+)\/policies\/written\/([^/]+)\/publish$/,
      );
      if (match && req.method === "POST") {
        const storeId = Number(match[1]),
          type = decodeURIComponent(match[2]),
          policy = policies.publishWritten(storeId, type);
        if (type === "privacy") {
          const store = service.getStore(storeId);
          settingsService.update(storeId, "privacy", {
            privacyPolicyLink: `/s/${store.slug}/policies/privacy`,
          });
        }
        return json(res, 200, policy);
      }
      match = path.match(
        /^\/api\/stores\/(\d+)\/policies\/written\/([^/]+)\/unpublish$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          policies.unpublishWritten(
            Number(match[1]),
            decodeURIComponent(match[2]),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/policies\/written\/([^/]+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          policies.getWritten(Number(match[1]), decodeURIComponent(match[2])),
        );
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          policies.saveWritten(
            Number(match[1]),
            decodeURIComponent(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/review-imports\/template$/);
      if (match && req.method === "GET") {
        service.getStore(Number(match[1]));
        res.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="reviews-template.csv"',
        });
        return res.end(reviewImports.template());
      }
      match = path.match(/^\/api\/stores\/(\d+)\/review-imports$/);
      if (match && req.method === "GET")
        return json(res, 200, reviewImports.list(Number(match[1])));
      match = path.match(/^\/api\/stores\/(\d+)\/review-imports\/validate$/);
      if (match && req.method === "POST")
        return json(
          res,
          201,
          await reviewImports.validate(Number(match[1]), await body(req)),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/review-imports\/(\d+)\/import$/,
      );
      if (match && req.method === "POST")
        return json(
          res,
          200,
          reviewImports.import(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(
        /^\/api\/stores\/(\d+)\/review-imports\/(\d+)\/errors\.csv$/,
      );
      if (match && req.method === "GET") {
        const report = reviewImports.errorReport(
          Number(match[1]),
          Number(match[2]),
        );
        res.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            'attachment; filename="review-import-errors.csv"',
        });
        return res.end(report);
      }
      match = path.match(/^\/api\/stores\/(\d+)\/review-imports\/(\d+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          reviewImports.get(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/reviews$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          reviews.list(Number(match[1]), {
            source: url.searchParams.get("source"),
            status: url.searchParams.get("status"),
          }),
        );
      if (match && req.method === "POST")
        return json(
          res,
          201,
          reviews.createManual(Number(match[1]), await body(req)),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/reviews\/bulk-status$/);
      if (match && req.method === "PATCH") {
        const input = await body(req);
        return json(
          res,
          200,
          reviews.bulkModerate(Number(match[1]), input.reviewIds, input.status),
        );
      }
      match = path.match(/^\/api\/stores\/(\d+)\/reviews\/(\d+)\/imported$/);
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          reviews.updateImported(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/reviews\/(\d+)$/);
      if (match && req.method === "GET")
        return json(res, 200, reviews.get(Number(match[1]), Number(match[2])));
      if (match && req.method === "PATCH")
        return json(
          res,
          200,
          reviews.updateManual(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      if (match && req.method === "DELETE")
        return json(
          res,
          200,
          reviews.delete(Number(match[1]), Number(match[2])),
        );
      match = path.match(/^\/api\/stores\/(\d+)\/reviews\/(\d+)\/status$/);
      if (match && req.method === "PATCH") {
        const input = await body(req);
        return json(
          res,
          200,
          reviews.moderate(Number(match[1]), Number(match[2]), input.status),
        );
      }
      match = path.match(
        /^\/api\/public\/stores\/(\d+)\/products\/(\d+)\/reviews$/,
      );
      if (match && req.method === "GET")
        return json(
          res,
          200,
          reviews.publicProduct(Number(match[1]), Number(match[2])),
        );
      if (match && req.method === "POST")
        return json(
          res,
          201,
          reviews.createConsumer(
            Number(match[1]),
            Number(match[2]),
            await body(req),
          ),
        );
      match = path.match(/^\/api\/public\/stores\/(\d+)\/pincodes\/([^/]+)$/);
      if (match && req.method === "GET")
        return json(
          res,
          200,
          await pincodes.resolve(
            Number(match[1]),
            decodeURIComponent(match[2]),
          ),
        );
      match = path.match(/^\/api\/public\/([^/]+)\/([^/]+)\/checkouts$/);
      if (match && req.method === "POST") {
        const published = service.getPublishedPage(match[1], match[2]),
          configured = settingsService.get(published.page.storeId),
          input = await body(req),
          openingCheckout = input.intent === "open",
          tokenValid = visitorTokenIsValid(
            input.checkoutToken,
            published.page.storeId,
            published.page.slug,
          ),
          risk = await botProtection.assess(
            published.page.storeId,
            input,
            {
              ipAddress: req.socket.remoteAddress || "",
              settings: {
                ...configured.codForm.protection.botProtection,
                otpEnabled: configured.codForm.otp.enabled,
                enabled:
                  configured.codForm.protection.botTraffic &&
                  configured.codForm.protection.botProtection.enabled,
              },
              tokenValid,
            },
          );
        if (risk.action === "block")
          throw Error("This checkout attempt was blocked by COD protection");
        if (!configured.codForm.enabled) throw Error("COD Form is disabled");
        if (!configured.checkout.enabled) throw Error("Checkout is disabled");
        let pageContent = {};
        try {
          pageContent = JSON.parse(published.page.contentJson || "{}");
        } catch {}
        if (pageContent.codEnabled === false)
          throw Error("Checkout is disabled for this product page");
        if (!configured.privacy.allowCustomerDataCollection)
          throw Error("Customer data collection is disabled");
        if (
          !openingCheckout &&
          input.intent !== "submit" &&
          !configured.privacy.allowAbandonedCheckoutData
        )
          throw Error("Abandoned checkout data collection is disabled");
        if (
          !configured.codForm.saveIncompleteCheckout ||
          !configured.checkout.captureAbandonedCheckout
        ) {
          if (!openingCheckout && input.intent !== "submit")
            throw Error("Abandoned checkout capture is disabled");
        }
        if (
          !configured.checkout.couponField &&
          String(input.couponCode || "").trim()
        )
          throw Error("Coupon field is disabled");
        const checkout = service.saveCheckoutDraft(published.page.storeId, {
            ...input,
            protectionSettings: configured.codForm.protection,
            ipAddress: req.socket.remoteAddress || "",
            pageId: published.page.id,
            productId: published.product.id,
            checkoutTokenValid: tokenValid,
            deviceId: input.deviceId,
            behavior: input.behavior,
            botRiskScore: risk.score,
            botRiskLevel: risk.level,
            botAction: risk.action,
            otpRequired:
              configured.codForm.otp.enabled &&
              (configured.codForm.otp.requiredForCod ||
                risk.action === "require_otp"),
          });
        botProtection.linkCheckout(
          published.page.storeId,
          risk.id,
          checkout.id,
        );
        await pixels.track(
          published.page.storeId,
          {
            eventName: "checkout_started",
            eventId: `CHECKOUT-${checkout.id}`,
            source: "server",
            sessionId: input.visitorSessionId,
            productId: published.product.id,
            pageId: published.page.id,
            pageSlug: published.page.slug,
            quantity: checkout.quantity,
            bundleId: checkout.bundleId,
            checkoutSessionId: checkout.id,
            checkoutProgress: checkout.currentStage || "checkout_opened",
            currency: service.getStore(published.page.storeId).currency,
            checkoutValue: Number(checkout.totalPaise || 0) / 100,
            analyticsConsentGranted: input.analyticsConsentGranted,
            consentGranted: input.consentGranted === true,
          },
          {
            ipAddress: req.socket.remoteAddress || "",
            userAgent: req.headers["user-agent"] || "",
          },
        );
        return json(res, 201, checkout);
      }
      match = path.match(/^\/api\/public\/checkouts\/([^/]+)$/);
      if (match && req.method === "PATCH") {
        const input = await body(req),
          storeId = Number(input.storeId),
          configured = settingsService.get(storeId).codForm.otp,
          existing = service.getCheckout(storeId, match[1]);
        if (
          existing.phoneVerificationStatus === "VERIFIED" &&
          input.phone !== undefined &&
          String(input.phone).trim() !== existing.phone &&
          !configured.allowPhoneChange
        )
          throw Error("Phone number cannot be changed after OTP verification");
        const
          checkout = service.saveCheckoutDraft(storeId, {
            ...input,
            ipAddress: req.socket.remoteAddress || "",
            sessionId: match[1],
          });
        await pixels.track(storeId, {
          eventName: "checkout_progress",
          eventId: `CHECKOUT-PROGRESS-${checkout.id}-${checkout.currentStage || "checkout_opened"}`,
          source: "server",
          sessionId: input.visitorSessionId,
          productId: checkout.productId,
          pageId: checkout.pageId,
          checkoutSessionId: checkout.id,
          checkoutProgress: checkout.currentStage || "checkout_opened",
          quantity: checkout.quantity,
          bundleId: checkout.bundleId,
          currency: service.getStore(storeId).currency,
          checkoutValue: Number(checkout.totalPaise || 0) / 100,
          analyticsConsentGranted: input.analyticsConsentGranted,
          consentGranted: input.consentGranted === true,
        });
        if (checkout.couponCode && Number(checkout.discountPaise || 0) > 0)
          await pixels.track(storeId, {
            eventName: "coupon_applied",
            eventId: `COUPON-${checkout.id}-${checkout.couponCode}`,
            source: "server",
            sessionId: input.visitorSessionId,
            productId: checkout.productId,
            pageId: checkout.pageId,
            checkoutSessionId: checkout.id,
            couponCode: checkout.couponCode,
            discount: Number(checkout.discountPaise) / 100,
            currency: service.getStore(storeId).currency,
            analyticsConsentGranted: input.analyticsConsentGranted,
            consentGranted: input.consentGranted === true,
          });
        return json(res, 200, checkout);
      }
      match = path.match(/^\/api\/public\/checkouts\/([^/]+)\/order$/);
      if (match && req.method === "POST") {
        const input = await body(req),
          storeId = Number(input.storeId),
          checkout = service.getCheckout(storeId, match[1]),
          configured = settingsService.get(storeId),
          orderRisk = await botProtection.assess(
            storeId,
            {
              intent: "submit",
              phone: checkout.phone,
              deviceId: checkout.deviceId,
              visitorSessionId: input.visitorSessionId,
              behavior: checkout.behaviorJson,
            },
            {
              ipAddress: checkout.ipAddress,
              settings: {
                ...configured.codForm.protection.botProtection,
                otpEnabled: configured.codForm.otp.enabled,
                enabled:
                  configured.codForm.protection.botTraffic &&
                  configured.codForm.protection.botProtection.enabled,
              },
              tokenValid: Boolean(checkout.checkoutTokenValid),
            },
          ),
          location = await pincodes.resolve(storeId, checkout.pincode);
        if (orderRisk.action === "block")
          throw Error("This checkout attempt was blocked by COD protection");
        const requiresOtp =
          configured.codForm.otp.enabled &&
          (Boolean(checkout.otpRequired) ||
            configured.codForm.otp.requiredForCod ||
            orderRisk.action === "require_otp");
        db.prepare(
          "UPDATE checkout_sessions SET bot_risk_score=?,bot_risk_level=?,bot_action=?,otp_required=?,phone_verification_status=CASE WHEN ?=0 THEN 'NOT_REQUIRED' ELSE phone_verification_status END,phone_verified_at=CASE WHEN ?=0 THEN NULL ELSE phone_verified_at END WHERE store_id=? AND id=?",
        ).run(
          orderRisk.score,
          orderRisk.level,
          orderRisk.action,
          requiresOtp ? 1 : 0,
          requiresOtp ? 1 : 0,
          requiresOtp ? 1 : 0,
          storeId,
          match[1],
        );
        try {
          otp.requireVerified(storeId, match[1], { required: requiresOtp });
        } catch (error) {
          if (error.otpRequired)
            return json(res, 409, {
              error: error.message,
              otpRequired: true,
              checkoutSessionId: match[1],
              phone: error.phone,
            });
          throw error;
        }
        service.applyValidatedPincode(storeId, match[1], location);
        const order = service.placeCodOrder(storeId, { sessionId: match[1] }),
          store = service.getStore(storeId);
        await pixels.track(storeId, {
          eventName: "checkout_progress",
          eventId: `CHECKOUT-PROGRESS-${match[1]}-order_submitted`,
          source: "server",
          sessionId: input.visitorSessionId,
          productId: checkout.productId,
          pageId: checkout.pageId,
          checkoutSessionId: match[1],
          checkoutProgress: "order_submitted",
          quantity: checkout.quantity,
          bundleId: checkout.bundleId,
          analyticsConsentGranted: input.analyticsConsentGranted,
          consentGranted: input.consentGranted === true,
        });
        await pixels.track(storeId, {
          eventName: "order_created",
          eventId: `ORDER-${order.id}`,
          source: "server",
          sessionId: input.visitorSessionId,
          productId: checkout.productId,
          pageId: checkout.pageId,
          checkoutSessionId: match[1],
          orderId: order.id,
          customerReference: order.customerId,
          bundleId: checkout.bundleId,
          quantity: checkout.quantity,
          currency: store.currency,
          orderValue: Number(order.totalPaise || 0) / 100,
          discount: Number(order.discountPaise || 0) / 100,
          shipping: Number(order.shippingPaise || 0) / 100,
          analyticsConsentGranted: input.analyticsConsentGranted,
          consentGranted: input.consentGranted === true,
        });
        const thankYouUrl =
            resolvedDomain?.storeId === storeId
              ? `/thank-you/${encodeURIComponent(match[1])}`
              : `/s/${encodeURIComponent(store.slug)}/thank-you/${encodeURIComponent(match[1])}`,
          offer = order.postPurchaseUpsell,
          upsellUrl = offer
            ? `${resolvedDomain?.storeId === storeId ? "" : `/s/${encodeURIComponent(store.slug)}`}/upsell/${encodeURIComponent(match[1])}?offer=${offer.id}&token=${encodeURIComponent(offer.token)}`
            : null,
          { postPurchaseUpsell: _privateOffer, ...publicOrder } = order;
        return json(res, 201, {
          ...publicOrder,
          thankYouUrl: upsellUrl || thankYouUrl,
          finalThankYouUrl: thankYouUrl,
          upsellUrl,
          nextUrl: upsellUrl || thankYouUrl,
        });
      }
      match = path.match(/^\/api\/public\/upsells\/(\d+)\/(accept|reject)$/);
      if (match && req.method === "POST") {
        const input = await body(req),
          action = match[2],
          result =
            action === "accept"
              ? service.acceptOrderUpsell(
                  input.storeSlug,
                  input.checkoutSessionId,
                  Number(match[1]),
                  input.token,
                )
              : service.rejectOrderUpsell(
                  input.storeSlug,
                  input.checkoutSessionId,
                  Number(match[1]),
                  input.token,
                ),
          thankYouUrl =
            resolvedDomain?.storeSlug === result.interaction.storeSlug
              ? `/thank-you/${encodeURIComponent(result.interaction.checkoutSessionId)}`
              : `/s/${encodeURIComponent(result.interaction.storeSlug)}/thank-you/${encodeURIComponent(result.interaction.checkoutSessionId)}`;
        await pixels
          .track(result.interaction.storeId, {
            eventName: action === "accept" ? "upsell_accepted" : "upsell_rejected",
            eventId: `UPSELL-${result.interaction.id}-${action.toUpperCase()}`,
            source: "server",
            sessionId: input.visitorSessionId,
            productId: result.product.id,
            pageId: result.interaction.pageId,
            checkoutSessionId: result.interaction.checkoutSessionId,
            orderId: result.interaction.orderId,
            currency: result.interaction.storeCurrency,
            value:
              action === "accept"
                ? Number(result.interaction.upsellValue || 0) / 100
                : 0,
            analyticsConsentGranted: input.analyticsConsentGranted,
            consentGranted: input.consentGranted === true,
          })
          .catch(() => {});
        return json(res, 200, { ...result, nextUrl: thankYouUrl });
      }
      if (resolvedDomain && req.method === "GET") {
        const storeSlug = resolvedDomain.storeSlug;
        match = path.match(/^\/checkout\/([^/]+)$/);
        if (match) {
          const sessionId = decodeURIComponent(match[1]);
          if (service.hasCompletedCheckout(storeSlug, sessionId)) {
            res.writeHead(303, {
              location: `/thank-you/${encodeURIComponent(sessionId)}`,
              "cache-control": "no-store",
            });
            return res.end();
          }
          try {
            const details = service.getPublicCheckoutDetails(
                storeSlug,
                decodeURIComponent(match[1]),
              ),
              configured = settingsService.get(details.page.storeId);
            if (!configured.codForm.enabled || !configured.checkout.enabled)
              throw Error("Checkout is disabled");
            const html = checkoutPage({
              ...details,
              pixels: pixels.activePixels(details.page.storeId, {
                pageId: details.page.id,
                productId: details.product.id,
              }),
              settings: configured,
              storefrontProduct: storefront.getProduct(
                details.page.storeId,
                details.product.id,
              ),
              storefront: storefront.getPublic(details.page.storeId),
              writtenPolicies: policies.listPublished(details.page.storeId),
            });
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            return res.end(customDomainHtml(html, storeSlug));
          } catch (error) {
            if (/not found|disabled|expired|submitted/i.test(error.message))
              return customerPageError(res);
            throw error;
          }
        }
        match = path.match(/^\/upsell\/([^/]+)$/);
        if (match) {
          try {
            const sessionId = decodeURIComponent(match[1]),
              eventId = Number(url.searchParams.get("offer")),
              token = url.searchParams.get("token") || "",
              details = service.getPublicOrderUpsell(
                storeSlug,
                sessionId,
                eventId,
                token,
              );
            await pixels
              .track(details.interaction.storeId, {
                eventName: "upsell_viewed",
                eventId: `UPSELL-${details.interaction.id}-VIEWED`,
                source: "server",
                productId: details.product.id,
                pageId: details.interaction.pageId,
                checkoutSessionId: sessionId,
                orderId: details.interaction.orderId,
                currency: details.interaction.storeCurrency,
                consentGranted: false,
              })
              .catch(() => {});
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            return res.end(
              upsellPage(
                { ...details, token },
                {
                  acceptUrl: `/api/public/upsells/${eventId}/accept`,
                  rejectUrl: `/api/public/upsells/${eventId}/reject`,
                  thankYouUrl: `/thank-you/${encodeURIComponent(sessionId)}`,
                  storefront: storefront.getPublic(details.interaction.storeId),
                  writtenPolicies: policies.listPublished(details.interaction.storeId),
                },
              ),
            );
          } catch (error) {
            if (/not found/i.test(error.message)) return customerPageError(res);
            throw error;
          }
        }
        match = path.match(/^\/pages\/([^/]+)$/);
        if (match && req.method==='GET') {
          const store=policies.storeBySlug(storeSlug), page=onlineStore.publicPage(store.id,decodeURIComponent(match[1]));
          res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
          return res.end(customDomainHtml(onlineContentPage(storefront.getPublic(store.id),page,policies.listPublished(store.id)),storeSlug));
        }
        match = path.match(/^\/policies\/([^/]+)$/);
        if (match) {
          try {
            const store = policies.storeBySlug(storeSlug),
              policy = policies.getPublic(store.id, decodeURIComponent(match[1]));
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            return res.end(
              customDomainHtml(
                policyPage(
                  store,
                  policy,
                  settingsService.get(store.id).privacy,
                  false,
                  storefront.getPublic(store.id),
                  policies.listPublished(store.id),
                ),
                storeSlug,
              ),
            );
          } catch (error) {
            if (/not found|not published/i.test(error.message))
              return json(res, 404, { error: "Published policy not found" });
            throw error;
          }
        }
        match = path.match(/^\/thank-you\/([^/]+)$/);
        if (match) {
          try {
            const details = service.getThankYouDetails(
              storeSlug,
              decodeURIComponent(match[1]),
            );
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            return res.end(
              customDomainHtml(
                thankYouPage(
                  details,
                  pixels.activePixels(details.storeId, {
                    pageId: details.pageId,
                    productId: details.items?.[0]?.productId,
                  }),
                  settingsService.get(details.storeId),
                  policies.listPublished(details.storeId),
                  storefront.getPublic(details.storeId),
                ),
                storeSlug,
              ),
            );
          } catch (error) {
            if (/not found/i.test(error.message))
              return json(res, 404, { error: "Thank You Page not found" });
            throw error;
          }
        }
        match = path.match(/^\/products\/([^/]+)$/);
        if (match) {
          try {
            const productRow = db.prepare('SELECT id FROM products WHERE store_id=? AND slug=? AND active=1')
              .get(resolvedDomain.storeId, decodeURIComponent(match[1]));
            const linked = productRow && storefront.getProduct(resolvedDomain.storeId, productRow.id);
            const canonical = linked && { status: linked.status, page_slug: linked.pageSlug };
            if (canonical && (canonical.status !== "published" || !canonical.page_slug))
              throw Error("Published product storefront not found");
            const published = service.getPublishedPage(
                storeSlug,
                canonical?.page_slug || decodeURIComponent(match[1]),
              ),
              storefrontProduct = storefront.getProduct(
                published.page.storeId,
                published.product.id,
              ),
              html = executablePublicPage({
                ...published,
                pixels: pixels.activePixels(published.page.storeId, {
                  pageId: published.page.id,
                  productId: published.product.id,
                }),
                settings: settingsService.get(published.page.storeId),
                reviewsData: reviews.publicProduct(
                  published.page.storeId,
                  published.product.id,
                ),
                writtenPolicies: policies.listPublished(published.page.storeId),
                storefrontProduct,
                storefront: storefront.getPublic(published.page.storeId),
                storeData: service.getStore(published.page.storeId),
              });
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            return res.end(customDomainHtml(html, storeSlug));
          } catch (error) {
            if (/not found|not published|published/i.test(error.message))
              return customerPageError(res);
            throw error;
          }
        }
        if (path === "/") {
          try {
            const model = storefront.publicHome(storeSlug),
              html = storefrontHomePage({
                storefront: model,
                preferences: onlineStore.preferences(model.store.id),
                writtenPolicies: policies.listPublished(model.store.id),
              });
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            return res.end(customDomainHtml(html, storeSlug));
          } catch {
            const custom = domains.storefrontForHost(req.headers.host || "");
            if (custom?.pageSlug) {
              const published = service.getPublishedPage(storeSlug, custom.pageSlug),
                html = executablePublicPage({
                  ...published,
                  pixels: pixels.activePixels(published.page.storeId, {
                    pageId: published.page.id,
                    productId: published.product.id,
                  }),
                  settings: settingsService.get(published.page.storeId),
                  reviewsData: reviews.publicProduct(
                    published.page.storeId,
                    published.product.id,
                  ),
                  writtenPolicies: policies.listPublished(published.page.storeId),
                  storefrontProduct: storefront.getProduct(
                    published.page.storeId,
                    published.product.id,
                  ),
                  storefront: storefront.getPublic(published.page.storeId),
                  storeData: service.getStore(published.page.storeId),
                });
              res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
              return res.end(customDomainHtml(html, storeSlug));
            }
            return json(res, 404, { error: "Storefront not found" });
          }
        }
      }
      match = path.match(/^\/s\/([^/]+)(\/.*)?$/);
      if (match && ["GET", "HEAD"].includes(req.method)) {
        const storeSlug = decodeURIComponent(match[1]),
          activeDomain = domains.activeDomainForStoreSlug(storeSlug);
        if (activeDomain?.openUrl) {
          res.writeHead(308, {
            location: `${activeDomain.openUrl}${match[2] || "/"}${url.search}`,
            "cache-control": "public, max-age=300",
          });
          return res.end();
        }
      }
      match = path.match(/^\/s\/([^/]+)\/checkout\/([^/]+)$/);
      if (match && req.method === "GET") {
        const storeSlug = decodeURIComponent(match[1]), sessionId = decodeURIComponent(match[2]);
        if (service.hasCompletedCheckout(storeSlug, sessionId)) {
          res.writeHead(303, {
            location: `/s/${encodeURIComponent(storeSlug)}/thank-you/${encodeURIComponent(sessionId)}`,
            "cache-control": "no-store",
          });
          return res.end();
        }
        try {
          const details = service.getPublicCheckoutDetails(
              decodeURIComponent(match[1]),
              decodeURIComponent(match[2]),
            ),
            configured = settingsService.get(details.page.storeId);
          if (!configured.codForm.enabled || !configured.checkout.enabled)
            throw Error("Checkout is disabled");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            checkoutPage({
              ...details,
              pixels: pixels.activePixels(details.page.storeId, {
                pageId: details.page.id,
                productId: details.product.id,
              }),
              settings: configured,
              storefrontProduct: storefront.getProduct(
                details.page.storeId,
                details.product.id,
              ),
              storefront: storefront.getPublic(details.page.storeId),
              writtenPolicies: policies.listPublished(details.page.storeId),
            }),
          );
        } catch (error) {
          if (/not found|disabled|expired|submitted/i.test(error.message))
            return customerPageError(res);
          throw error;
        }
      }
      match = path.match(/^\/s\/([^/]+)\/upsell\/([^/]+)$/);
      if (match && req.method === "GET") {
        try {
          const storeSlug = decodeURIComponent(match[1]),
            sessionId = decodeURIComponent(match[2]),
            eventId = Number(url.searchParams.get("offer")),
            token = url.searchParams.get("token") || "",
            details = service.getPublicOrderUpsell(
              storeSlug,
              sessionId,
              eventId,
              token,
            );
          await pixels
            .track(details.interaction.storeId, {
              eventName: "upsell_viewed",
              eventId: `UPSELL-${details.interaction.id}-VIEWED`,
              source: "server",
              productId: details.product.id,
              pageId: details.interaction.pageId,
              checkoutSessionId: sessionId,
              orderId: details.interaction.orderId,
              currency: details.interaction.storeCurrency,
              consentGranted: false,
            })
            .catch(() => {});
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            upsellPage(
              { ...details, token },
              {
                acceptUrl: `/api/public/upsells/${eventId}/accept`,
                rejectUrl: `/api/public/upsells/${eventId}/reject`,
                thankYouUrl: `/s/${encodeURIComponent(storeSlug)}/thank-you/${encodeURIComponent(sessionId)}`,
                  storefront: storefront.getPublic(details.interaction.storeId),
                  writtenPolicies: policies.listPublished(details.interaction.storeId),
              },
            ),
          );
        } catch (error) {
          if (/not found/i.test(error.message)) return customerPageError(res);
          throw error;
        }
      }
      match = path.match(/^\/s\/([^/]+)\/policies\/([^/]+)$/);
      if (match && req.method === "GET") {
        try {
          const store = policies.storeBySlug(decodeURIComponent(match[1])),
            policy = policies.getPublic(store.id, decodeURIComponent(match[2]));
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            policyPage(
              store,
              policy,
              settingsService.get(store.id).privacy,
              false,
              storefront.getPublic(store.id),
              policies.listPublished(store.id),
            ),
          );
        } catch (error) {
          if (/not found|not published/i.test(error.message))
            return json(res, 404, { error: "Published policy not found" });
          throw error;
        }
      }
      match = path.match(/^\/s\/([^/]+)\/thank-you\/([^/]+)$/);
      if (match && req.method === "GET") {
        let details;
        try {
          details = service.getThankYouDetails(
            decodeURIComponent(match[1]),
            decodeURIComponent(match[2]),
          );
        } catch (error) {
          if (/not found/i.test(error.message))
            return json(res, 404, { error: "Thank You Page not found" });
          throw error;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(
          thankYouPage(
            details,
            pixels.activePixels(details.storeId, {
              pageId: details.pageId,
              productId: details.items?.[0]?.productId,
            }),
            settingsService.get(details.storeId),
            policies.listPublished(details.storeId),
            storefront.getPublic(details.storeId),
          ),
        );
      }
      match = path.match(/^\/s\/([^/]+)\/products\/([^/]+)$/);
      if (match && req.method === "GET") {
        const storeSlug = decodeURIComponent(match[1]);
        const productSlug = decodeURIComponent(match[2]);
        const storeRecord = db
          .prepare("SELECT id,name,slug,currency FROM stores WHERE slug=?")
          .get(storeSlug);
        if (!storeRecord) return customerPageError(res);
        const storeId = storeRecord.id;
        try {
          const productRow = db
            .prepare(
              "SELECT id FROM products WHERE store_id=? AND slug=? AND active=1",
            )
            .get(storeId, productSlug);
          if (!productRow)
            throw new Error("Published product storefront not found");
          const storefrontProduct = storefront.getProduct(
            storeId,
            productRow.id,
          );
          if (storefrontProduct.status !== "published")
            throw new Error("Published product storefront not found");
          const product = service.getProduct(storeId, productRow.id);
          const page = service.getPage(storeId, storefrontProduct.pageId);
          if (page.status !== "published" || page.deletedAt)
            throw Error("Connected product page is not published");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            executablePublicPage({
              page: { ...page, storeSlug: storeSlug },
              product,
              bundles: service
                .listBundles(storeId, product.id)
                .filter((bundle) => bundle.active),
              upsells: service
                .listUpsells(storeId, product.id)
                .filter(
                  (upsell) => upsell.active && upsell.upsellProductStock > 0,
                ),
              downsells: service
                .listDownsells(storeId, product.id)
                .filter(
                  (downsell) =>
                    downsell.active && downsell.downsellProductStock > 0,
                ),
              exitOffer: service.eligibleExitOffer(storeId, {
                productId: product.id,
                pageId: page.id,
                context: "product_page",
              }),
              pixels: pixels.activePixels(storeId, {
                pageId: page.id,
                productId: product.id,
              }),
              settings: settingsService.get(storeId),
              reviewsData: reviews.publicProduct(storeId, product.id),
              writtenPolicies: policies.listPublished(storeId),
              storefrontProduct,
              storefront: storefront.getPublic(storeId),
              storeData: storeRecord,
            }),
          );
        } catch (error) {
          if (
            /not found|not published|published|must belong/i.test(error.message)
          )
            return customerPageError(res);
          throw error;
        }
      }
      match = path.match(/^\/s\/([^/]+)\/([^/]+)$/);
      if (match && req.method === "GET") {
        try {
          const published = service.getPublishedPage(match[1], match[2]),
            storefrontProduct = storefront.getProduct(
              published.page.storeId,
              published.product.id,
            );
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            executablePublicPage({
              ...published,
              pixels: pixels.activePixels(published.page.storeId, {
                pageId: published.page.id,
                productId: published.product.id,
              }),
              settings: settingsService.get(published.page.storeId),
              reviewsData: reviews.publicProduct(
                published.page.storeId,
                published.product.id,
              ),
              writtenPolicies: policies.listPublished(published.page.storeId),
              storefrontProduct,
              storefront: storefront.getPublic(published.page.storeId),
              storeData: service.getStore(published.page.storeId),
            }),
          );
        } catch (error) {
          if (/not found|not published|published/i.test(error.message))
            return customerPageError(res);
          throw error;
        }
      }
      match = path.match(/^\/s\/([^/]+)$/);
      if (match && req.method === "GET") {
        try {
          const model = storefront.publicHome(match[1]);
          const storeId = model.store.id;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            storefrontHomePage({
              storefront: model,
              preferences: onlineStore.preferences(storeId),
              writtenPolicies: policies.listPublished(storeId),
            }),
          );
        } catch (error) {
          if (
            /Storefront not found|not found|not published|no policy/i.test(
              error.message,
            )
          ) {
            return json(res, 404, { error: "Storefront not found" });
          }
          throw error;
        }
      }
      if (req.method === "GET" && path === "/") {
        const custom = domains.storefrontForHost(req.headers.host || "");
        if (custom) {
          const published = service.getPublishedPage(
            custom.storeSlug,
            custom.pageSlug,
          );
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            executablePublicPage({
              ...published,
              pixels: pixels.activePixels(published.page.storeId, {
                pageId: published.page.id,
                productId: published.product.id,
              }),
              settings: settingsService.get(published.page.storeId),
              reviewsData: reviews.publicProduct(
                published.page.storeId,
                published.product.id,
              ),
              writtenPolicies: policies.listPublished(published.page.storeId),
              storefrontProduct: storefront.getProduct(
                published.page.storeId,
                published.product.id,
              ),
              storefront: storefront.getPublic(published.page.storeId),
              storeData: service.getStore(published.page.storeId),
            }),
          );
        }
      }
      if (req.method === "GET") {
        if (/^\/icons\/[a-z0-9-]+\.svg$/.test(path)) {
          let icon;
          try { icon = await readFile(join(root, path.slice(1))); }
          catch (error) { if (error.code === 'ENOENT') return json(res, 404, { error: 'Icon not found' }); throw error; }
          res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
          return res.end(icon);
        }
        const files = {
          "/": "index.html",
          "/app.js": "app.js",
          "/account.js": "account.js",
          "/merchant-workspace.js": "merchant-workspace.js",
          "/merchant-ui.css": "merchant-ui.css",
          "/brand/commera2-logo-v1.png": "brand/commera2-logo-v1.png",
          "/brand/commera2-icon-v1.png": "brand/commera2-icon-v1.png",
          "/otp-checkout.js": "otp-checkout.js",
          "/styles.css": "styles.css",
          "/reviews-ui.css": "reviews-ui.css",
          "/store.css": "store.css",
          "/confirmation-animation.css": "confirmation-animation.css",
          "/confirmation-animation.js": "confirmation-animation.js",
          "/exit-offer.js": "exit-offer.js",
          "/page-blocks.js": "page-blocks.js",
          "/page-blocks.css": "page-blocks.css",
          "/online-store.js": "online-store.js",
          "/online-store.css": "online-store.css",
        };
        if (files[path]) {
          const file = join(root, files[path]);
          const types = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".png": "image/png",
          };
          res.writeHead(200, {
            "content-type": types[extname(file)],
            "cache-control": extname(file) === ".html" ? "no-store" : "no-cache",
          });
          return res.end(await readFile(file));
        }
        const merchantRoute =
          /^\/(?:online-store(?:\/(?:themes(?:\/current\/edit)?|pages(?:\/(?:new|[a-f0-9-]+\/edit))?|preferences))?|overview|store|products(?:\/(?:new|\d+|[a-z-]+))?|product-pages(?:\/\d+\/edit)?|reviews(?:\/[a-z-]+)?|orders(?:\/\d+)?|customers|abandoned|live-visitors|policy(?:\/[a-z-]+)?|settings(?:\/[a-z-]+)?)\/?$/;
        if (merchantRoute.test(path) || ["/account", "/reset-password"].includes(path)) {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          });
          return res.end(await readFile(join(root, "index.html")));
        }
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      errorResponse(res, error);
    }
  });
  return {
    service,
    get port() {
      return actualPort;
    },
    start: (host = process.env.HOST || "0.0.0.0") =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          actualPort = server.address().port;
          if (Number.isFinite(domainSyncIntervalMs) && domainSyncIntervalMs > 0) {
            domainSyncTimer = setInterval(
              () => domains.syncPendingDomains().catch(() => {}),
              Math.max(5_000, domainSyncIntervalMs),
            );
            domainSyncTimer.unref?.();
          }
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        if (domainSyncTimer) clearInterval(domainSyncTimer);
        domainSyncTimer = null;
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const host = process.env.HOST || "0.0.0.0";
  const app = createApp();
  await app.start(host);
  console.log(`Commera2 running at http://${host}:${app.port}`);
}
