// Thoughts Count — TC-179: the /thoughts/ hub. Della's daily thoughts, made durable.
//
// The daily thought is otherwise ephemeral (one home-bar view + one email, then gone). This page turns
// the daily cadence into ONE growing, crawlable, shareable asset: today's thought featured up top, an
// accumulating archive below, cross-links into the guides, and a path into Della. Deliberately a single
// rich hub (not one thin page per day) so the daily cadence gives the domain freshness + internal-link
// value WITHOUT the thin-content footprint a young site can't afford (TC-176/TC-175 quality bar).
//
// Reads today's approved line from Marketing OS (same source as the home bar), captures it to the local
// archive, and renders from the archive. Fail-soft: MOS down or archive empty still returns a valid page.

import { recordThought, listRecentThoughts } from "./_thoughts.mjs";

const SITE = "https://thoughtscount.com";
const MOS_DAILY_THOUGHT = "https://damay-marketing-os.netlify.app/api/daily-thought?app=thoughts-count";
const TIMEOUT_MS = 5000;

const MARK = `<svg viewBox="0 0 250 250" aria-hidden="true"><path fill="#118ab9" d="M30.84,247.61c-1.22,0-2.42-.54-3.34-1.57-1.36-1.51-1.87-3.82-1.31-5.92l9.28-34.68C14.07,182.85,2.33,153.46,2.33,122.3,2.33,55.3,57.27.8,124.8.8s122.47,54.5,122.47,121.5-54.94,121.5-122.47,121.5c-19.29,0-38.44-4.55-55.53-13.17l-36.69,16.6c-.57.26-1.16.38-1.74.38ZM69.39,218.66c.68,0,1.35.17,1.99.5,16.31,8.59,34.78,13.13,53.42,13.13,62.16,0,112.73-49.34,112.73-110S186.96,12.3,124.8,12.3,12.07,61.65,12.07,122.3c0,28.9,11.42,56.2,32.16,76.89,1.5,1.5,2.09,3.92,1.5,6.13l-7.2,26.9,29.12-13.18c.56-.25,1.15-.38,1.74-.38Z"/><path fill="#ef4136" d="M148.18,75.95c-7.61,0-15.23,2.92-21.04,8.75l-2.35,2.36-2.35-2.36c-5.81-5.83-13.42-8.75-21.03-8.75-7.62,0-15.23,2.92-21.04,8.76l-.42.43c-11.62,11.67-11.62,30.59,0,42.27l2.35,2.36,5.15,5.18,37.34,37.52,42.5-42.7,2.35-2.36c11.61-11.67,11.61-30.6,0-42.27l-.43-.43c-5.81-5.83-13.42-8.75-21.04-8.75h0Z"/></svg>`;

// A few evergreen guides to seed the path from a browsing reader into the library (TC-179 cross-link).
const FEATURED_GUIDES = [
  ["/guides/sympathy/", "What to say when someone is going through something hard"],
  ["/guides/celebrations/", "What to write and say for life's happy milestones"],
  ["/guides/what-to-write-in-a-sympathy-card/", "What to write in a sympathy card"],
  ["/guides/what-to-write-in-a-thank-you-card/", "What to write in a thank-you card"],
];

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function fmtDay(d) {
  // d = "YYYY-MM-DD" -> "Month D, YYYY" without pulling in a locale-heavy path.
  const m = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const p = String(d || "").split("-");
  if (p.length !== 3) return "";
  const mi = parseInt(p[1], 10) - 1;
  if (mi < 0 || mi > 11) return "";
  return `${m[mi]} ${parseInt(p[2], 10)}, ${p[0]}`;
}

export default async () => {
  // 1) Today's approved line from MOS (same contract as daily-reflection). Capture it, fail-soft.
  let today = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(MOS_DAILY_THOUGHT, { signal: ctrl.signal });
      if (r.ok) {
        const d = await r.json();
        if (d && d.line && String(d.line).trim()) {
          today = { line: String(d.line).trim(), author: d.author || null, day: d.day || null };
          recordThought(today).catch(() => {});
        }
      }
    } finally { clearTimeout(t); }
  } catch { /* fail-soft */ }

  // 2) Archive (most recent first). Feature today's line; if MOS had none, feature the latest archived.
  const archive = await listRecentThoughts(60);
  const featured = today || (archive[0] || null);
  // The archive list shown below the featured one, without duplicating the featured day.
  const rest = archive.filter((a) => !featured || a.day !== featured.day).slice(0, 30);

  return new Response(renderPage({ featured, rest }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Short cache: the featured line can change on same-day approval, and the archive grows daily.
      "cache-control": "public, max-age=600",
    },
  });
};

