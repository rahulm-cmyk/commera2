import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import * as dns from "node:dns/promises";

const row = (value) =>
  value
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
          item,
        ]),
      )
    : null;
const clean = (value) => String(value ?? "").trim();
const trimDot = (value) => clean(value).toLowerCase().replace(/\.$/, "");
const legacyStatus = (value) =>
  ({
    PENDING_CONFIGURATION: "pending_verification",
    PENDING_VERIFICATION: "pending_verification",
    PENDING_SSL: "ssl_pending",
    ACTIVE: "active",
    ERROR: "error",
    DISCONNECTED: "disconnected",
  })[value] || "pending_verification";

export function normalizeDomain(value) {
  const raw = clean(value);
  if (!raw) throw new Error("Domain cannot be blank");
  if (raw.includes("*") || raw.startsWith("."))
    throw new Error("Wildcard domains are not supported");
  let candidate = raw;
  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("Enter a valid domain name without a path");
    }
    if (
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.port ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Enter only the domain name without a path, query, or port");
    candidate = parsed.hostname;
  } else if (/[/?#]/.test(raw) || raw.includes(":")) {
    throw new Error("Enter only the domain name without a path, query, or port");
  }
  candidate = domainToASCII(candidate.toLowerCase()).replace(/\.$/, "");
  if (isIP(candidate)) throw new Error("IP addresses cannot be connected as domains");
  const labels = candidate.split(".");
  if (
    candidate.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  )
    throw new Error("Enter a valid domain name without a path");
  return candidate;
}

function lookupResult(promise) {
  return promise
    .then((values) => ({ values, failed: false }))
    .catch((error) => {
      if (["ENODATA", "ENOTFOUND", "ENOENT"].includes(error?.code))
        return { values: [], failed: false };
      return { values: [], failed: true };
    });
}

export class DomainService {
  constructor(
    db,
    {
      dnsResolver = dns,
      sslProvider = null,
      cnameTarget = "",
      apexTarget = "",
      platformDomain = "shops.commera2.app",
      provider = "manual",
    } = {},
  ) {
    this.db = db;
    this.dnsResolver = dnsResolver;
    this.sslProvider = sslProvider;
    this.cnameTarget = clean(cnameTarget) ? normalizeDomain(cnameTarget) : "";
    this.apexTarget = clean(apexTarget);
    this.platformDomain = normalizeDomain(platformDomain);
    this.provider = clean(provider) || "manual";
  }

  defaultDomain(storeOrId) {
    const store =
      typeof storeOrId === "object" ? storeOrId : this.#store(storeOrId);
    return `/s/${encodeURIComponent(store.slug)}`;
  }

  requireHosting() {
    if (!this.cnameTarget)
      throw new Error("Platform hosting is not configured. Contact the platform administrator before connecting a domain.");
  }

  overview(storeId) {
    const store = this.#store(storeId),
      domains = this.listDomains(storeId),
      hostname = this.defaultDomain(store);
    return {
      hostingConfigured: Boolean(this.cnameTarget),
      defaultDomain: {
        hostname: null,
        path: hostname,
        type: "store_path",
        role: "store_link",
        status: "available_path",
        openUrl: hostname,
      },
      customDomains: domains,
    };
  }

