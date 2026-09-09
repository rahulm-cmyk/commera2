import { request as httpsRequest } from "node:https";

function probeHttps(hostname, { request = httpsRequest, timeoutMs = 8_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      resolve(reachable);
    };
    const req = request(
      {
        hostname,
        path: "/",
        method: "HEAD",
        timeout: timeoutMs,
        headers: { "user-agent": "Commera2-domain-check/1.0" },
      },
      (res) => {
        res.resume();
        finish(true);
      },
    );
    req.once("error", () => finish(false));
    req.once("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.end();
  });
}

// Render owns certificate issuance. This adapter only promotes a domain after
// its public HTTPS endpoint responds, so it never treats DNS alone as live.
export function createHttpsDomainProvider({ probe = probeHttps } = {}) {
  return {
    async provisionDomain({ domain }) {
      return (await probe(domain.domainName))
        ? { status: "active" }
        : { status: "pending" };
    },
  };
}