function renderPage({ featured, rest }) {
  const url = SITE + "/thoughts/";
  const featuredHtml = featured ? `
      <p class="today-day">${esc(fmtDay(featured.day)) || "Today"}</p>
      <blockquote class="today-line">${esc(featured.line)}</blockquote>` : `
      <blockquote class="today-line">A small thought is on its way. Check back in the morning.</blockquote>`;

  const archiveHtml = rest.length ? `
    <h2>Recent thoughts</h2>
    <div class="archive">${rest.map((a) => `
      <div class="thought">
        <p class="t-day">${esc(fmtDay(a.day))}</p>
        <p class="t-line">${esc(a.line)}</p>
      </div>`).join("")}
    </div>` : "";

  const guidesHtml = FEATURED_GUIDES.map(([href, label]) => `
        <a class="rel" href="${href}">${esc(label)}</a>`).join("");

  // Structured data: a growing collection of the reflections, tied to the one site entity.
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": url + "#collection",
    name: "Della's daily thoughts",
    url,
    description: "A small reflection each day on showing up for the people who matter, from Thoughts Count.",
    isPartOf: { "@id": SITE + "/#website" },
    publisher: { "@id": SITE + "/#organization" },
    inLanguage: "en",
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Daily thoughts", item: url },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>A Daily Thought | Thoughts Count</title>
<meta name="description" content="A small reflection each day on showing up for the people you love, in Della's voice. Read today's thought and browse the ones before it." />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="A Daily Thought | Thoughts Count" />
<meta property="og:description" content="A small reflection each day on showing up for the people who matter." />
<meta property="og:url" content="${url}" />
<meta property="og:site_name" content="Thoughts Count" />
<meta property="og:image" content="${SITE}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${SITE}/og.png" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<script type="application/ld+json">${JSON.stringify(collectionLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>
<!-- Google Analytics (GA4) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-8WM0S308TV"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-8WM0S308TV');</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Fraunces:ital,opsz,wght@1,9..144,500&display=swap" rel="stylesheet" />
<style>
  :root{--paper:#f7f3ec;--cloud:#fdfbf7;--ink:#2c2a26;--soft:#5a554c;--blue:#118ab9;--blue-deep:#0a5876;--red:#ef4136;--line:#e7ded0}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);line-height:1.7;background:var(--paper)}
  #bg{position:fixed;inset:0;z-index:-2;background:radial-gradient(130% 100% at 20% 10%, #f4e6dc 0%, #dfe9ee 45%, #b9d2de 78%, #8fb9cc 100%)}
  a{color:var(--blue)}
  h1,h2{font-family:'Hanken Grotesk',system-ui,sans-serif;font-weight:700;letter-spacing:-.01em}
  .wrap{max-width:760px;margin:0 auto;padding:0 22px}
  .bar{padding:20px 0}
  .brand{font-size:15px;font-weight:700;color:var(--blue);text-decoration:none;display:inline-flex;gap:9px;align-items:center;text-transform:uppercase;letter-spacing:.18em}
  .brand svg{width:22px;height:22px}
  .crumbs{font-size:13px;color:var(--soft);margin:8px 0 0}
  .crumbs a{color:var(--soft)}
  .today{background:var(--cloud);border:1px solid var(--line);border-radius:22px;padding:34px 34px 30px;margin:14px 0 24px;box-shadow:0 14px 40px rgba(64,52,34,.06);text-align:center}
  .today-eyebrow{font-size:12.5px;font-weight:700;color:var(--blue-deep);text-transform:uppercase;letter-spacing:.14em;display:inline-flex;align-items:center;gap:8px}
  .today-eyebrow svg{width:20px;height:20px}
  .today-day{font-size:13px;color:var(--soft);margin:14px 0 6px}
  .today-line{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:clamp(22px,3.6vw,30px);line-height:1.4;color:var(--ink);margin:6px auto 0;max-width:24ch;border:0;quotes:'\\201C''\\201D'}
  .today-line::before{content:open-quote}.today-line::after{content:close-quote}
  .della-cta{margin:22px 0 30px;text-align:center}
  .della-cta p{font-size:16.5px;color:var(--soft);margin:0 auto 14px;max-width:40ch}
  .della-cta a.btn{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:14px 30px;border-radius:999px;font-weight:700;font-size:16px;box-shadow:0 10px 30px rgba(64,52,34,.14)}
  .della-cta .sub{display:block;font-size:13px;color:var(--soft);margin-top:10px}
  h2{font-size:20px;margin:30px 0 12px}
  .archive{margin:0 0 8px}
  .thought{border:1px solid var(--line);background:var(--cloud);border-radius:14px;padding:14px 16px;margin:10px 0}
  .t-day{font-size:12px;color:var(--soft);margin:0 0 5px;text-transform:uppercase;letter-spacing:.05em}
  .t-line{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:17px;line-height:1.5;margin:0;color:var(--ink)}
  .daily-optin{margin:26px 0 4px;padding:18px 20px;background:#eef6fa;border:1px solid var(--line);border-radius:16px}
  .do-prompt{margin:0 0 10px;font-size:15.5px;font-weight:600;color:var(--blue-deep)}
  .do-form{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch}
  .do-form input[type=email]{flex:1 1 220px;min-width:0;padding:11px 14px;border:1px solid var(--line);border-radius:11px;font:inherit;font-size:15px;background:var(--cloud);color:var(--ink)}
  .do-form input[type=email]:focus{outline:none;border-color:var(--blue)}
  .do-form button{flex:0 0 auto;background:var(--blue);color:#fff;border:0;padding:11px 20px;border-radius:11px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;white-space:nowrap}
  .do-form button:disabled{opacity:.6;cursor:default}
  .do-msg{margin:10px 0 0;font-size:13.5px;color:var(--soft)}
  .do-msg.bad{color:var(--red)}
  .related{margin:26px 0 0}
  .related h2{font-size:19px}
  .rel{display:block;background:var(--cloud);border:1px solid var(--line);border-radius:12px;padding:11px 15px;margin:7px 0;text-decoration:none;color:var(--blue);font-weight:600}
  footer{padding:24px 0 50px;color:var(--soft);font-size:13px;text-align:center}
</style>
</head>
<body>
<div id="bg" aria-hidden="true"></div>
<script>(function(){try{var s=localStorage.getItem('tc_sid');if(!s){s=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():('s'+Date.now()+Math.random().toString(36).slice(2));localStorage.setItem('tc_sid',s);}var t=false;try{t=localStorage.getItem('tc_test')==='1';}catch(e){}var ref='';try{ref=(document.referrer||'').split('/')[2]||'';}catch(e){}var p=JSON.stringify({event:'page_view',sid:s,test:t,page:'/thoughts/',ref:ref});if(navigator.sendBeacon)navigator.sendBeacon('/api/track',new Blob([p],{type:'application/json'}));else fetch('/api/track',{method:'POST',keepalive:true,headers:{'content-type':'application/json'},body:p});}catch(e){}})();</script>
<div class="wrap">
  <div class="bar"><a class="brand" href="/">${MARK}Thoughts Count</a>
  <div class="crumbs"><a href="/">Home</a> › Daily thoughts</div></div>

  <div class="today">
    <span class="today-eyebrow">${MARK}A thought from Della</span>
    ${featuredHtml}
  </div>

  <div class="della-cta">
    <p>Is there someone this brings to mind? Tell me about them and I'll help you find the words and the gesture that fit.</p>
    <a class="btn" href="/">Make a plan for someone</a>
    <span class="sub">Free. No account. About a minute.</span>
  </div>
${archiveHtml}
  <div class="daily-optin" id="thoughtsOptin">
    <p class="do-prompt">Want a small thought like this from me each morning?</p>
    <form class="do-form" id="thoughtsForm" novalidate>
      <input type="email" id="thoughtsEmail" placeholder="you@email.com" aria-label="Your email" autocomplete="email" />
      <button type="submit" id="thoughtsBtn">Yes, send them</button>
    </form>
    <p class="do-msg" id="thoughtsMsg" role="status" aria-live="polite"></p>
  </div>

  <div class="related">
    <h2>Guides for when it matters</h2>${guidesHtml}
  </div>

  <footer>Thoughts Count: helping good intentions become meaningful actions.</footer>
</div>
<script>
(function(){
  var form=document.getElementById('thoughtsForm');if(!form)return;
  var wrap=document.getElementById('thoughtsOptin');
  var input=document.getElementById('thoughtsEmail');
  var btn=document.getElementById('thoughtsBtn');
  var msg=document.getElementById('thoughtsMsg');
  try{if(localStorage.getItem('tc_daily_sub')==='1'){wrap.style.display='none';return;}}catch(e){}
  var RE=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var email=(input.value||'').trim();
    msg.className='do-msg';
    if(!RE.test(email)){msg.className='do-msg bad';msg.textContent='That email looks off. Mind checking it?';return;}
    var sid;try{sid=localStorage.getItem('tc_sid')||undefined;}catch(e){}
    btn.disabled=true;msg.textContent='One moment...';
    fetch('/api/subscribe-daily',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,source:'thoughts',sid:sid})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){
        if(!res.ok){btn.disabled=false;msg.className='do-msg bad';msg.textContent=(res.j&&res.j.error)||'That did not go through. Try again in a moment.';return;}
        try{localStorage.setItem('tc_daily_sub','1');}catch(e){}
        form.style.display='none';wrap.querySelector('.do-prompt').style.display='none';
        msg.className='do-msg';msg.textContent="Lovely. I'll send you a small thought each morning.";
      })
      .catch(function(){btn.disabled=false;msg.className='do-msg bad';msg.textContent='That did not go through. Try again in a moment.';});
  });
})();
</script>
</body>
</html>`;
}
