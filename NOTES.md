# Working notes

Where the project stands, what's unconfirmed, and what could come next. The README covers what each feature does.

## Status (2026-11-13)

Built and in use: the live session cards, Go to window, Catch up, terminal-tab titles, the ☰ repo menu, dings, and the desktop launcher.

Confirmed working on Windows 11, with Windows Terminal:
- Session detection, transcript parsing, subagents, and Stop (tested on a dummy process).
- Go to window for a session that's already the selected tab. Catch up end to end, on a real session.
- Terminal titles, including renamed tabs once they've been viewed.
- The launcher: it starts the server hidden, opens an Edge app window, and reuses it if it's already open.
- Dings, in headless Edge: the right sound for each change, muting, and the click-to-enable state.

Not yet confirmed in real use:
- Go to window for a renamed tab that isn't selected, which steps through the tabs. It worked in a dry run only.
- Opening a repo from the ☰ menu after the elevation fix. A probe tab with the same arguments worked, but no real Claude launch has been tried yet.
- Hearing an actual ding. The tests recorded the tones; no audio was played.
- The theme setting, Todo filter and notification list (2026-11-19). Tested in headless Edge, where the list's clearing rules were run against simulated status changes. A real agent's change hasn't been seen to add or clear an entry yet.
- History (2026-11-19). The transcript backfill ran against the real transcripts, and recording a close was tested with simulated snapshots. A real session closing, and Resume actually opening a tab, haven't been tried yet.
- To-dos (2026-11-19). Creating, editing, choosing a folder from the repo menu, deleting and the Settings were tested in headless Edge; the session link and closing were unit-tested with simulated snapshots. The folder picker was opened from a test server and closed by a script: it showed in front, and both Cancel and Select Folder came back right. Not yet tried: a real Start, so whether Claude registers the `--session-id` it was given and the card hands over; and the picker from the real server.
- Releases (2026-11-19). `npm run build` was run locally, and the zip extracted and launched: its launcher started the bundled Node server and found the open dashboard window. The tests pass on Windows, and on Linux in Docker with Node 18 and 24. Not yet run: the GitHub workflows themselves, the macOS tests, and a download from a real release (so SmartScreen's reaction to the unsigned launcher is unknown).

## Going public (2026-11-19)

Done: a GPL-3.0-or-later licence, the release build and workflows, tests and CI, SECURITY.md and CHANGELOG.md, and a safe default for new sessions. *Skip permission prompts* is a setting and is off unless chosen.

No identifying information goes in the code, docs or history, including real work examples: use made-up names such as `work/acme/api`. The first commit was rewritten to match.

Gitflow is set up (see CONTRIBUTING.md): `main`, `develop` and `feature/public-release` exist locally, and the hooks are on in this clone. The GitHub half (`npm run setup-github`) can only run once the repository exists and `main` and `develop` are pushed. The rulesets' JSON hasn't been sent to GitHub yet, so it's unconfirmed that GitHub accepts every field.

Pull requests need an approving review from someone in `.github/CODEOWNERS`, which names only the owner's GitHub handle so far. That handle is also in the repository's URL. The admin can bypass the "CI" and "Reviews" rulesets when merging a pull request, for hotfixes and for their own work while they're the only reviewer. They can't bypass "Gitflow": pull requests only, from the right kind of branch, with merge commits and the Gitflow check. Not yet tried on GitHub: whether bypassing two rulesets leaves the third enforced, as GitHub documents, and whether `gh pr merge --admin` uses a ruleset bypass.

Before the repo goes public:
- Code-signing the launcher would stop the SmartScreen warning. It needs a certificate, such as Azure Trusted Signing.
- macOS and Linux need their own ways to open a terminal tab, find a window and pick a folder before they get releases.

## Known limits

- Catch up adds its question to anything half-typed in that session's prompt box and sends both.
- A renamed tab is matched to its session only after it's been the selected tab, or by elimination.
- After each page load the browser blocks sound until you click the page. Allowing media autoplay for `http://localhost:4317` in Edge should remove that step; untested.
- The window and terminal features are Windows-only.
- The session registry (`~/.claude/sessions/*.json`) and transcript formats are Claude Code internals, read as of v2.1.304. A Claude Code update could change them.

## Planned (2026-11-19)

In build order, smallest first. Items 1 to 3 only change the page. Items 4 to 6 need settings or data the server keeps in a file between runs, so the first of those builds that store.

1. **Light / Dark / System theme** in Settings. *Built 2026-11-19.*
2. **A "Todo" filter** in the header: Needs you and Idle together. *Shell running* isn't included, for now. *Built 2026-11-19.*
3. **Notification list** opened from a header button, with a setting to keep it across reloads. An entry clears itself once its agent is working again. *Built 2026-11-19.*
4. **Excluded folders** in Settings, hiding a folder or repo and everything under it from the ☰ repo menu. The session cards are unaffected. *Built 2026-11-19*, along with the server's settings store (`lib/store.js`, `lib/settings.js`). Reworked the same day from a typed path to a nested tree of tick boxes. The server now scans everything once and hides the excluded folders afterwards, so Settings can show them and changing one doesn't rescan the disk.
5. **History of closed agents**, with Resume, filled in from the last 30 days of transcripts. *Built 2026-11-19* (`lib/history.js`).
6. **To-do cards.** A card with a title and notes but no folder or agent yet. You pick a working folder, and Start opens a Claude tab there. The card then becomes that session's card: starting Claude with `--session-id <uuid>` tells the server which session it turned into. *Built 2026-11-19* (`lib/todos.js`, `lib/pick-folder.ps1`).
   - A setting chooses where the folder comes from: the ☰ repo tree, or any folder through a Windows folder picker that the server opens. Another sets the default folder the choice starts from.
   - Start doesn't send the to-do's text to Claude. To use it as a prompt, copy and paste it into the session.
   - To-do cards count under All and the Todo filter.
   - Once linked, a to-do follows its session's process too, so it stays linked if the session ID changes (as `/clear` does). When the session closes, the to-do is hidden and kept for 30 days, so resuming the session brings it back. Its title and notes are also saved in the session's History entry.

## Ideas

- Windows desktop notifications alongside the dings, naming the agent.
- More settings in the Settings dialog: which Terminal window new tabs open in, and the port. Those belong on the server, not in browser storage.
- Keep learned tab names across server restarts.
- Totals across agents: running cost or tokens today, how many are waiting on you.
- A text filter for the cards.

## Development notes

- **After a server-side change**, stop the running `server.js` and start it through the Desktop shortcut. Then press Ctrl+R in the dashboard. Static files are re-read on each request, so a page-only change just needs Ctrl+R.
- **Testing beside the real server:** run a second one with `PORT=4399` and `AGENTS_DATA_DIR` set to a scratch folder, so tests don't change the real `~/.claude-agents`.
- **Server settings:** each key in `lib/settings.js` has a check that cleans the value or rejects it. `POST /api/settings` changes only the keys sent, all or none. A hand-edited `settings.json` is checked the same way when the server starts.
- **Windows Terminal:** `profiles.defaults` sets `"elevate": true`. A tab opened with a command line but no profile gets that default and opens in a separate administrator instance, which also mangles the command. Always pass `-p <default profile>`. Tools can't see into or message administrator windows.
- **Windows started hidden:** Node's `windowsHide` tells Windows to hide the first window the child process shows. For the folder picker that was its owner window, and the dialog then returned OK at once, with the start folder, never having shown. `pick-folder.ps1` shows the owner a second time to get around that. Any other script the server runs that shows a window needs the same.
- **pwsh is the Microsoft Store build:** `pwsh.exe` is an app execution alias, which `fs.existsSync` reports as missing. Check for it with `fs.lstatSync`.
- **Screenshots:** headless Edge's `--screenshot` with `--virtual-time-budget` never finishes on this page, because the update stream keeps a request open. Drive Edge over the DevTools protocol instead (`--remote-debugging-port`, then `Page.captureScreenshot`). That also allows test-only scripts, such as recording the tones the page plays.