  addDomain(storeId, input, actor = "merchant") {
    this.#store(storeId);
    this.requireHosting();
    const name = normalizeDomain(input.domainName);
    if (
      name === this.platformDomain ||
      name.endsWith(`.${this.platformDomain}`) ||
      name === this.cnameTarget ||
      name.endsWith(".localhost") ||
      name.endsWith(".local")
    )
      throw new Error("This hostname is reserved by the platform");
    const claimed = this.db
      .prepare(
        "SELECT id,store_id,overall_status FROM custom_domains WHERE normalized_hostname=? OR domain_name=?",
      )
      .get(name, name);
    if (claimed && claimed.overall_status !== "DISCONNECTED")
      throw new Error("This domain is already connected to another store.");
    const token = randomUUID(),
      txtName = `_commera2.${name}`,
      txtValue = `commera2-domain-verification=${token}`;
    let id;
    if (claimed) {
      this.db
        .prepare(
          `UPDATE custom_domains SET store_id=?,domain_name=?,normalized_hostname=?,domain_type='custom',primary_domain=0,
           status='pending_verification',verification_token=?,cname_target=?,txt_name=?,txt_value=?,
           ownership_status='pending',ownership_verification_method='dns_txt',dns_status='not_configured',
           ssl_status='not_started',routing_status='pending',overall_status='PENDING_CONFIGURATION',provider=?,
           provider_hostname_id='',detected_cname='',detected_txt='',error_code='',error_message='',last_error='',
           dns_checked_at=NULL,last_checked_at=NULL,verified_at=NULL,ownership_verified_at=NULL,ssl_activated_at=NULL,
           activated_at=NULL,disconnected_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        )
        .run(
          storeId,
          name,
          name,
          token,
          this.cnameTarget,
          txtName,
          txtValue,
          this.provider,
          claimed.id,
        );
      id = Number(claimed.id);
    } else {
      const result = this.db
        .prepare(
          `INSERT INTO custom_domains
           (store_id,domain_name,normalized_hostname,domain_type,verification_token,cname_target,txt_name,txt_value,
            ownership_status,dns_status,ssl_status,routing_status,overall_status,provider,status)
           VALUES (?,?,?,'custom',?,?,?,?,?,'not_configured','not_started','pending','PENDING_CONFIGURATION',?,'pending_verification')`,
        )
        .run(
          storeId,
          name,
          name,
          token,
          this.cnameTarget,
          txtName,
          txtValue,
          "pending",
          this.provider,
        );
      id = Number(result.lastInsertRowid);
    }
    this.#audit(storeId, id, "DOMAIN_ADDED", actor, { hostname: name });
    return this.getDomain(storeId, id);
  }

  #output(value) {
    const item = row(value);
    if (!item) return null;
    const overallStatus =
        item.overallStatus ||
        ({ active: "ACTIVE", ssl_pending: "PENDING_SSL", error: "ERROR" })[
          item.status
        ] ||
        "PENDING_CONFIGURATION",
      dnsState = item.dnsStatus || "not_configured",
      dnsStatus =
        dnsState === "not_configured"
          ? "pending"
          : dnsState === "waiting"
            ? "error"
            : dnsState,
      sslStatus = item.sslStatus || "not_started",
      hostnameKind = item.domainName.split(".").length === 2 ? "apex" : "subdomain",
      routeRecord =
        hostnameKind === "apex" && this.apexTarget
          ? {
              type: "A",
              host: "@",
              requiredValue: this.apexTarget,
              detectedValue: item.detectedCname || "",
            }
          : {
              type: "CNAME",
              host: hostnameKind === "apex" ? "@" : item.domainName,
              requiredValue: this.cnameTarget,
              detectedValue: item.detectedCname || "",
            },
      routeCorrect =
        trimDot(routeRecord.detectedValue) === trimDot(routeRecord.requiredValue);
    return {
      ...item,
      primaryDomain: Boolean(item.primaryDomain),
      overallStatus,
      status: legacyStatus(overallStatus),
      dnsStatus,
      dnsState,
      sslStatus,
      ownershipStatus: item.ownershipStatus || "pending",
      routingStatus: item.routingStatus || "pending",
      lastChecked: item.lastCheckedAt || item.dnsCheckedAt || null,
      role: item.primaryDomain ? "primary" : "redirect",
      type: "custom",
      hostnameKind,
      openUrl: `https://${item.domainName}`,
      hostingConfigured: Boolean(this.cnameTarget),
      dnsRecords: this.cnameTarget ? [
        {
          ...routeRecord,
          currentStatus: routeCorrect
            ? "correct"
            : routeRecord.detectedValue
              ? "incorrect"
              : "pending",
        },
        {
          type: "TXT",
          host: item.txtName,
          requiredValue: item.txtValue,
          detectedValue: item.detectedTxt || "",
          currentStatus:
            item.ownershipStatus === "verified"
              ? "correct"
              : item.detectedTxt
                ? "incorrect"
                : "pending",
        },
      ] : [],
    };
  }

  getDomain(storeId, id) {
    const value = this.#output(
      this.db
        .prepare(
          "SELECT * FROM custom_domains WHERE store_id=? AND id=? AND overall_status<>'DISCONNECTED'",
        )
        .get(storeId, id),
    );
    if (!value) throw new Error("Domain not found");
    return value;
  }

