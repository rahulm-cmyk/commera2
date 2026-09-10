const passwordFields = `<label class="field">New password <span aria-hidden="true">*</span><input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required></label><label class="field">Confirm new password <span aria-hidden="true">*</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="256" required></label><p class="helper-text">Use 10-256 characters with a letter and number.</p>`;

function bindForm(form, action, success) {
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]'), message = form.querySelector('[role="status"]'),
      values = Object.fromEntries(new FormData(form));
    message.textContent = "";
    message.removeAttribute("data-state");
    if (values.confirmPassword !== undefined && values.password !== values.confirmPassword) {
      message.textContent = "Passwords do not match";
      message.dataset.state = "error";
      form.elements.confirmPassword.focus();
      return;
    }
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      await action(values);
      if (message.isConnected) message.textContent = success;
    } catch (error) {
      message.textContent = error.message;
      message.dataset.state = "error";
    } finally {
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  };
}

function sessionDate(value) {
  const raw = String(value || "").replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : raw + "Z").toLocaleString();
}

export async function renderAccount({ root, api, esc, updateIdentity, updateCsrf, isActive, signOut }) {
  root.innerHTML = '<p role="status">Loading account...</p>';
  try {
    const account = await api("/api/account");
    if (!isActive()) return;
    const user = account.user;
    updateIdentity(user);
    const reload = () => renderAccount({ root, api, esc, updateIdentity, updateCsrf, isActive, signOut });
    root.innerHTML = `<div class="account-workspace">
      <section class="account-section"><div><h2>Your account</h2><p class="helper-text">Signed in with ${account.authMethod === "google" ? "Google" : "email and password"}.</p></div>
        <form id="account-profile" class="account-form"><label class="field">Name <span aria-hidden="true">*</span><input name="displayName" value="${esc(user.displayName)}" autocomplete="name" minlength="2" maxlength="100" required></label><label class="field">Email<input value="${esc(user.email)}" type="email" readonly></label><button type="submit" class="primary">Save name</button><p role="status"></p></form></section>
      <section class="account-section"><div><h2>Sign-in & security</h2><p class="helper-text">${user.googleConnected ? "Google is connected to this account." : "This account uses email and password."}</p></div><div>
        <dl class="account-facts"><div><dt>Google</dt><dd>${user.googleConnected ? "Connected" : "Not connected"}</dd></div><div><dt>Password</dt><dd>${user.hasPassword ? "Set" : "Not set"}</dd></div><div><dt>Recovery email</dt><dd>${account.recoveryEnabled ? esc(user.email) : "Email service setup required"}</dd></div></dl>
        ${user.googleConnected && !account.canSetPassword ? '<a class="google-auth-button" href="/api/auth/google?reauth=1&returnTo=%2Faccount">Confirm with Google to reset password</a>' : ""}
        ${!user.hasPassword && !account.canSetPassword ? '<p>Confirm your Google account to add a password.</p>' : `<form id="account-password" class="account-form"><h3>${user.hasPassword ? "Change password" : "Set a password"}</h3>${user.hasPassword && !account.canSetPassword ? '<label class="field">Current password <span aria-hidden="true">*</span><input name="currentPassword" type="password" autocomplete="current-password" required></label>' : '<p class="helper-text">Google identity confirmed. You can choose a new password.</p>'}${passwordFields}<p class="helper-text">Changing your password signs out all other sessions.</p><button type="submit" class="primary">${user.hasPassword ? "Change password" : "Set password"}</button><p role="status"></p></form>`}
      </div></section>
      <section class="account-section"><div><h2>Signed-in sessions</h2><p class="helper-text">${account.sessions.length} active ${account.sessions.length === 1 ? "session" : "sessions"}</p></div><div><ul class="account-sessions">${account.sessions.map((session) => `<li><div><strong>${session.current ? "This session" : "Other session"}</strong><span>${session.method === "google" ? "Google" : "Email & password"}</span><small>Signed in ${esc(sessionDate(session.createdAt))}</small></div>${session.current ? '<span class="status-badge is-active">Current</span>' : `<button class="secondary" type="button" data-revoke-session="${esc(session.id)}">Sign out</button>`}</li>`).join("")}</ul><button id="signout-others" type="button" class="secondary" ${account.sessions.length < 2 ? "disabled" : ""}>Sign out other sessions</button><p id="sessions-message" role="status"></p><button id="account-signout" type="button" class="secondary">Sign out of this account</button></div></section>
    </div>`;
    bindForm(root.querySelector("#account-profile"), async (values) => {
      const result = await api("/api/account/profile", { method: "PATCH", body: JSON.stringify(values) });
      updateIdentity(result.user);
    }, "Name saved");
    const passwordForm = root.querySelector("#account-password");
    if (passwordForm) bindForm(passwordForm, async (values) => {
      const result = await api("/api/account/password", { method: "POST", body: JSON.stringify(values) });
      updateCsrf(result.csrfToken);
      await reload();
      const message = root.querySelector("#account-password [role='status']");
      if (message) message.textContent = "Password saved. Other sessions have been signed out.";
    }, "Password saved");
    root.querySelector("#account-signout").onclick = signOut;
    const revoke = async (button, suffix) => {
      button.disabled = true;
      try { await api(`/api/account/sessions/${suffix}`, { method: "DELETE" }); await reload(); }
      catch (error) {
        root.querySelector("#sessions-message").textContent = error.message;
        button.disabled = false;
      }
    };
    root.querySelector("#signout-others").onclick = (event) => revoke(event.currentTarget, "others");
    root.querySelectorAll("[data-revoke-session]").forEach((button) => {
      button.onclick = () => revoke(button, button.dataset.revokeSession);
    });
  } catch (error) {
    if (!isActive()) return;
    root.innerHTML = `<p role="alert">${esc(error.message)}</p><button id="account-retry" class="secondary">Try again</button>`;
    root.querySelector("#account-retry").onclick = () => renderAccount({ root, api, esc, updateIdentity, updateCsrf, isActive, signOut });
  }
}

