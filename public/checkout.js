const form = document.querySelector('#cod-form');
const status = document.querySelector('#status');
const price = document.querySelector('#checkout-price');
const pincode = form.elements.pincode, city = form.elements.city, state = form.elements.state, country = form.elements.country;
const pincodeStatus = document.querySelector('#pincode-status');
const submitButton = form.querySelector('.place-order-button');
const applyCoupon = document.querySelector('#apply-coupon');
const couponStatus = document.querySelector('#coupon-status');
const FORMAT_MONEY = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY }).format(Number(value || 0) / 100);
let timer, lookupTimer, lookupController, lookupVersion = 0;
let validatedPincode = INITIAL_PINCODE, pincodeReady = Boolean(INITIAL_PINCODE);
let saveQueue = Promise.resolve(), saveRevision = 0, lastSaved;
let orderPending = false;
const originalLabel = submitButton.textContent;
const lockedControls = new Map();
const progress = [...document.querySelectorAll('.checkout-progress strong')];

function syncProgress() {
  const contact = ['name', 'phone'].every(key => form.elements[key]?.value.trim() && form.elements[key].validity.valid);
  const delivery = pincodeReady && Boolean(form.elements.address?.value.trim()) && form.elements.address.validity.valid;
  const current = contact ? (delivery ? 2 : 1) : 0;
  progress.forEach((step, index) => {
    step.classList.toggle('is-complete', index < current);
    if (index === current) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}

function setBusy(busy) {
  orderPending = busy;
  form.setAttribute('aria-busy', String(busy));
  submitButton.disabled = busy || HARD_DISABLED;
  submitButton.setAttribute('aria-busy', String(busy));
  submitButton.textContent = busy ? 'Placing order...' : originalLabel;
  if (busy) {
    // Inert prevents edits without dropping fields from FormData or disabling OTP controls.
    for (const control of form.elements) {
      if (control.type === 'hidden' || control === submitButton || control.closest('.otp-verification')) continue;
      lockedControls.set(control, control.inert);
      control.inert = true;
    }
  } else {
    for (const [control, wasInert] of lockedControls) control.inert = wasInert;
    form.querySelectorAll('[name="shippingMethodId"]').forEach(control => { control.inert = false; });
    lockedControls.clear();
  }
}

function setSummary(out) {
  lastSaved = out;
  price.textContent = FORMAT_MONEY(out.totalPaise);
  document.querySelector('#checkout-total-compact').textContent = price.textContent;
  const discount = document.querySelector('#summary-discount');
  const shipping = document.querySelector('#summary-shipping');
  const subtotal = document.querySelector('#summary-product-price');
  if (discount) discount.textContent = out.discountPaise ? '-' + FORMAT_MONEY(out.discountPaise) : '\u2014';
  if (shipping) shipping.textContent = out.shippingPaise ? FORMAT_MONEY(out.shippingPaise) : out.pincodeValidated ? 'Free' : 'Calculated by location';
  if (subtotal && Number.isFinite(out.subtotalPaise)) subtotal.textContent = FORMAT_MONEY(out.subtotalPaise - (out.addons || []).reduce((sum, item) => sum + item.pricePaise, 0));
  let credit = document.querySelector('#summary-gift-card');
  if (!credit && out.giftCardAppliedPaise) {
    credit = document.createElement('div'); credit.id = 'summary-gift-card';
    credit.innerHTML = '<dt>Gift card</dt><dd></dd>';
    document.querySelector('#checkout-summary-body .summary-total').before(credit);
  }
  if (credit) { credit.hidden = !out.giftCardAppliedPaise; credit.querySelector('dd').textContent = '-' + FORMAT_MONEY(out.giftCardAppliedPaise); }
  if (couponStatus) {
    const applied = Boolean(out.couponCode && out.discountPaise);
    couponStatus.textContent = applied ? 'Coupon ' + out.couponCode + ' applied. You save ' + FORMAT_MONEY(out.discountPaise) : '';
    couponStatus.dataset.state = applied ? 'success' : '';
    form.elements.couponCode?.setAttribute('aria-invalid', 'false');
  }
}

function values(intent = 'draft') {
  const data = Object.fromEntries(new FormData(form));
  data.intent = intent;
  data.quantity = Number(data.quantity || 1);
  for (const key of ['bundleId', 'upsellId', 'downsellId']) data[key] = data[key] ? Number(data[key]) : null;
  data.storeId = STORE_ID;
  data.analyticsConsentGranted = window.commera2AnalyticsConsent?.() ?? false;
  data.consentGranted = window.commera2TrackingConsent?.() ?? false;
  return data;
}

async function checkoutRequest(url, init, fallback) {
  let response;
  try { response = await fetch(url, init); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw Error(fallback + '. Check your connection and try again.');
  }
  const out = await response.json().catch(() => null);
  if (!response.ok || !out) {
    const error = Error(out?.error || fallback + '. Please try again.');
    if (out?.completed && out.nextUrl) error.receiptUrl = out.nextUrl;
    throw error;
  }
  return out;
}

function save(intent = 'draft') {
  if (orderPending && intent !== 'submit') return saveQueue;
  const payload = values(intent), revision = ++saveRevision;
  // Serialize snapshots so a slow earlier autosave cannot overwrite a newer choice.
  const task = saveQueue.catch(() => {}).then(async () => {
    try {
      const out = await checkoutRequest('/api/public/checkouts/' + encodeURIComponent(SESSION_ID), {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      }, 'Could not save checkout');
      if (revision === saveRevision) setSummary(out);
      return out;
    } catch (error) {
      error.ignoreCheckoutFeedback = revision !== saveRevision || (orderPending && intent !== 'submit');
      throw error;
    }
  });
  saveQueue = task;
  return task;
}

function clearLocation() {
  pincodeReady = false; validatedPincode = '';
  if (city) city.value = '';
  if (state) state.value = '';
  if (country) country.value = '';
  syncProgress();
}

async function lookupPincode(force = false) {
  const code = String(pincode?.value || '').trim();
  if (!/^[1-9][0-9]{5}$/.test(code)) {
    clearLocation();
    if (pincodeStatus) pincodeStatus.textContent = code.length >= 6 || force ? 'Please enter a valid six-digit pincode.' : '';
    if (force) throw Error('Please enter a valid pincode');
    return false;
  }
  if (pincodeReady && validatedPincode === code) return true;
  lookupController?.abort();
  const version = ++lookupVersion;
  lookupController = new AbortController();
  if (pincodeStatus) { pincodeStatus.textContent = 'Checking delivery...'; delete pincodeStatus.dataset.state; }
  try {
    const out = await checkoutRequest('/api/public/stores/' + STORE_ID + '/pincodes/' + encodeURIComponent(code), {
      signal: lookupController.signal,
    }, 'Could not check delivery');
    if (version !== lookupVersion || pincode.value.trim() !== code) return false;
    if (city) city.value = out.city;
    if (state) state.value = out.state;
    if (country) country.value = out.country;
    pincodeReady = true; validatedPincode = code;
    if (pincodeStatus) { pincodeStatus.textContent = 'Delivery available in ' + out.city + ', ' + out.state; pincodeStatus.dataset.state = 'success'; }
    syncProgress();
  } catch (error) {
    if (error.name === 'AbortError' || version !== lookupVersion) return false;
    clearLocation();
    if (pincodeStatus) { pincodeStatus.textContent = error.message; pincodeStatus.dataset.state = 'error'; }
    throw error;
  }
  if (!orderPending) await save('draft');
  return true;
}

const fieldNames = { name: 'full name', phone: 'mobile number', alternatePhone: 'alternate phone number', email: 'email address', address: 'delivery address', pincode: 'six-digit pincode' };
function fieldMessage(control) {
  const label = fieldNames[control.name] || control.getAttribute('aria-label') || 'this field';
  if (control.validity.valueMissing) return control.type === 'checkbox' ? (control.name === 'termsAccepted' ? 'Please accept the terms and conditions to continue.' : 'Please select ' + label + '.') : 'Please enter your ' + label + '.';
  if (control.validity.typeMismatch) return 'Please enter a valid ' + label + '.';
  if (control.validity.patternMismatch && ['phone', 'alternatePhone'].includes(control.name)) return 'Enter a valid 10-digit Indian mobile number.';
  if (control.validity.patternMismatch && control.name === 'pincode') return 'Enter a valid six-digit pincode.';
  if (control.validity.tooShort) return 'Please enter a complete ' + label + '.';
  return control.validationMessage || 'Please check ' + label + '.';
}
function validateControl(control) {
  if (!control || control.disabled || control.readOnly || ['hidden', 'radio', 'button', 'submit'].includes(control.type)) return true;
  if (control.name === 'alternatePhone') control.setCustomValidity(control.value.trim() && control.value.trim() === form.elements.phone?.value.trim() ? 'Use a different number for the alternate phone.' : '');
  const valid = control.validity.valid;
  control.classList.toggle('is-invalid', !valid);
  control.setAttribute('aria-invalid', String(!valid));
  const target = document.getElementById('error-' + control.name);
  if (target) target.textContent = valid ? '' : fieldMessage(control);
  return valid;
}
function reportCheckoutError(error) {
  if (error.ignoreCheckoutFeedback) return;
  const message = error.message || 'Something went wrong. Please try again.';
  if (/coupon/i.test(message) && couponStatus) {
    couponStatus.textContent = message; couponStatus.dataset.state = 'error';
    form.elements.couponCode?.setAttribute('aria-invalid', 'true');
    return;
  }
  status.textContent = message;
}
new MutationObserver(() => {
  status.hidden = !status.textContent.trim();
  status.dataset.state = 'error';
}).observe(status, { childList: true, characterData: true, subtree: true });

pincode?.addEventListener('input', () => {
  ++lookupVersion; lookupController?.abort(); clearLocation(); clearTimeout(lookupTimer);
  if (pincodeStatus) { pincodeStatus.textContent = ''; delete pincodeStatus.dataset.state; }
  if (pincode.value.trim().length === 6) lookupTimer = setTimeout(() => lookupPincode().catch(reportCheckoutError), 250);
});
applyCoupon?.addEventListener('click', async () => {
  if (orderPending) return;
  applyCoupon.disabled = true;
  couponStatus.textContent = 'Applying coupon...'; delete couponStatus.dataset.state;
  try { await save('draft'); } catch (error) { reportCheckoutError(error); }
  finally { applyCoupon.disabled = false; }
});
form.addEventListener('invalid', event => { event.preventDefault(); validateControl(event.target); }, true);
form.addEventListener('input', event => {
  if (orderPending || !event.target.name || event.target.closest('.otp-verification')) return;
  const control = event.target;
  control.setCustomValidity?.('');
  status.textContent = '';
  validateControl(control);
  if (control.name === 'phone') validateControl(form.elements.alternatePhone);
  syncProgress();
  if (SAVE_INCOMPLETE && control !== pincode && control.name !== 'couponCode') {
    clearTimeout(timer); timer = setTimeout(() => save().catch(reportCheckoutError), 600);
  }
});
form.addEventListener('change', event => {
  if (['upsellId', 'downsellId'].includes(event.target.name)) save().catch(reportCheckoutError);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (orderPending || HARD_DISABLED) return;
  const valid = [...form.elements].filter(control => control.name && control.name !== 'website').map(validateControl).every(Boolean);
  if (!valid || !form.reportValidity()) { form.querySelector('.is-invalid')?.focus(); return; }
  clearTimeout(timer); clearTimeout(lookupTimer);
  status.textContent = ''; setBusy(true);
  try {
    if (!await lookupPincode(true)) throw Error('Delivery details changed. Please try again.');
    await save('submit');
    const out = await checkoutRequest('/api/public/checkouts/' + encodeURIComponent(SESSION_ID) + '/order', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storeId: STORE_ID, visitorSessionId: window.commera2VisitorSessionId || null, analyticsConsentGranted: window.commera2AnalyticsConsent?.() ?? false, consentGranted: window.commera2TrackingConsent?.() ?? false }),
    }, 'Could not confirm order');
    location.assign(out.thankYouUrl);
  } catch (error) {
    if (error.receiptUrl) { location.assign(error.receiptUrl); return; }
    setBusy(false); reportCheckoutError(error); submitButton.focus({ preventScroll: true });
  }
});

