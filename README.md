# Contexto LIVE — play a word-guessing game with your TikTok chat

> **What's new in this version**
> - **Test mode always finishes on its own** — simulated chat's chance of
>   landing on the secret word climbs every few seconds, so a Test round
>   guarantees a winner instead of possibly running a long time.
> - **The "+N points" popup no longer shoves the board around** — its
>   spot on screen is now reserved, so "Live guesses" stays put.
> - **Top scorers & the leaderboard show everyone** — no more 10-person
>   cutoff after a round, and the all-time leaderboard sends its full
>   list (still shows the top 20 at a glance, scroll for the rest).
> - **Save & Apply / Save & Apply as Default** — two new buttons at the
>   bottom of Settings. The first confirms your settings on this device;
>   the second makes them the ones **every** device starts with — open the
>   game anywhere and it's already set up the way you like it.
> - **A visible countdown to the next round** — now shown right on the
>   round button itself ("New round (5s)"), not just in the leaderboard
>   popup.
>
> See "Step 2" below for how to re-deploy these files.

This is a complete, ready-to-deploy web app. Your audience guesses a secret
word — always picked fresh at random, from a balanced pool of common-to-
moderately-challenging English words (never a stopword, never something
obscure) — by typing in TikTok LIVE chat; the app tells everyone how
"close" each guess is, just like the game Contexto. It's built to be run
from a single Android phone while you're live: a clean, icon-only control
bar up top, and settings tucked away in a slide-up panel so they never
clutter the screen.

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
5. Drag the **entire contents** of this project folder into the upload
   box — all files, plus the `public` and `data` folders.
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

1. Open your Render web address on your phone (bookmark it). Built for
   playing one-handed from a single Android phone while you're live —
   everything you need lives at the top of the screen, nothing is pinned
   to the bottom where your thumb (or your phone case) gets in the way.
2. At the top is a small status bar — it will say **"Not connected yet"**.
   Tap it any time to see live diagnostics (see below).
3. Right below the status bar is a compact **action bar** with five
   controls, so the screen stays clean and out of your way:
   - **⚙️ Settings icon** — opens a panel that slides up from the bottom
     where you pick a mode and its options, then slides away again. A
     small colored dot on the icon always shows which mode you're in
     (pink = Live, cyan = Test, gold = Offline) even with the panel closed.
   - **💡 Hint icon** — see "Hints" below. Greyed out until a round is running.
   - **⌨️ Enter-a-word icon** — opens a slide-up panel where you (the host)
     can type a guess yourself. Opening one panel closes the other
     automatically, so they never fight for space, and tapping outside
     the panel (or the ✕) closes it.
   - **🏆 Leaderboard icon** — opens the all-time leaderboard in a floating
     window, centered on screen, any time you like — mid-round or between
     rounds. It stays open until you tap the ✕ or tap outside it.
   - **Start round / End round** — always visible, right there in the bar.
4. In **Settings**, pick a mode with the **Live / Test / Offline** switch:
   - **Live** — reads your real TikTok LIVE chat. Type your TikTok username
     (without the `@`) and tap **Connect** once you're already LIVE. If
     you like, type your own **Secret word**, or leave it empty for a
     random one — see "A balanced, always-random word pool" below.
     There's no length or difficulty setting to pick — it's always random.
   - **Test** — rehearse with fake viewers, no TikTok needed. Pick a secret
     word (or Random), switch **Simulated chat** on or off, and choose its
     **Speed**.
   - **Offline** — no TikTok needed. You type each guess yourself,
     with the player's name, in the **Enter a word** panel. Pick a secret
     word (or Random).
   Your choices are remembered on this phone for next time.
5. Tap **Start round**. Both panels close automatically so the game has
   the whole screen; tap the **⚙️** or **⌨️** icon any time to reopen them.
6. Guesses appear in **Live guesses**, and the list keeps itself
   continuously, automatically sorted: the closest word is always on top,
   and rows glide into place the instant a new guess changes the order.
   The single **Latest** line above it always shows the most recent guess,
   even if it's a repeat or not a real word. Each row has a colored bar and
   a rank number — the same green / orange / red scale the real Contexto
   game uses:
   - 🟩 **Dark green** — rank 2–50, extremely close
   - 🟢 **Green** — rank 51–300, close
   - 🟠 **Orange** — rank 301–1500, same general territory
   - 🔴 **Red** — rank 1500+ or not found, far off
   - 🥇 **Gold "EXACT"** — the winning word
   When a round ends — someone finds the word, or you end it — the board
   **stays exactly as it is**, including the #1 exact-answer row, still
   sorted top to bottom. Nothing disappears until you start the next round.
7. **Hints.** Tap the **💡** icon any time during a round to reveal a word
   ranked **between** the closest guess found so far and the #1 answer —
   roughly halfway between the two, so each hint is a real, noticeable step
   closer instead of a barely-different number. (Best guess so far is #250?
   The hint lands around #125. Tap again and it lands around #63, and so
   on.) It's unlimited (tap it as many times as you like) and it will
   **never reveal the #1 answer itself**. A hinted word shows up
   in Live guesses with a dashed gold border and "💡 Hint" in place of a
   name — and if a real viewer later guesses that same word themselves,
   it upgrades to their name and scores normally.
