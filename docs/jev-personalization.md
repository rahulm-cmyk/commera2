# Jev product page personalization

Open Product pages, edit a template-based page, then open Page Settings and
Jev personalization. Add approved Value, Benefits, or Confidence variations.
Each variation needs a headline; supporting text and button text are optional.
Enable Adapt product page text, save, and publish when ready. Suggest available
bundles only labels an existing eligible bundle; it never selects or reprices it.

The server needs TYPESAFE_AI_ENABLED=true, TYPESAFE_API_KEY, and optionally
TYPESAFE_MODEL (default jev-latest). Keys remain server-side.

After analytics consent, the browser summarizes active time, scroll depth,
review visibility, bundle changes, and a same-tab return visit. Jev receives
these coarse signals, product information, and approved variations. It receives
no visitor identifiers, customer form fields, addresses, or pointer recordings.

One decision is requested after 15 visible seconds. Copy is applied only when
the purchase panel is outside the viewport, no modal is open, and checkout has
not started. Consent withdrawal restores original text. The original page also
survives missing credentials, disabled analytics, stale configuration, provider
errors, timeouts, exhausted budgets, and unsupported imported HTML pages.

Decisions are cached for five minutes by page configuration and behavior cohort.
The server limits concurrent calls, uses a 2.3-second API timeout without retries,
and caps public decision requests at 30 per store per minute and 300 per server
instance per hour. These are per-process limits, not a distributed billing cap.

Approximately 10% of sessions keep original content. This release does not yet
persist exposure-to-order attribution, report conversion uplift, or learn a
winning variant automatically. It does not personalize imported HTML, post-order
upsells, downsells, or exit-offer selection. Existing offer and checkout rules
continue to govern those actions.

Verification: npm run check; scripts/qa-personalization.mjs uses Playwright
(set QA_PLAYWRIGHT_PATH when it is supplied by the desktop runtime). Browser QA
uses an isolated in-memory database and a deterministic test provider.