const summary = document.querySelector('.checkout-summary');
const summaryToggle = document.querySelector('#checkout-summary-toggle');
const mobileSummary = matchMedia('(max-width: 1023px)');
function syncSummary() {
  if (!summary || !summaryToggle) return;
  if (!mobileSummary.matches) { summary.classList.remove('is-collapsed'); summaryToggle.setAttribute('aria-expanded', 'true'); }
  else if (!summary.dataset.mobileReady) { summary.classList.add('is-collapsed'); summaryToggle.setAttribute('aria-expanded', 'false'); summary.dataset.mobileReady = 'true'; }
}
summaryToggle?.addEventListener('click', () => summaryToggle.setAttribute('aria-expanded', String(!summary.classList.toggle('is-collapsed'))));
mobileSummary.addEventListener('change', syncSummary); syncSummary(); syncProgress();
submitButton.disabled = HARD_DISABLED;
if (pincode && /^[1-9][0-9]{5}$/.test(pincode.value)) lookupPincode().catch(reportCheckoutError);
if (window.trackCommerceEvent) {
  trackCommerceEvent('page_view', { pageId: window.commera2PageId });
  trackCommerceEvent('checkout_started', { ...CHECKOUT_TRACKING, eventId: 'CHECKOUT-' + SESSION_ID, checkoutSessionId: SESSION_ID, currency: CURRENCY });
}