export async function renderRecovery({ root, api, esc, back, token = "", googleEnabled = false }) {
  root.innerHTML = '<section class="auth-card"><p role="status">Loading password recovery...</p></section>';
  let enabled = Boolean(token);
  if (!token) {
    try { enabled = (await api("/api/auth/recovery/status")).enabled; } catch { enabled = false; }
  }
  root.innerHTML = `<section class="auth-card"><h2>${token ? "Choose a new password" : "Reset your password"}</h2>${enabled ? `<form id="recovery-form" class="account-form">${token ? passwordFields : '<label class="field">Account email <span aria-hidden="true">*</span><input name="email" type="email" autocomplete="email" maxlength="254" required></label>'}<button class="primary" type="submit">${token ? "Save new password" : "Send reset link"}</button><p role="status"></p></form>` : `<p>Password recovery email is not configured yet. Contact the platform administrator${googleEnabled ? " or sign in with your linked Google account" : ""}.</p>${googleEnabled ? '<a class="google-auth-button" href="/api/auth/google?returnTo=%2Faccount">Continue with Google</a>' : ""}`}<button id="recovery-back" class="text-button" type="button">Back to sign in</button></section>`;
  root.querySelector("#recovery-back").onclick = back;
  const form = root.querySelector("#recovery-form");
  if (form) bindForm(form, async (values) => {
    const result = await api(token ? "/api/auth/reset-password" : "/api/auth/forgot-password", {
      method: "POST", body: JSON.stringify({ ...values, ...(token ? { token } : {}) }),
    });
    if (token) {
      root.innerHTML = '<section class="auth-card"><h2>Password updated</h2><p>Your previous sessions have been signed out.</p><button id="recovery-done" class="primary">Back to sign in</button></section>';
      root.querySelector("#recovery-done").onclick = back;
    } else {
      form.reset();
      form.querySelector('[role="status"]').textContent = result.message;
    }
  }, token ? "Password updated" : "If an account matches that email, a reset link will be sent. Check your inbox and spam folder.");
}