  listDomains(storeId) {
    this.#store(storeId);
    return this.db
      .prepare(
        "SELECT * FROM custom_domains WHERE store_id=? AND overall_status<>'DISCONNECTED' ORDER BY primary_domain DESC,id DESC",
      )
      .all(storeId)
      .map((value) => this.#output(value));
  }

  getDomainInstructions(storeId, id) {
    this.requireHosting();
    const domain = this.getDomain(storeId, id);
    return {
      domainId: domain.id,
      hostname: domain.domainName,
      hostnameKind: domain.hostnameKind,
      records: domain.dnsRecords,
    };
  }

  async checkDns(storeId, id, actor = "merchant") {
    this.requireHosting();
    const domain = this.getDomain(storeId, id),
      routeLookup =
        domain.dnsRecords[0].type === "A"
          ? lookupResult(this.dnsResolver.resolve4(domain.domainName))
          : lookupResult(this.dnsResolver.resolveCname(domain.domainName)),
      txtLookup = lookupResult(this.dnsResolver.resolveTxt(domain.txtName)),
      [routeResult, txtResult] = await Promise.all([routeLookup, txtLookup]);
    if (routeResult.failed || txtResult.failed) {
      this.db
        .prepare(
          `UPDATE custom_domains SET last_checked_at=CURRENT_TIMESTAMP,dns_checked_at=CURRENT_TIMESTAMP,
           error_code='LOOKUP_FAILED',error_message='We could not check the domain right now. Please try again.',
           last_error='We could not check the domain right now. Please try again.',updated_at=CURRENT_TIMESTAMP
           WHERE store_id=? AND id=?`,
        )
        .run(storeId, id);
      this.#audit(storeId, id, "VERIFICATION_FAILED", actor, {
        code: "LOOKUP_FAILED",
      });
      throw new Error("We could not check the domain right now. Please try again.");
    }
    const routeValues = routeResult.values.map(trimDot),
      txtValues = txtResult.values.flat().map(clean),
      routeRequired = domain.dnsRecords[0].requiredValue,
      routeReady = routeValues.includes(trimDot(routeRequired)),
      ownershipReady = txtValues.includes(domain.txtValue),
      dnsReady = routeReady && ownershipReady,
      dnsStatus = dnsReady
        ? "verified"
        : routeReady || ownershipReady
          ? "partially_configured"
          : routeValues.length || txtValues.length
            ? "error"
            : "waiting",
      overallStatus = dnsReady
        ? "PENDING_VERIFICATION"
        : "PENDING_CONFIGURATION",
      errorCode = dnsReady
        ? ""
        : routeValues.length && !routeReady
          ? "INCORRECT_DNS_VALUE"
          : "DNS_RECORD_MISSING",
      errorMessage = dnsReady
        ? ""
        : errorCode === "INCORRECT_DNS_VALUE"
          ? "The DNS record points to a different destination."
          : routeReady
            ? "Ownership TXT record was not found. Add the TXT record at your DNS provider, then check again."
            : ownershipReady
              ? "CNAME record was not found. Point the domain to the required CNAME value, then check again."
              : "CNAME and ownership TXT records were not found. Your DNS provider must support both records.";
    this.db
      .prepare(
        `UPDATE custom_domains SET dns_status=?,ownership_status=?,routing_status=?,overall_status=?,status=?,
         detected_cname=?,detected_txt=?,dns_checked_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,
         error_code=?,error_message=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
      )
      .run(
        dnsStatus,
        ownershipReady ? "verified" : txtValues.length ? "failed" : "pending",
        routeReady ? "verified" : "pending",
        overallStatus,
        legacyStatus(overallStatus),
        routeValues.join(", "),
        txtValues.join(", "),
        errorCode,
        errorMessage,
        errorMessage,
        storeId,
        id,
      );
    if (ownershipReady)
      this.db
        .prepare(
          "UPDATE custom_domains SET ownership_verified_at=COALESCE(ownership_verified_at,CURRENT_TIMESTAMP),verified_at=COALESCE(verified_at,CURRENT_TIMESTAMP) WHERE store_id=? AND id=?",
        )
        .run(storeId, id);
    this.#audit(
      storeId,
      id,
      dnsReady ? "DNS_VERIFIED" : "VERIFICATION_FAILED",
      actor,
      dnsReady ? { route: routeRequired } : { code: errorCode },
    );
    return {
      ...this.getDomain(storeId, id),
      dnsReady,
      cnameReady: routeReady,
      routingReady: routeReady,
      txtReady: ownershipReady,
      ownershipReady,
    };
  }

  async verifyDomain(storeId, id, actor = "merchant") {
    this.requireHosting();
    const checked = await this.checkDns(storeId, id, actor);
    if (!checked.dnsReady)
      throw new Error(
        checked.errorMessage || checked.lastError || "DNS verification failed",
      );
    this.db
      .prepare(
        `UPDATE custom_domains SET ownership_status='verified',dns_status='verified',routing_status='verified',
         overall_status='PENDING_SSL',status='ssl_pending',ssl_status='pending',error_code='',error_message='',last_error='',
         ownership_verified_at=COALESCE(ownership_verified_at,CURRENT_TIMESTAMP),verified_at=COALESCE(verified_at,CURRENT_TIMESTAMP),
         updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
      )
      .run(storeId, id);
    this.#audit(storeId, id, "OWNERSHIP_VERIFIED", actor);
    let current = this.getDomain(storeId, id);
    if (!this.sslProvider?.provisionDomain) return current;
    try {
      const provisioned = await this.sslProvider.provisionDomain({
        domain: current,
        store: this.#store(storeId),
      });
      if (provisioned?.status === "active") {
        this.db
          .prepare(
            `UPDATE custom_domains SET overall_status='ACTIVE',status='active',ssl_status='active',routing_status='active',
             provider_hostname_id=?,ssl_activated_at=CURRENT_TIMESTAMP,activated_at=CURRENT_TIMESTAMP,error_code='',
             error_message='',last_error='',updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
          )
          .run(clean(provisioned.hostnameId), storeId, id);
        this.#audit(storeId, id, "SSL_ACTIVATED", actor);
      } else if (provisioned?.status === "error") {
        const message =
          clean(provisioned.error) ||
          "We could not issue a security certificate for this domain.";
        this.db
          .prepare(
            `UPDATE custom_domains SET overall_status='ERROR',status='error',ssl_status='error',error_code='SSL_ERROR',
             error_message=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
          )
          .run(message, message, storeId, id);
        this.#audit(storeId, id, "VERIFICATION_FAILED", actor, {
          code: "SSL_ERROR",
        });
      }
    } catch {
      const message =
        "We could not issue a security certificate for this domain. Review the DNS configuration and try again.";
      this.db
        .prepare(
          `UPDATE custom_domains SET overall_status='ERROR',status='error',ssl_status='error',error_code='SSL_ERROR',
           error_message=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
        )
        .run(message, message, storeId, id);
      this.#audit(storeId, id, "VERIFICATION_FAILED", actor, {
        code: "SSL_ERROR",
      });
    }
    current = this.getDomain(storeId, id);
    return current;
  }

  checkDomain(storeId, id, actor = "merchant") {
    return this.verifyDomain(storeId, id, actor);
  }

  async syncDomainStatus(storeId, id, actor = "system") {
    this.requireHosting();
    const domain = this.getDomain(storeId, id);
    if (domain.overallStatus !== "ACTIVE")
      return this.verifyDomain(storeId, id, actor);
    if (!this.sslProvider?.getDomainStatus) return domain;
    const state = await this.sslProvider.getDomainStatus({
      domain,
      store: this.#store(storeId),
    });
    if (state?.status === "active") {
      this.db
        .prepare(
          "UPDATE custom_domains SET ssl_status='active',last_checked_at=CURRENT_TIMESTAMP,error_code='',error_message='',last_error='',updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(storeId, id);
    } else if (state?.status === "renewal_required") {
      this.db
        .prepare(
          `UPDATE custom_domains SET ssl_status='renewal_required',overall_status='ERROR',status='error',
           error_code='SSL_RENEWAL_REQUIRED',error_message='The security certificate requires renewal.',
           last_error='The security certificate requires renewal.',last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
           WHERE store_id=? AND id=?`,
        )
        .run(storeId, id);
      this.#audit(storeId, id, "VERIFICATION_FAILED", actor, {
        code: "SSL_RENEWAL_REQUIRED",
      });
    } else if (state?.status === "error") {
      this.db
        .prepare(
          `UPDATE custom_domains SET ssl_status='error',overall_status='ERROR',status='error',error_code='SSL_ERROR',
           error_message='We could not verify the security certificate.',last_error='We could not verify the security certificate.',
           last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
        )
        .run(storeId, id);
    }
    return this.getDomain(storeId, id);
  }

  async syncPendingDomains() {
    const statuses = this.sslProvider?.getDomainStatus
        ? "'PENDING_CONFIGURATION','PENDING_VERIFICATION','PENDING_SSL','ERROR','ACTIVE'"
        : "'PENDING_CONFIGURATION','PENDING_VERIFICATION','PENDING_SSL','ERROR'",
      pending = this.db
      .prepare(
        `SELECT store_id,id FROM custom_domains WHERE overall_status IN (${statuses}) ORDER BY COALESCE(last_checked_at,created_at) ASC`,
      )
      .all();
    const results = [];
    for (const item of pending) {
      try {
        results.push(await this.syncDomainStatus(item.store_id, item.id));
      } catch {}
    }
    return results;
  }

  setPrimary(storeId, id, actor = "merchant") {
    this.requireHosting();
    const domain = this.getDomain(storeId, id);
    if (domain.overallStatus !== "ACTIVE")
      throw new Error("Only an active HTTPS domain can be set as primary");
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "UPDATE custom_domains SET primary_domain=0,updated_at=CURRENT_TIMESTAMP WHERE store_id=?",
        )
        .run(storeId);
      this.db
        .prepare(
          "UPDATE custom_domains SET primary_domain=1,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
        )
        .run(storeId, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.#audit(storeId, id, "PRIMARY_DOMAIN_CHANGED", actor, {
      hostname: domain.domainName,
    });
    return this.getDomain(storeId, id);
  }

  disconnect(storeId, id, actor = "merchant") {
    const domain = this.getDomain(storeId, id);
    this.db
      .prepare(
        `UPDATE custom_domains SET primary_domain=0,overall_status='DISCONNECTED',status='disconnected',
         routing_status='disconnected',disconnected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?`,
      )
      .run(storeId, id);
    this.#audit(storeId, id, "DOMAIN_DISCONNECTED", actor, {
      hostname: domain.domainName,
    });
    return {
      disconnected: true,
      domainName: domain.domainName,
      fallbackDomain: this.defaultDomain(storeId),
    };
  }

  listAuditLog(storeId, domainId = null) {
    this.#store(storeId);
    const values = domainId
      ? this.db
          .prepare(
            "SELECT * FROM domain_audit_log WHERE store_id=? AND domain_id=? ORDER BY id DESC",
          )
          .all(storeId, domainId)
      : this.db
          .prepare(
            "SELECT * FROM domain_audit_log WHERE store_id=? ORDER BY id DESC",
          )
          .all(storeId);
    return values.map(row).map((item) => ({
      ...item,
      details: JSON.parse(item.detailsJson || "{}"),
      detailsJson: undefined,
    }));
  }

  resolveHost(host) {
    const name = this.#incomingHost(host);
    if (!name) return null;
    const custom = row(
      this.db
        .prepare(
          `SELECT cd.*,s.slug store_slug,s.name store_name,s.id resolved_store_id
           FROM custom_domains cd JOIN stores s ON s.id=cd.store_id
           WHERE cd.normalized_hostname=? AND cd.overall_status='ACTIVE' LIMIT 1`,
        )
        .get(name),
    );
    if (custom) {
      const primary = row(
        this.db
          .prepare(
            `SELECT domain_name FROM custom_domains
             WHERE store_id=? AND primary_domain=1 AND overall_status='ACTIVE' LIMIT 1`,
          )
          .get(custom.storeId),
      );
      return {
        type: "custom",
        hostname: name,
        storeId: Number(custom.storeId),
        storeSlug: custom.storeSlug,
        primary: Boolean(custom.primaryDomain),
        primaryHostname: primary?.domainName || name,
      };
    }
    if (name.endsWith(`.${this.platformDomain}`)) {
      const slug = name.slice(0, -1 * (this.platformDomain.length + 1));
      if (slug && !slug.includes(".")) {
        const store = row(
          this.db.prepare("SELECT id,slug FROM stores WHERE slug=?").get(slug),
        );
        if (store) {
          const primary = row(
            this.db
              .prepare(
                `SELECT domain_name FROM custom_domains
                 WHERE store_id=? AND primary_domain=1 AND overall_status='ACTIVE' LIMIT 1`,
              )
              .get(store.id),
          );
          return {
            type: "default",
            hostname: name,
            storeId: Number(store.id),
            storeSlug: store.slug,
            primary: !primary,
            primaryHostname: primary?.domainName || name,
          };
        }
      }
    }
    return null;
  }

  isDisconnectedHost(host) {
    const name = this.#incomingHost(host);
    if (!name) return false;
    const value = this.db
      .prepare(
        "SELECT overall_status FROM custom_domains WHERE normalized_hostname=? LIMIT 1",
      )
      .get(name);
    return Boolean(value && value.overall_status !== "ACTIVE");
  }

  storefrontForHost(host) {
    const resolved = this.resolveHost(host);
    if (!resolved) return null;
    const page = row(
      this.db
        .prepare(
          `SELECT slug page_slug FROM product_pages
           WHERE store_id=? AND status='published'
           ORDER BY COALESCE(published_at,created_at) DESC,id DESC LIMIT 1`,
        )
        .get(resolved.storeId),
    );
    return page ? { ...resolved, pageSlug: page.pageSlug } : resolved;
  }

  #incomingHost(host) {
    const raw = clean(host).toLowerCase();
    if (!raw || /[\s/@?#]/.test(raw) || raw.startsWith("[")) return null;
    const portIndex = raw.lastIndexOf(":"),
      candidate = portIndex > -1 ? raw.slice(0, portIndex) : raw;
    try {
      return normalizeDomain(candidate);
    } catch {
      return null;
    }
  }

  #audit(storeId, domainId, action, actor = "merchant", details = {}) {
    this.db
      .prepare(
        "INSERT INTO domain_audit_log (store_id,domain_id,actor,action,details_json) VALUES (?,?,?,?,?)",
      )
      .run(
        storeId,
        domainId,
        clean(actor) || "merchant",
        action,
        JSON.stringify(details),
      );
  }

  #store(id) {
    const value = row(this.db.prepare("SELECT * FROM stores WHERE id=?").get(id));
    if (!value) throw new Error("Store not found");
    return value;
  }
}
