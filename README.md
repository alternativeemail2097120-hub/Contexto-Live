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
2. At the top is a small status bar — it will say **"Not connected yet"**.
   Tap it any time to see live diagnostics (see below).
3. Open **Settings** and pick a mode with the **Live / Test / Offline**
   switch:
   - **Live** — reads your real TikTok LIVE chat. Type your TikTok username
     (without the `@`) and tap **Connect** once you're already LIVE. Then
     choose a **Difficulty**, a **Word length** (Any / Short / Medium / Long)
     and, if you like, type your own **Secret word** (leave it empty for a
     random one).
   - **Test** — rehearse with fake viewers, no TikTok needed. Pick a secret
     word (or Random), switch **Simulated chat** on or off, and choose its
     **Speed**.
   - **Offline** — no TikTok and no internet. You type each guess yourself,
     with the player's name, in the box at the bottom. Pick a secret word
     (or Random).
   Your choices are remembered on this phone for next time.
4. Tap **Start round**. Settings fold away so the game has the whole screen;
   tap **Settings** any time to open them again.
5. Guesses appear in **Live guesses**, and the list keeps itself sorted:
   the closest word is always on top, and rows slide into place as new
   guesses come in. The single **Latest** line above it always shows the
   most recent guess, even if it's a repeat or not a real word. Each row
   has a colored bar and a rank number — the same green / orange / red
   scale the real Contexto game uses:
   - 🟩 **Dark green** — rank 2–50, extremely close
   - 🟢 **Green** — rank 51–300, close
   - 🟠 **Orange** — rank 301–1500, same general territory
   - 🔴 **Red** — rank 1500+ or not found, far off
   - 🥇 **Gold "EXACT"** — the winning word
6. **Enter a word** at the bottom lets you submit a guess yourself. In Live
   and Test rounds it shows up as a "HOST" test guess and never scores. In
   Offline rounds it's how you enter everyone's guesses, so it also asks
   for the player's name and those guesses do score. Tap the bar to fold it
   away when you don't need it.
7. Tap **End round** (twice, so you can't hit it by accident) to stop early
   and show everyone the answer. When a round is over the same button
   turns into **New round** — one tap starts another round with your
   current settings.

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
  round still starts. (If you typed your own secret word and it can't be
  ranked, you'll get a message instead of a surprise word.)
- Trivial inflections of the target (like "coffees" for "coffee") are
  filtered out of the ranking so they don't hand out a cheap near-exact
  slot right next to the real answer.
- **Every real word gets ranked.** If a guess is a genuine English word
  but has nothing to do with the target, it still gets a real rank
  number (it just lands in the red "far off" zone) instead of being
  brushed aside — only text that isn't a recognized word at all (typos,
  gibberish) is left unranked and tagged "not a word." Those show in the
  **Latest** line but not in the sorted list.
- **One row per word.** If several people guess the same word it appears
  once in Live guesses, next to whoever found it first.
- **The secret word is never shown up front.** With **Word length** on
  "Any", its length is randomized every round from 4 to 15 letters, and
  there are no letter boxes revealing how long it is.
- Test and Offline rounds use a small built-in word list instead, so they
  work with no internet at all.
- **Points are small on purpose.** You earn points only when you are the
  first person to find a word in a round, so repeating a word someone
  already found earns nothing (it shows a small "↺" tag with their name).
  The most a single guess can ever pay is 10:

  | Rank of the word | Points |
  |---|---|
  | 1 — the secret word | 10 |
  | 2 | 8 |
  | 3–5 | 7 |
  | 6–10 | 6 |
  | 11–25 | 5 |
  | 26–50 | 4 |
  | 51–150 | 3 |
  | 151–300 | 2 |
  | 301–1500 | 1 |
  | 1501+ or not a word | 0 |

  Points appear as a small gold **+N** on each guess, and the winner's
  total is shown in the win banner. Totals are kept for the whole session
  (they reset if the app restarts). Host test guesses never score. To
  re-balance the game, edit the `POINTS_BY_RANK` table near the top of the
  game-logic section of `server.js`.
- **Viewer count** appears next to the connection status once TikTok
  starts sending it — not every stream reports it right away.
- Nothing is stored in an external database — restarting the app (for
  example, after a Render redeploy) clears scores. Your settings (username,
  difficulty, etc.) are saved in your phone's browser, not on the server.
- If TikTok changes something and the connection library falls behind,
  the diagnostics drawer described above is exactly what will show you
  what changed, without needing to read any code.

---

## Trying changes safely

Because Test Mode never touches TikTok, you (or anyone helping you) can
always verify the game logic still works after any future change simply
by opening the app and tapping **🧪 Test mode** — no need to go live to
check.
