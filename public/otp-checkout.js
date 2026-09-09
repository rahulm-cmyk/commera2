(() => {
  const form = document.querySelector("#cod-form");
  if (!form || window.commera2OtpCheckoutLoaded) return;
  window.commera2OtpCheckoutLoaded = true;

  const nativeFetch = window.fetch.bind(window);
  const phoneField = form.querySelector('[name="phone"]');
  const orderStatus = form.querySelector("#status");
  let pendingOrder = null;
  let verification = null;
  let earlyCheckout = null;
  let otpConfig = null;
  let timer = null;

  const panel = document.createElement("section");
  panel.className = "otp-verification";
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `
    <div class="otp-verification__head">
      <span aria-hidden="true">✓</span>
      <div><strong>Verify your mobile number</strong><small id="otp-destination"></small></div>
    </div>
    <label for="checkout-otp">Enter OTP</label>
    <div class="otp-verification__controls">
      <input id="checkout-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" aria-describedby="otp-message">
      <button type="button" id="verify-checkout-otp">Verify &amp; confirm order</button>
    </div>
    <div class="otp-verification__meta">
      <button type="button" id="resend-checkout-otp">Resend OTP</button>
      <span id="otp-countdown"></span>
    </div>
    <p id="otp-message" role="status"></p>`;
  const payment = form.querySelector(".payment-option");
  (payment || form.querySelector(".place-order-button"))?.insertAdjacentElement(
    payment ? "afterend" : "beforebegin",
    panel,
  );

  const destination = panel.querySelector("#otp-destination");
  const input = panel.querySelector("#checkout-otp");
  const message = panel.querySelector("#otp-message");
  const verifyButton = panel.querySelector("#verify-checkout-otp");
  const resendButton = panel.querySelector("#resend-checkout-otp");
  const countdown = panel.querySelector("#otp-countdown");
  const earlyButton = document.createElement("button");
  earlyButton.type = "button";
  earlyButton.className = "otp-send-button";
  earlyButton.textContent = "Send OTP";
  earlyButton.hidden = true;
  phoneField?.closest("label")?.insertAdjacentElement("afterend", earlyButton);

  function showMessage(text, state = "") {
    message.textContent = text;
    message.dataset.state = state;
  }

  function startCountdown(availableAt) {
    clearInterval(timer);
    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((new Date(availableAt).getTime() - Date.now()) / 1000),
      );
      resendButton.disabled = seconds > 0;
      countdown.textContent = seconds ? `Resend available in ${seconds}s` : "";
      if (!seconds) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  async function request(path, payload) {
    const response = await nativeFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "OTP request failed");
    return result;
  }

  async function sendOtp() {
    if (!verification) return;
    resendButton.disabled = true;
    verifyButton.disabled = true;
    showMessage("Sending OTP…");
    try {
      const result = await request("/api/public/otp/send", {
        storeId: window.commera2StoreId,
        checkoutSessionId: verification.checkoutSessionId,
        phone: verification.phone,
        visitorSessionId: window.commera2VisitorSessionId || "",
        analyticsConsentGranted: window.commera2AnalyticsConsent?.() ?? false,
        consentGranted: window.commera2TrackingConsent
          ? window.commera2TrackingConsent()
          : true,
      });
      destination.textContent = `Code sent to ${result.maskedPhone}`;
      showMessage("OTP sent. It will expire shortly.", "success");
      startCountdown(result.resendAvailableAt);
      input.focus();
    } catch (error) {
      showMessage(error.message, "error");
      resendButton.disabled = false;
    } finally {
      verifyButton.disabled = false;
    }
  }

  async function completePendingOrder() {
    if (!pendingOrder) return;
    const { url, init } = pendingOrder;
    const nextInit = { ...init };
    try {
      const body = JSON.parse(nextInit.body || "{}");
      nextInit.body = JSON.stringify({
        ...body,
        visitorSessionId: window.commera2VisitorSessionId || null,
      });
    } catch {}
    const response = await nativeFetch(url, nextInit);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not confirm order");
    location.assign(result.nextUrl || result.thankYouUrl);
  }

  async function createEarlyCheckout() {
    const phone = phoneField?.value.trim() || "";
    if (!/^[6-9][0-9]{9}$/.test(phone))
      throw new Error("Enter a valid 10-digit Indian mobile number");
    const values = Object.fromEntries(new FormData(form));
    values.intent = "draft";
    values.analyticsConsentGranted = window.commera2AnalyticsConsent?.() ?? false;
    values.consentGranted = window.commera2TrackingConsent?.() ?? false;
    values.quantity = Number(values.quantity || 1);
    values.bundleId = values.bundleId ? Number(values.bundleId) : null;
    const existingSessionId = window.commera2CheckoutSessionId;
    const route = location.pathname.match(/^\/s\/([^/]+)\/([^/]+)/);
    if (!existingSessionId && !route)
      throw new Error("Could not prepare phone verification");
    const response = await nativeFetch(
      existingSessionId
        ? `/api/public/checkouts/${encodeURIComponent(existingSessionId)}`
        : `/api/public/${encodeURIComponent(decodeURIComponent(route[1]))}/${encodeURIComponent(decodeURIComponent(route[2]))}/checkouts`,
      {
        method: existingSessionId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          existingSessionId
            ? { ...values, storeId: window.commera2StoreId }
            : values,
        ),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not prepare phone verification");
    earlyCheckout = { id: result.id, storeId: result.storeId, phone };
    verification = {
      checkoutSessionId: result.id,
      phone,
    };
    return result;
  }

  verifyButton.addEventListener("click", async () => {
    const otp = input.value.trim();
    if (!/^\d{4,6}$/.test(otp)) {
      showMessage("Enter the OTP sent to your mobile number.", "error");
      input.focus();
      return;
    }
    verifyButton.disabled = true;
    showMessage("Verifying…");
    try {
      await request("/api/public/otp/verify", {
        storeId: window.commera2StoreId,
        checkoutSessionId: verification.checkoutSessionId,
        phone: verification.phone,
        otp,
        visitorSessionId: window.commera2VisitorSessionId || "",
        analyticsConsentGranted: window.commera2AnalyticsConsent?.() ?? false,
        consentGranted: window.commera2TrackingConsent
          ? window.commera2TrackingConsent()
          : true,
      });
      if (pendingOrder) {
        showMessage("Mobile number verified. Confirming your order…", "success");
        if (orderStatus) orderStatus.textContent = "Mobile verified. Confirming order…";
        await completePendingOrder();
      } else {
        showMessage("Mobile number verified. Complete your details to place the order.", "success");
        destination.textContent = "Phone verified ✓";
        verifyButton.disabled = true;
        input.disabled = true;
        earlyButton.textContent = "Verified ✓";
        earlyButton.disabled = true;
      }
    } catch (error) {
      showMessage(error.message, "error");
      verifyButton.disabled = false;
      input.select();
    }
  });

  resendButton.addEventListener("click", sendOtp);
  earlyButton.addEventListener("click", async () => {
    earlyButton.disabled = true;
    try {
      await createEarlyCheckout();
      panel.hidden = false;
      verifyButton.textContent = "Verify OTP";
      await sendOtp();
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      panel.hidden = false;
      showMessage(error.message, "error");
      earlyButton.disabled = false;
    }
  });
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
  });
  phoneField?.addEventListener("input", () => {
    if (verification && phoneField.value.trim() !== verification.phone) {
      verification = null;
      pendingOrder = null;
      earlyCheckout = null;
      panel.hidden = true;
      input.value = "";
      input.disabled = false;
      verifyButton.disabled = false;
      earlyButton.disabled = false;
      earlyButton.textContent = "Send OTP";
      clearInterval(timer);
    }
  });

  window.fetch = async (resource, init = {}) => {
    let url = String(resource instanceof Request ? resource.url : resource);
    let nextInit = init;
    if (
      earlyCheckout &&
      (init.method || "GET").toUpperCase() === "POST" &&
      /\/api\/public\/[^/]+\/[^/]+\/checkouts(?:\?|$)/.test(url)
    ) {
      url = `/api/public/checkouts/${encodeURIComponent(earlyCheckout.id)}`;
      let values = {};
      try {
        values = JSON.parse(init.body || "{}");
      } catch {}
      nextInit = {
        ...init,
        method: "PATCH",
        body: JSON.stringify({ ...values, storeId: earlyCheckout.storeId }),
      };
    }
    const response = await nativeFetch(url, nextInit);
    if (
      response.status === 409 &&
      /\/api\/public\/checkouts\/[^/]+\/order(?:\?|$)/.test(url)
    ) {
      const result = await response.clone().json().catch(() => ({}));
      if (result.otpRequired) {
        pendingOrder = { url, init: nextInit };
        verification = result;
        panel.hidden = false;
        panel.scrollIntoView({ behavior: "smooth", block: "center" });
        if (orderStatus) orderStatus.textContent = "Verify your mobile number to confirm this COD order.";
        await sendOtp();
      }
    }
    return response;
  };

  nativeFetch(`/api/public/stores/${window.commera2StoreId}/otp-config`)
    .then((response) => response.json())
    .then((config) => {
      otpConfig = config;
      if (config.enabled && config.verificationPosition === "before_checkout") {
        earlyButton.hidden = false;
        input.maxLength = Number(config.length || 6);
      }
    })
    .catch(() => {});
})();
