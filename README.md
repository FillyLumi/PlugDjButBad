# Plug.DJ But Bad

A very small single-room watch party site designed for GitHub Pages deployment at
[`https://fillylumi.github.io/PlugDjButBad`](https://fillylumi.github.io/PlugDjButBad).

## Features

- Embedded YouTube player powered by the [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
  with the native controls hidden in favour of a custom volume slider
- Built-in YouTube search that surfaces likely matches with thumbnails, titles, and durations so you
  can queue videos without copying IDs
- Shared queue for upcoming tracks so the current song finishes before the next one begins
- Active listeners receive queue updates in real time, while newcomers start from the default video
  and only see songs added after they arrive
- Moderator roster with individual keys so trusted friends can skip, reorder, or remove queued songs
- Live updates for everyone currently connected using [ntfy](https://ntfy.sh)
- Presence list so you can see who else is currently tuned in
- Everyone can pick a personal display name so the listeners list shows who’s who

## Getting started

1. **Configure your moderators.** In `scripts/config.js`, update the `moderatorRoster` entries so the
   file lists each person allowed to manage the queue. Give every moderator a unique `id`, a friendly
   `label`, and a SHA-256 hash of their personal key. You can generate hashes from the command line
   with `printf 'your-secret' | sha256sum` or in the browser console with:

   ```js
   Array.from(
     new Uint8Array(
       await crypto.subtle.digest("SHA-256", new TextEncoder().encode("your-secret"))
     )
   )
     .map((byte) => byte.toString(16).padStart(2, "0"))
     .join("");
   ```
   Replace the example roster entries before you publish the site so only trusted friends can sign
   in as moderators.
2. **Choose a private ntfy topic.** Update the `ntfyConfig` object in `scripts/config.js` to use a
   long random `topic`, e.g. `plugdjbutbad-8h2f3n9pv0`. ntfy topics are public, so obscurity
   protects your room. You don't need an account, API key, or token.
3. **(Optional) Point search at another Piped instance.** The inline search box uses
   [`piped.video`](https://piped.video) to avoid Google API keys. If that instance ever goes down,
   swap in another [public Piped host](https://github.com/TeamPiped/Piped/wiki/Instances) by editing
   the `searchEndpoints` array in `scripts/config.js`.
4. **Commit to `main`.** Make sure your default branch is named `main` and push this repository
   there so GitHub Pages can serve the site.
5. **Enable GitHub Pages.** In your repository on GitHub go to **Settings → Pages**, choose
   **Build and deployment → Deploy from a branch**, and select the `main` branch with `/ (root)` as
   the folder. Click **Save**; GitHub will begin building the page.
6. **Wait for the deployment.** After a minute or two, a green "Your site is live" banner should
   appear on the Pages settings screen. The site will be served at
   `https://fillylumi.github.io/PlugDjButBad`.
7. **Share the link.** Anyone with the URL can add songs to the queue. The current track finishes
   before the next one starts for everyone who was already in the room. Moderators sign in with
   their personal keys to unlock skip/reorder/remove controls. New listeners start from the default
   video and catch the queue updates that happen after they join.

## Project layout

- `index.html` holds the page structure and loads the modular scripts and styles.
- `styles/main.css` contains all styling for the player, queue, presence list, and admin panels.
- `scripts/config.js` is the only place with private configuration. Values live in module scope so
  they aren't attached to `window`—viewers can't inspect them from the console, but remember the file
  is still delivered to every browser, so treat the hashes and ntfy topic like shared secrets.
- `scripts/main.js` implements the YouTube player wiring, queue logic, search, presence, and
  moderator tools using the configuration helpers exported by `config.js`.

## Limitations

- Moderator key hashes live in the client bundle. Long, random secrets are still recommended because
  determined people could brute-force short ones.
- ntfy topics are public by default. Choose a random topic name to avoid eavesdroppers, and change
  it if someone finds it.
- New arrivals always begin on the default video and only see queue changes that occur after they
  connect. Share the room link early if you want everyone to catch the same set.
- Viewers only get a volume slider—scrubbing and the native YouTube controls are completely disabled.
- Listener presence relies on heartbeats. People disappear if their browser goes quiet for ~45
  seconds, and brand-new arrivals show up after their first heartbeat.
- Search results come from a public Piped instance. If it rate-limits or goes down, swap in a
  different host by updating the endpoints in `scripts/config.js`.

Feel free to customize the styling, add chat integrations, or expand the control features as needed!
