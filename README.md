# Plug.DJ But Bad

A very small single-room watch party site designed for GitHub Pages deployment at
[`https://fillylumi.github.io/PlugDjButBad`](https://fillylumi.github.io/PlugDjButBad).

## Features

- Embedded YouTube player powered by the [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- Shared `now-playing.json` file so everyone loads the same video, even across devices
- A "control code" gate paired with a short-lived GitHub token for authenticated updates

## Getting started

1. **Set your control code.** In `index.html`, change the value of `ADMIN_CODE` to a secret string
   known only to you. This is checked on the visitor's device, so it is not meant for high security,
   but it stops friends from hijacking the playlist.
2. **Prepare a GitHub token.** Create a fine-grained personal access token that only has
   "Contents: Read and Write" permission for this single repository. You will paste it into the
   control form whenever you want to change the video. Revoke and recreate it if it ever leaks.
3. **Commit to `main`.** Make sure your default branch is named `main` (rename it in the repository
   settings if necessary) and commit/push the files in this repository there. GitHub Pages will look
   for the site files on the default branch by default.
4. **Enable GitHub Pages.** In your repository on GitHub go to **Settings → Pages**, choose
   **Build and deployment → Deploy from a branch**, and select the `main` branch with `/ (root)` as
   the folder. Click **Save**; GitHub will begin building the page.
5. **Wait for the deployment.** After a minute or two, a green "Your site is live" banner should
   appear on the Pages settings screen. The site will be served at
   `https://fillylumi.github.io/PlugDjButBad`.
6. **Share the link.** Anyone without the control code sees the current video only. To change the
   video, enter the control code, paste the new YouTube link, and provide your GitHub token so the
   page can update `now-playing.json` on the repository.

## Limitations

- The page runs entirely on the client, so the control code can be discovered by anyone who inspects
  the page source.
- The GitHub token is sent directly from your browser to the GitHub API. Only enter it when you need
  to change the video, and revoke it if you suspect compromise.
- Only one video is tracked at a time; there is no queue or history feature.

Feel free to customize the styling, add chat integrations, or expand the control features as needed!
