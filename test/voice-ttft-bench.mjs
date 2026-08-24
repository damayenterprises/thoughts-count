// TC-140 — measure time-to-first-spoken-token (converse_ms proxy) for Sonnet vs Haiku on a
// converse-style streaming tool call. Run: node --env-file=.env test/voice-ttft-bench.mjs
const KEY = process.env.ANTHROPIC_API_KEY;
const SYSTEM = `You are Della, a warm, emotionally intelligent relationship companion. Speak briefly and naturally, like a caring friend. Ask one gentle question at a time. Never robotic. Keep replies to one or two sentences. Match the person's emotional register. You help people show up for the moments that matter. Every turn, call exactly one tool: reply (to say something), or ready (when you have enough). Never plain text.`.repeat(4); // ~persona-sized prefix

const TOOLS = [{ name: "reply", description: "Say something warm, optionally asking one question.", input_schema: { type: "object", properties: { say: { type: "string" } }, required: ["say"] } }];

async function ttft(model) {
  const t0 = Date.now();
  let firstToken = null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 600, stream: true,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS, tool_choice: { type: "tool", name: "reply" },
      messages: [{ role: "user", content: "My best friend just found out her dad has cancer. I don't know what to say to her." }],
    }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let total = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    if (firstToken === null && /input_json_delta|content_block_delta/.test(chunk)) firstToken = Date.now() - t0;
    total += chunk;
  }
  return { model, ttft_ms: firstToken, total_ms: Date.now() - t0 };
}

for (const model of ["claude-sonnet-4-6", "claude-haiku-4-5"]) {
  const runs = [];
  for (let i = 0; i < 3; i++) { try { runs.push(await ttft(model)); } catch (e) { console.log(model, "err", e.message); } }
  const ttfts = runs.map((r) => r.ttft_ms).filter((x) => x != null);
  const totals = runs.map((r) => r.total_ms);
  const avg = (a) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : "n/a";
  console.log(`${model}: TTFT avg ${avg(ttfts)}ms  (runs ${ttfts.join(",")}) | full-call avg ${avg(totals)}ms`);
}
