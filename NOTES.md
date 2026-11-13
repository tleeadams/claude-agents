# Working notes

Where the project stands, what's unconfirmed, and what could come next. The README covers what each feature does.

## Status (2026-11-13)

Built and in use: the live session cards, Go to window, Catch up, terminal-tab titles, the ☰ repo menu, dings, and the desktop launcher.

Confirmed working on this machine:
- Session detection, transcript parsing, subagents, and Stop (tested on a dummy process).
- Go to window for a session that's already the selected tab. Catch up end to end, on a real session.
- Terminal titles, including renamed tabs once they've been viewed.
- The launcher: it starts the server hidden, opens an Edge app window, and reuses it if it's already open.
- Dings, in headless Edge: the right sound for each change, muting, and the click-to-enable state.

Not yet confirmed in real use:
- Go to window for a renamed tab that isn't selected, which steps through the tabs. It worked in a dry run only.
- Opening a repo from the ☰ menu after the elevation fix. A probe tab with the same arguments worked, but no real Claude launch has been tried yet.
- Hearing an actual ding. The tests recorded the tones; no audio was played.

## Known limits

- Catch up adds its question to anything half-typed in that session's prompt box and sends both.
- A renamed tab is matched to its session only after it's been the selected tab, or by elimination.
- After each page load the browser blocks sound until you click the page. Allowing media autoplay for `http://localhost:4317` in Edge should remove that step; untested.
- The window and terminal features are Windows-only.
- The session registry (`~/.claude/sessions/*.json`) and transcript formats are Claude Code internals, read as of v2.1.304. A Claude Code update could change them.

## Ideas

- Windows desktop notifications alongside the dings, naming the agent.
- Settings for the launch command (e.g. without `--dangerously-skip-permissions`) and for which Terminal window new tabs open in.
- Keep learned tab names across server restarts.
- Totals across agents: running cost or tokens today, how many are waiting on you.
- A text filter for the cards.

## Development notes

- **After a server-side change**, stop the running `server.js` and start it through the Desktop shortcut. Then press Ctrl+R in the dashboard. Static files are re-read on each request, so a page-only change just needs Ctrl+R.
- **Windows Terminal:** `profiles.defaults` sets `"elevate": true`. A tab opened with a command line but no profile gets that default and opens in a separate administrator instance, which also mangles the command. Always pass `-p <default profile>`. Tools can't see into or message administrator windows.
- **pwsh is the Microsoft Store build:** `pwsh.exe` is an app execution alias, which `fs.existsSync` reports as missing. Check for it with `fs.lstatSync`.
- **Screenshots:** headless Edge's `--screenshot` with `--virtual-time-budget` never finishes on this page, because the update stream keeps a request open. Drive Edge over the DevTools protocol instead (`--remote-debugging-port`, then `Page.captureScreenshot`). That also allows test-only scripts, such as recording the tones the page plays.
