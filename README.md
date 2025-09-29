# Plug.DJ But Bad

A very small single-room watch party site designed for GitHub Pages deployment at
[`https://fillylumi.github.io/PlugDjButBad`](https://fillylumi.github.io/PlugDjButBad).

## Features

- Embedded YouTube player powered by the [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- Local storage of the currently selected video, so anyone who opens the page sees the most recent choice
- A "control code" gate to keep casual visitors from changing the video

## Getting started

1. **Set your control code.** In `index.html`, change the value of `ADMIN_CODE` to a secret string
   known only to you. This is checked on the visitor's device, so it is not meant for high security,
   but it stops friends from hijacking the playlist.
2. Commit your changes and push to the `main` branch. GitHub Pages will serve `index.html`
   automatically.
3. Share the link to the page. Anyone with the control code can set a new video by pasting a YouTube
   link or ID in the DJ control form.

## Limitations

- The page runs entirely on the client, so the control code can be discovered by anyone who inspects
  the page source.
- Only one video is tracked at a time; there is no queue or history feature.
- The persisted video is stored in the visitor's browser `localStorage`, so if someone hasn't loaded
  the page since you changed the video they might briefly see an older choice until the latest change
  is loaded.

Feel free to customize the styling, add chat integrations, or expand the control features as needed!
