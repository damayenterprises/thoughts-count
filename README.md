# Thoughts Count — concept site

An AI relationship companion that helps people show up for life's most important moments.
**Helping good intentions become meaningful actions.**

This is a working concept: a conversation-first intake that generates a complete,
personalized action plan (what to say, what to avoid, gestures that fit, how much to
spend, and how to keep showing up) — genuinely generated live by Claude.

## Security model (why it's safe to share)
The Anthropic API key lives ONLY in the server-side Netlify function
(`netlify/functions/generate.js`), read from the `ANTHROPIC_API_KEY` environment
variable. It is **never** sent to the browser and can't be recovered by anyone the
link is shared with. The browser only ever sends the user's answers and receives the
finished plan.

## Run it locally
1. `npm install -g netlify-cli` (once, if you don't have it)
2. Copy `.env.example` to `.env` and paste your Anthropic key
3. `netlify dev`  → opens at http://localhost:8888

## Deploy a shareable link
1. `netlify deploy --prod`
2. In the Netlify site settings → Environment variables, add `ANTHROPIC_API_KEY`
3. Share the `*.netlify.app` URL. To cut off access anytime, unpublish or password-
   protect the site in Netlify.

## Cost guard
`MAX_OUTPUT_TOKENS` in the function caps per-request cost. Model: `claude-sonnet-4-6`.
