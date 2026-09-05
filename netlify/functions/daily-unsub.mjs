// Thoughts Count — TC-174 Surface 2: one-tap unsubscribe from the daily thought.
//
// Linked from every daily-thought email. Flips the subscriber's record to inactive by matching the
// stable token stored on it, then shows a small, warm confirmation page. Fail-soft: an unknown or
// missing token still shows a gentle page rather than an error (never confirm-or-deny an address).
//
// Token lookup scans the (small, early-stage) subscriber store. If the list grows large this can be
// swapped for a token->hash index without changing the email link.

import { getStore } from "@netlify/blobs";
import { SUBSCRIBER_STORE } from "./subscribe-daily.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  let done = false;

  if (token) {
    try {
      const store = getStore(SUBSCRIBER_STORE);
      let cursor;
      outer:
      do {
        const page = await store.list({ cursor });
        cursor = page.cursor;
        for (const b of page.blobs || []) {
          const rec = await store.get(b.key, { type: "json" });
          if (rec && rec.token && rec.token === token) {
            if (rec.active !== false) {
              await store.setJSON(b.key, { ...rec, active: false, unsubscribedAt: new Date().toISOString() });
            }
            done = true;
            break outer;
          }
        }
      } while (cursor);
    } catch (e) {
      console.error("daily-unsub error", e);
    }
  }

  return page();
};

// A single calm page either way, so we never confirm or deny that an address is on the list.
function page() {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribed | Thoughts Count</title>
<meta name="robots" content="noindex" />
<style>
  body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f7f3ec;color:#2c2a26;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:460px;background:#fdfbf7;border:1px solid #e7ded0;border-radius:20px;padding:34px 32px;text-align:center;box-shadow:0 14px 40px rgba(64,52,34,.06)}
  .mark{font-family:Georgia,serif;font-size:20px;font-weight:600;color:#118ab9;margin-bottom:16px}
  h1{font-size:22px;margin:0 0 10px}
  p{color:#5a554c;line-height:1.6;margin:0 0 8px}
  a{display:inline-block;margin-top:18px;color:#118ab9;font-weight:600;text-decoration:none}
</style></head>
<body>
  <div class="card">
    <div class="mark">&#10084; Thoughts Count</div>
    <h1>You're all set.</h1>
    <p>You won't get the daily thought anymore. No hard feelings, and thank you for letting me be part of your mornings for a while.</p>
    <p>You can always come back when you'd like one again.</p>
    <a href="https://thoughtscount.com/">Back to Thoughts Count</a>
  </div>
</body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