8. **Points.** Every time someone scores, a small floating card pops up in
   the top-right corner showing their profile picture (when TikTok sends
   one — otherwise a colored initial), their name, the word they guessed,
   and the points they just earned. It fades out on its own after a few
   seconds — how many is yours to set, see "Timing controls" below.
9. **Fullscreen.** Tap the corner-arrows button at the top right to go
   fullscreen, and tap it again (or press Esc) to leave. The game keeps its
   normal width and stays centered, so nothing is stretched. On an iPhone,
   Safari doesn't allow fullscreen for web pages: tap **Share → Add to Home
   Screen** and open the game from your home screen instead.
10. Tap **End round** to stop early and show everyone the answer right
    away. When a round ends, two floating
    windows appear automatically, one after the other — no tapping needed:
    - First, a window showing **the answer** in large text, plus a short
      "🏅 Top scorers this round" list (whoever earned the most points
      this round).
    - That window is then replaced by a **🏆 All-time top scores** window
      (top 20 for this streaming session).
    Both lists show **🥇🥈🥉 medals** for 1st, 2nd and 3rd place instead of
    a plain rank number.
    - With **Auto next round** off (Settings), the all-time leaderboard
      window just sits for its own configured duration, then fades away —
      you start the next round yourself, whenever you like.
    - With **Auto next round** on, the leaderboard window instead shows a
      live, ticking **"Next round starts in Ns…"** countdown, and starts
      the next round itself the moment it reaches zero.
    How long each of these windows stays up — and how many seconds the
    countdown counts down from — is entirely up to you; see
    "Timing controls" right below.
    The **Live guesses** board underneath keeps everything as it was the
    whole time — the floating windows are just a highlight reel on top.
    The round button turns into **New round**; one tap starts another
    round with your current settings.
11. **Timing controls.** In **Settings**, below Auto next round, is a
    **Timing** section with four independent number fields (all in
    seconds):
    - **Answer & scorers window** — how long the "answer + top scorers"
      floating window stays up (default 4.2s).
    - **Leaderboard window** — how long the all-time leaderboard stays up
      when Auto next round is **off** (default 5s).
    - **"+points" popup** — how long each scoring pop-up stays on screen
      (default 2.7s).
    - **Auto-next-round countdown** — how many seconds the visible
      countdown counts down from when Auto next round is **on**
      (default 5s).
    Each field has its own small **↺** reset button next to it (resets
    just that one value back to its default), plus a **Reset all to
    defaults** link above them that resets all four at once. Every value
    is remembered on this phone for next time, same as your other
    settings.

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
- **Dictionary** — how many real English words the game currently knows
  (see "Growing the dictionary" below).
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

- **A balanced, always-random word pool.** In Live mode, the secret word is
  picked at random every round from a large pool of everyday-to-moderately-
  challenging English words — never a repeat handful, and never something
  you can set or predict. The pool comes from a real word-frequency list
  (how often each word actually gets used), downloaded once when the
  server starts: the handful of most common words (stopwords like "that"
  or "with" that make dull, low-signal targets) are skipped, and the list
  is cut off well before it reaches truly rare or technical vocabulary.
  What's left is thousands of words that stay fair for a fast, casual
  guesser while still giving a sharp, word-savvy viewer something to work
  for — with no length or difficulty setting to fiddle with, because
  there isn't one to set. A short blocklist keeps a small set of
  slurs/profanity from ever being *picked* as the secret word (they're
  still recognized as real words if someone guesses them). If a picked
  word happens to be too obscure for the ranking service to work with
  anyway, the game quietly tries a few more random words before ever
  falling back to a small backup list — see the point below on the
  ranking service.
- Every mode — Live, Test, and Offline — pulls the target word's list of
  related words from a free word-similarity service (Datamuse) first,
  blending eleven relation signals (meaning, synonyms, everyday
  associations, and more) the same way a real semantic model covers more
  of a word's neighborhood than a single lookup would. This needs the
  server to have internet access, which Render provides automatically —
  including for Test and Offline rounds, since those still run on the
  same always-online server, just without needing a TikTok connection.
  If that service is briefly unreachable, the app automatically falls
  back to its small built-in backup word list and a purely spelling-based
  ranking so the round still starts — Test and Offline still work with
  zero internet if it ever comes to that, just with noticeably weaker
  ranking quality in that one edge case. (If you typed your own secret
  word and it can't be ranked either way, you'll get a message instead of
  a surprise word.)
- Trivial inflections of the target (like "coffees" for "coffee") are
  filtered out of the ranking so they don't hand out a cheap near-exact
  slot right next to the real answer.
- **No difficulty or length setting.** The secret word's length is
  randomized every round (roughly 4 to 12 letters) and there's nothing to
  choose and no letter boxes revealing how long it is — the balance
  described above comes entirely from the word-frequency pool, not from
  any setting you control.
