# Contexto LIVE — play a word-guessing game with your TikTok chat

This is a complete, ready-to-deploy web app. Your audience guesses a secret
word by typing in TikTok LIVE chat; the app tells everyone how "close" each
guess is, just like the game Contexto. You control it all from your phone
during the stream.

You do not need to write or understand any code. Follow the steps below in
order. It will take about 20–30 minutes the first time.

---

## What you're about to do (big picture)

1. Get a free "signing key" from a service called EulerStream — TikTok's
   LIVE chat isn't public, so this key is what lets the app read it reliably.
2. Put this project's files on GitHub (just an upload, no coding).
3. Connect your GitHub to Render, which will run the app for you 24/7.
4. Open the web address Render gives you, on your phone, while you're live.

---

## Step 1 — Get your EulerStream signing key (required)

TikTok LIVE chat is not an official public feature — every tool that reads
it (including this one) relies on a "signing" service to work reliably.
Skipping this step is the #1 reason these tools stop working, so it's not
optional here.

1. Go to **https://www.eulerstream.com** and create a free account.
2. Once logged in, find your **API key** on your dashboard (it may be
   called "Sign API Key" or similar).
3. Copy it somewhere safe — you'll paste it into Render in Step 4.

---

## Step 2 — Put the project on GitHub

1. Go to **https://github.com** and log in.
2. Click the **+** icon (top right) → **New repository**.
3. Name it something like `tiktok-contexto-live`. Leave it **Public** or
   **Private**, either works. Do not check "Add a README" (we already
   have one). Click **Create repository**.
4. On the new repository's page, click **uploading an existing file**
   (a link in the middle of the page).
5. Drag the **entire contents** of the project folder you were given
   (all files and the `public` and `data` folders) into the upload box.
   - Make sure the folder structure stays intact: `server.js` at the top
     level, plus a `public` folder and a `data` folder inside it.
6. Scroll down and click **Commit changes**.

Your code is now on GitHub. You never need to touch it directly.

---

## Step 3 — Deploy it on Render

1. Go to **https://render.com** and log in (you can sign in with your
   GitHub account, which makes this easier).
2. Click **New +** → **Web Service**.
3. Choose **Build and deploy from a Git repository**, then select the
   `tiktok-contexto-live` repository you just created. If it's not
   listed, click "Configure account" and grant Render access to it.
4. Fill in the settings:
   - **Name**: anything you like, e.g. `contexto-live`
   - **Region**: pick the one closest to you
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: the free tier works for testing; consider a paid
     tier for a real broadcast so the app doesn't fall asleep between uses
5. Before clicking create, scroll to **Environment Variables** and add:
   - Key: `TIKTOK_SIGN_API_KEY`
   - Value: *(paste the EulerStream key from Step 1)*
6. Click **Create Web Service**.

Render will now build and start your app — you'll see logs scrolling by.
When it says your service is **Live**, you're done. Render shows you a web
address at the top of the page, like `https://contexto-live.onrender.com`
— that is your game's link.

---

## Step 4 — Play

1. Open your Render web address on your phone (bookmark it).
2. At the top is a small status bar — it will say **"Not connected"**.
   Tap it any time to see live diagnostics (see below).
3. In the box at the bottom, type your TikTok username (without the `@`)
   and tap **Connect**. Do this once you're already LIVE on TikTok.
4. Pick a difficulty (**Easy / Medium / Hard**) and tap **🎲 New live word**
   to start a round using a real word and your real chat, or tap
   **🧪 Test mode** to try the whole game instantly with fake chat
   messages — no TikTok connection needed, useful for rehearsing or
   checking things still work after any change.
5. As people type guesses in your TikTok chat, they appear on screen with
   a colored bar showing how close they are — the same green / orange /
   red scale the real Contexto game uses:
   - 🟩 **Dark green** — rank 1–50, extremely close
   - 🟢 **Green** — rank 51–300, close
   - 🟠 **Orange** — rank 301–1500, same general territory
   - 🔴 **Red** — rank 1500+ or not found, far off
   - 🥇 **Gold "EXACT"** — the winning word
6. Tap **💡 Hint** any time — it reveals a word about halfway between the
   closest guess so far and the answer, the same way the real game's
   hints work. Tap **🏳 Reveal** to end the round early and show everyone
   the answer.
7. Use the text box in the control bar to either:
   - **💬** post something as a visible "host comment" on screen (for
     announcements or answering questions), or
   - **▶** submit it as a real test guess, to check the game is scoring
     correctly.
8. Tap **📋 Copy recap** to copy a short summary of the round to your
   clipboard — handy for a caption or a follow-up post.
9. Tap **🔁 New round** to return to setup and start again.

---

## Understanding the status bar (no error codes to decode)

The bar at the top always tells you what's happening in plain language:

- **Not connected** — you haven't connected to TikTok yet.
- **Connecting to @name...** — trying to reach your live chat.
- **Retrying in Xs...** — the first attempt failed; it will try up to
  3 times automatically before giving up.
- **Connected to @name** — you're live and receiving chat.
- An error message — plain-English explanation of what to check
  (e.g. "make sure you're currently LIVE").

Tap the bar to expand it and see:
- **Raw events received** — a number that goes up every time *any*
  message arrives from TikTok, whether or not it was understood. If this
  number is stuck at 0, chat isn't reaching the app at all (check you're
  live, and that the username is correct). If it's going up but no
  guesses appear, messages are arriving but something about their shape
  is different than expected — take a screenshot of the "raw message
  samples" box and send it back for a fix.
- **Last received** — the most recent chat message the app actually saw.

---

## Notes on how the game works

- Live rounds pull a target word and its list of related words from a
  free word-similarity service (Datamuse), blending two signals —
  "means like" for core meaning and "triggers" for words strongly
  associated by everyday usage — the same way a real semantic model
  covers more of a word's neighborhood than a single lookup would.
  This needs the server to have internet access, which Render provides
  automatically. If that service is briefly unreachable, the app
  automatically falls back to one of its built-in backup words so the
  round still starts.
- Trivial inflections of the target (like "coffees" for "coffee") are
  filtered out of the ranking so they don't hand out a cheap near-exact
  slot right next to the real answer.
- Test mode uses a small built-in word list instead, so it works even
  with no internet and no TikTok connection at all.
- **Scoring**: each guess earns points based on how close its rank is
  (closer = more points, exactly like the real Contexto). To stop
  someone from farming points by pasting the same good word over and
  over, a player only earns points the *first* time they find a given
  word in a given round — repeating it still shows up in the feed
  (tagged "already guessed"), but won't inflate their score. Winning
  also adds a small speed bonus for finishing in fewer guesses.
- **Share recap**: after a round ends, "Copy recap" produces a
  Wordle-style colored-square summary (🟩 close, 🟧 same territory,
  🟥 far) plus the word, guess count, and hints used — ready to paste
  as a caption or comment.
- **Round history** keeps a running log of the last several rounds
  (word, winner, guess count, players) so you and your audience can see
  progress across a stream.
- **Viewer count** appears next to the connection status once TikTok
  starts sending it — not every stream reports it right away.
- Scores and history reset if the app restarts (for example, after a
  Render redeploy). This is intentional to keep the app simple and
  fast — nothing is stored in an external database.
- If TikTok changes something and the connection library falls behind,
  the diagnostics drawer described above is exactly what will show you
  what changed, without needing to read any code.

---

## Trying changes safely

Because Test Mode never touches TikTok, you (or anyone helping you) can
always verify the game logic still works after any future change simply
by opening the app and tapping **🧪 Test mode** — no need to go live to
check.
