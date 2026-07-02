# Friend in Christ — Shareable Bible Chat

A shareable web chat powered by your Grok (xAI) agent. Anyone with the link can chat —
no login, no Facebook needed. Your API key stays hidden on the server.

## Files
- `index.html` — the chat page people see
- `api/chat.js` — serverless function that calls the xAI API with your secret key

## Deploy on Vercel (about 5 minutes, free)

1. **Get an xAI API key**
   - Go to https://console.x.ai → API Keys → Create key. Copy it.
   - Make sure your account has credits (the "purchase credits" banner you saw).

2. **Put this folder on GitHub**
   - Create a new repository and upload these files, keeping the folder
     structure (`api/chat.js` must be inside an `api` folder).

3. **Deploy**
   - Go to https://vercel.com → Add New Project → import your repository.
   - Before clicking Deploy, open **Environment Variables** and add:
     - `XAI_API_KEY` = your key from step 1
     - (optional) `GROK_MODEL` = a model name, e.g. `grok-3` for better answers
       or `grok-3-mini` for the lowest cost (this is the default).
   - Click **Deploy**.

4. **Share the link**
   - You'll get a URL like `https://your-project.vercel.app`.
   - Send it to anyone — it works on any phone or computer immediately.
   - You can add a nicer custom domain later in Vercel settings if you want.

## Changing the agent's personality
Edit `SYSTEM_PROMPT` at the top of `api/chat.js`, commit, and Vercel redeploys
automatically.

## Costs and safety notes
- Every message anyone sends uses your xAI credits. The function includes a
  basic rate limit (12 messages per minute per visitor) and caps reply length,
  but if you share it widely, keep an eye on your usage at console.x.ai.
- You can set a hard spending limit in the xAI console so a busy day can't
  surprise you.