- **A very large dictionary.** To decide what counts as a real English word
  (and to supply Live mode's secret-word pool above), the game merges
  several word lists: the built-in one (about 275,000
  words) plus large public lists that the server downloads once when it
  starts. Junk in those lists (stray letters, capitalised names,
  hyphenated fragments) is filtered out. The status drawer shows the
  exact **Dictionary** total, and the goal is 400,000 or more. See
  "Growing the dictionary" below.
- **Every real word gets ranked.** If a guess is a genuine English word
  but has nothing to do with the target, it still gets a real rank
  number (it just lands in the red "far off" zone) instead of being
  brushed aside — only text that isn't a recognized word at all (typos,
  gibberish) is left unranked and tagged "not a word." Those show in the
  **Latest** line but not in the sorted list.
- **One row per word.** If several people guess the same word it appears
  once in Live guesses, next to whoever found it first.
- Test and Offline rounds rank words the same real, semantic way Live
  rounds do (see above) — they only drop back to the small built-in word
  list in `data/fallback-puzzles.json` plus a spelling-based
  approximation on the rare occasion the word-similarity service can't be
  reached. Add more entries to that file (secret word → an ordered list
  of related words) to make that offline fallback richer.
- **Points are small on purpose.** Only the closest ten words score, and
  you earn points only when you are the first person to find a word in a
  round:

  | Rank of the word | Points |
  |---|---|
  | 1 — the secret word | 5 |
  | 2 | 4 |
  | 3 | 3 |
  | 4–5 | 2 |
  | 6–10 | 1 |
  | 11 or further, or not a word | 0 |

  Points appear as a small gold **+N** on each guess row, and also as the
  floating profile-picture popup described above. Totals are kept for the
  whole session (they reset if the app restarts). Host test guesses and
  hinted words never score by themselves. To re-balance the game, edit
  the `POINTS_BY_RANK` table near the top of the game-logic section of
  `server.js`.
- **"Already guessed."** If a word was already guessed earlier in the round,
  the **Latest** line shows an **Already guessed** tag instead of points
  (hover it to see who guessed it first). Repeats never add a new row to
  the list and never score.
- **Hints never run out and never spoil the answer.** Each tap reveals
  exactly one more word — always the next-closest one that hasn't been
  found or hinted yet — so you can hand your chat as many nudges as you
  like without ever handing them rank #1.
- **Viewer count** appears next to the connection status once TikTok
  starts sending it — not every stream reports it right away.
- Nothing is stored in an external database — restarting the app (for
  example, after a Render redeploy) clears scores. Your settings (username,
  word length, etc.) are saved in your phone's browser, not on the server.
- If TikTok changes something and the connection library falls behind,
  the diagnostics drawer described above is exactly what will show you
  what changed, without needing to read any code.

---

## Growing the dictionary

Tap the status bar at the top of the game and look at the **Dictionary**
line. It shows how many words the game knows. Right after a restart it
says "Loading…" for a few seconds while the big lists download; then it
shows the final total. If the total is **400,000 or more**, you're done.
This total is also exactly the pool Live mode draws its random secret
words from, so a bigger dictionary means more variety.

If it says **"under 400,000"**, one of the downloads didn't work (check the
`[dictionary]` lines in Render's **Logs** to see which). You can add words
yourself in either of two ways:

- **Upload a list.** Create a folder `data/dictionaries` in your GitHub
  repository and upload any plain-text word list there (a `.txt` file with
  one word per line). Every `.txt` file in that folder is merged in
  automatically on the next start.
- **Point to a list online.** In Render, add an environment variable named
  `WORD_LIST_URLS` and set it to the web address of a plain-text word list
  (use commas to separate several). The server downloads it on startup.

**Keeping specific words out of the secret-word pool.** A short built-in
blocklist already keeps common slurs/profanity from ever being picked as
the *secret* word (they're still valid guesses). To add your own, create
a file `data/word-blocklist.txt` in your repository — one word per line —
and every word in it will never be selected as a secret word, in Live,
Test, or Offline mode alike.

Nothing else needs to change.

---

## Folder structure (single deploy folder)

Everything lives in one folder — this is exactly what you upload to
GitHub in Step 2:

```
tiktok-contexto-live/
├── server.js          ← the whole backend (game logic, TikTok connection)
├── package.json
├── README.md
├── public/             ← the entire front-end — nothing outside this folder
│   ├── index.html
│   ├── client.js
│   └── style.css
└── data/
    ├── words.json           ← small backup pool (used only if the dictionary can't load)
    ├── fallback-puzzles.json ← Test/Offline word pool + backup for Live
    ├── word-blocklist.txt   ← optional — words to never pick as the secret word
    └── dictionaries/         ← drop extra .txt word lists here (optional)
```

There is no longer a "which copy is newer" system to think about — the
front-end is only ever served from `public/`, so uploading a changed file
there is always enough. After Render finishes deploying, reload the page
once.

---

## Trying changes safely

Because Test Mode never touches TikTok, you (or anyone helping you) can
always verify the game logic still works after any future change simply
by opening the app, tapping **⚙️ Settings**, switching to **Test**, and
tapping **Start round** — no need to go live to check.
