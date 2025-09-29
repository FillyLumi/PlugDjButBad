# Plug.DJ But Bad

A very small single-room watch party site designed for GitHub Pages deployment at
[`https://fillylumi.github.io/PlugDjButBad`](https://fillylumi.github.io/PlugDjButBad).

## Features

- Embedded YouTube player powered by the [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
  with the native controls hidden so only the custom play/pause and mute buttons are exposed
- Live "now playing" pushes to everyone currently connected using [ntfy](https://ntfy.sh)
- A lightweight client-side control code gate to stop casual hijacking

## Getting started

1. **Pick your room secret.** In `index.html`, change `ADMIN_CODE` to something only you know.
   It's enforced in the browser, so it's not bullet-proof, but it keeps friends from editing the
   queue without permission.
2. **Choose a private ntfy topic.** Update `NTFY_TOPIC` in `index.html` to a long random string,
   e.g. `plugdjbutbad-8h2f3n9pv0`. ntfy topics are public, so obscurity protects your room. You
   don't need an account, API key, or token.
3. **Commit to `main`.** Make sure your default branch is named `main` and push this repository
   there so GitHub Pages can serve the site.
4. **Enable GitHub Pages.** In your repository on GitHub go to **Settings → Pages**, choose
   **Build and deployment → Deploy from a branch**, and select the `main` branch with `/ (root)` as
   the folder. Click **Save**; GitHub will begin building the page.
5. **Wait for the deployment.** After a minute or two, a green "Your site is live" banner should
   appear on the Pages settings screen. The site will be served at
   `https://fillylumi.github.io/PlugDjButBad`.
6. **Share the link.** Visitors who know the control code can open the DJ booth and push a new video
   ID. Everyone on the page at that moment jumps to the new video instantly. People who join later
   will stick with whatever is in their local storage (or the default station) until you push again.

## Limitations

- The control code lives in the client bundle. Anyone who can read the source can find it, so use it
  for friendly gatherings only.
- ntfy topics are public by default. Choose a random topic name to avoid eavesdroppers, and change
  it if someone finds it.
- The push only reaches browsers that are currently open and connected to the topic. Latecomers will
  not catch up until you send another update.
- Viewers can only use the custom play/pause and mute buttons—scrubbing and the native YouTube
  controls are completely disabled.

Feel free to customize the styling, add chat integrations, or expand the control features as needed!
