# Claude Agents

A local dashboard that lists every [Claude Code](https://code.claude.com) session running on your computer and shows what each one is doing: which ones need you, which are working, and what they last said. It watches the sessions you start anyway, in any terminal, with nothing to set up in Claude Code. It runs entirely on your computer and has no dependencies beyond Node.

Claude Agents is an independent project. It isn't made or endorsed by Anthropic.

## Install (Windows)

1. Download `claude-agents-v<version>-windows-x64.zip` from the [latest release](../../releases/latest). It includes Node, so there's nothing else to install.
2. Extract it somewhere to keep it, such as `%LOCALAPPDATA%\Programs`.
3. Run **Claude Agents.exe**. To add it to the Start menu and the Desktop, run **Install shortcuts.cmd**. **Remove shortcuts.cmd** takes them away again.

The launcher isn't code-signed yet, so Windows SmartScreen may warn about it the first time. Choose **More info**, then **Run anyway**. Each zip has a `.sha256` file beside it on the release page for checking the download.

To update, replace the folder with the new release's. Settings, history and to-dos are kept in `~/.claude-agents`, outside it.

The launcher starts the dashboard server in the background, with no console window, if it isn't already running. It then opens the dashboard in its own Edge app window, with no tabs or address bar. If that window is already open, it brings the window to the front instead. A server started this way stops by itself 10 minutes after the last dashboard closes, and the next launch starts it again in a couple of seconds.

## Run from source

With Node 18 or later, on any operating system:

```
npm start          # serve on http://localhost:4317 and open the browser
npm run serve      # serve without opening a browser
npm run check      # print a one-off table in the terminal
```

Set `PORT` to use another port. Set `CLAUDE_CONFIG_DIR` if your Claude config isn't in `~/.claude`. The server keeps its own settings in `~/.claude-agents`; set `AGENTS_DATA_DIR` to use another folder.

On Windows, the same launcher and shortcuts as a release can be built from the source:

```
npm run install-shortcut     # build launcher/ClaudeAgents.exe; add Desktop and Start menu shortcuts
npm run uninstall-shortcut   # remove the shortcuts
```

The launcher is a small C# program (`launcher/ClaudeAgents.cs`), compiled with the C# compiler that comes with Windows. The build also draws its icon from the same shapes as the favicon. Run the install again after moving the folder or switching Node versions; it records which `node.exe` to use.

## Platform support

| | Windows | macOS, Linux |
| --- | --- | --- |
| Session cards, statuses, filters, sounds, notifications, history, settings | Yes | Yes, from source |
| Go to window, Catch up, terminal tab titles | Yes, with Windows Terminal | Not yet |
| Opening Claude from the repo menu, Resume and to-dos | Yes, in Windows Terminal | Not yet |
| Desktop launcher and release download | Yes | Not yet |

The parts that aren't on macOS and Linux yet are the ones that drive terminal windows. The rest is plain Node and runs the same everywhere.

## What it shows

- **Status**: *Needs you* (blocked on a prompt or dialog), *Working*, *Shell running* (at the prompt while a background shell runs) or *Idle*, plus how long it has been in that state.
- **Activity**: the tools running now and for how long, the latest message or recap, and the last prompt. Click a message to expand it.
- **Model and tokens**: the model, how full the context window is, output tokens and number of prompts.
- **Subagents**: running subagents with their current step, then recently finished ones.
- **Actions**: go to the session's window, catch up, open its folder, copy a `claude --resume` command, or stop the session. Clicking a session's name also goes to its window.

The filters in the header show every session, or only those in one state. **Todo** shows *Needs you* and *Idle* together, along with the to-do cards: everything whose turn it is. *Shell running* counts as Working, not Todo.

## To-dos (Windows)

**+ To-do** in the header adds a card with a title and notes, for work you want to give Claude later. To-do cards sit at the top of the grid, with a dashed border, and count under All and Todo. Ctrl+Enter saves from the notes box.

**Start** opens a Windows Terminal tab in the to-do's folder running `claude --session-id <new id>`. With no folder chosen yet, it asks for one first; **Choose folder** sets one without starting. Settings → To-dos says where the folder comes from:

- **Repo menu** (the default): the ☰ menu opens for choosing. Click a repo.
- **Any folder**: Windows' folder picker, which the server opens in front of the dashboard.

**Start in** is the folder either one opens at.

The server makes up the session ID, so it knows which session the to-do turned into. Once that session appears, its card replaces the to-do's, with the to-do's title and notes at the top and **Copy** to paste them into Claude. Nothing is typed into Claude for you. If no session turns up within a minute, the to-do's card says so and offers **Start again**.

When the session closes, the to-do goes too. Its title and notes stay with the session in History, and resuming the session brings the to-do back on its card. **Delete** asks for a second click. To-dos are saved in `~/.claude-agents/todos.json`.

## Settings

The gear button in the header opens Settings.

**New sessions**: *Skip permission prompts* (off by default) makes every session the dashboard opens, from the repo menu, Resume or a to-do, run `claude --dangerously-skip-permissions`. Claude then edits files and runs commands without asking first. Only turn it on if you'd run Claude that way yourself in those folders.

**Theme**: *System* (the default) follows Windows' light or dark mode. *Light* or *Dark* sets one regardless.

**Card size** sets how the cards are laid out:

- **Fit content** (the default): each card is as tall as its content, so cards in a row can differ.
- **Small**, **Medium** or **Large**: every card is the same size. Small fits the most on screen, Medium is about as wide as Fit content, and Large leaves room for subagents and PRs. Each header line stays on one line and is cut off with "…" if it's too long; the full path is in the tooltip. The buttons stay at the bottom, and anything that doesn't fit in between scrolls inside the card, with a shadow at the edge showing there's more.

**Notifications**: *Keep the list after a reload* (on by default) saves the notification list, so reloading or reopening the dashboard keeps it.

**To-dos**: where a to-do's folder is chosen from (the repo menu or any folder), and the folder that choice starts at. See [To-dos](#to-dos-windows).

**Repo menu**: every folder and repo under the repos folder, nested as in the ☰ menu, each with a tick box. Untick one to hide it, and everything inside it, from the menu. What's inside a hidden folder is greyed out but keeps its own setting, so ticking the folder again brings back exactly what was shown before. A folder with some repos hidden says how many, in amber. The filter box works like the menu's. A hidden path that's no longer in the repos folder is listed underneath, with ✕ to remove it.

Theme, Card size and Notifications are saved in the browser, so each browser profile remembers its own choice. The rest are saved by the server, in `~/.claude-agents/settings.json`, so every browser shares them.

## Catch up (Windows)

**Catch up** goes to the session's window and asks: *"Catch me up: where do things stand? Briefly cover what's done, what's in progress, and anything you need from me."* Set `CATCH_UP_PROMPT` to change the wording. The server holds the prompt, so the API can't be used to type anything else into an agent.

The keystrokes go straight into that session's console input, never to whichever window has focus, so they can't land in the wrong place. Enter is sent on its own a moment after the text, so Claude Code submits the prompt rather than treating it as a pasted newline. If the session is busy, Claude Code queues the question until its current step finishes.

Catch up is disabled while a session is waiting on a permission prompt or dialog, where typing and Enter could answer it. The script checks the session's status again just before typing. If you've half-typed something in that session's prompt box, the question is added to the end of it and sent with it.

## Dings

The page plays a sound when an agent changes state:

- **Needs you** (it starts waiting on a prompt or dialog): two rising notes.
- **Finished** (Working to Idle, or to "Shell running" at the prompt): one soft bell.

A toast says which agent it was, and its card pulses. If several agents change at once you hear one sound, and sounds are at least 2 seconds apart.

Each change is also added to the notification list, the tray button left of the bell, so it can still be read after the toast fades. The button shows how many entries there are, in amber if any agent needs you. Each entry names the agent, which links to its window, and says what happened and when. Clear entries with ✕ or **Clear all**. An entry also clears itself once its agent is working again, and a *needs you* entry clears once that agent stops waiting. The list keeps one entry per agent, the latest. An agent that closes keeps its entry, marked *session closed*. The sounds are synthesized in the page, so there are no audio files. The bell button in the header turns sound on or off, and the setting is remembered.

Browsers only let a page play sound after you've clicked or typed in it, so after opening or reloading the dashboard the bell reads **Click to enable sound** until you click anywhere on the page. To skip that, allowing media autoplay for `http://localhost:4317` in Edge (Settings → Cookies and site permissions → Media autoplay) should let it play straight away.

The server pushes each update to open dashboards (`/api/stream`, server-sent events) instead of the page checking every few seconds. A browser slows timers in hidden or covered windows to as little as once a minute, which would make dings late. Pushed messages are handled right away.

## History

The clock button in the header lists sessions that have closed, newest first and grouped by day. Each entry has the session's name, folder, branch and last prompt, and a filter searches all of those. **Resume** opens a Windows Terminal tab in the session's folder running `claude --resume <id>`, so the conversation carries on where it stopped. **Copy resume command** copies a command that does the same, for running yourself.

The server records a session when it drops off the dashboard, keeping its terminal tab's title and session name. Sessions that closed while the server wasn't running, or while no dashboard was open, are read from their transcripts in `~/.claude/projects`, going back 30 days. Those show Claude's title for the session, or its first prompt, rather than the tab's title. Each transcript is read once and again only if it changes, so after the first scan (about a second for 300 MB of transcripts) opening History is quick. Only interactive sessions are listed, not `claude -p` or SDK runs. A session that's running again, because it was resumed, leaves the list until it closes. The history keeps the latest 300 sessions, in `~/.claude-agents/history.json`.

## Repo menu (Windows)

The ☰ button at the top left lists the git repos under `~/source` (set `REPOS_DIR` to change it) as a folder tree, e.g. work → acme → api. Any folder with a `.git` entry counts, worktrees included. Each folder shows how many repos it holds, and a green dot marks repos that already have a Claude session running. Folders hidden in Settings, and everything inside them, are left out, and the menu's heading says how many are hidden. Folders you open stay open next time. Typing in the filter keeps repos whose path contains every word and whose name contains at least one. Enter opens the repo when only one matches. `http://localhost:4317/#repos/<filter>` opens the menu already filtered.

Clicking a repo opens a tab in your most recent Windows Terminal window with:

```
wt -w 0 new-tab -p <your default profile> -d <repo> pwsh -NoExit -EncodedCommand <claude>
```

With *Skip permission prompts* on in Settings, the command is `claude --dangerously-skip-permissions`. Claude runs inside pwsh, so when you quit Claude the tab stays open at a prompt in the repo. The server only opens folders from its own scan, from Windows' folder picker for a to-do, or for Resume from its own history, never a path sent by the page.

The tab uses your default Windows Terminal profile on purpose. If `profiles.defaults` sets `"elevate": true` and a tab is opened with just a command line, the tab gets that default. Windows Terminal then opens it in a separate administrator instance and mangles the command on the way. Naming the default profile gives the tab the same settings as a new tab you open yourself. The command is base64-encoded so Windows Terminal can't split it or read its flags as its own.

## Terminal titles (Windows)

Each card is headed with what the session's terminal tab shows. For a tab you haven't renamed, that's the session's own title without the spinner glyph. For a renamed tab ("API - auth"), it's your name for the tab. A background PowerShell worker (`lib/terminal-titles.ps1`) checks every few seconds while the dashboard is open.

A renamed tab hides the session's title, so Windows Terminal only reveals which session it holds while it's the selected tab. The dashboard learns each one when you view that tab or use Go to window, or by elimination once it's the only unmatched tab in its window. Until then the card shows Claude's title. It never switches tabs to find out. The Claude session name (e.g. `api-server-3d`) moves to the line with the PID.

## Go to window (Windows)

`lib/focus-window.ps1` attaches to the session's console. The owner of the console window shows which Windows Terminal window hosts it, and the console title is the session's title. UI Automation then finds the tab whose name matches. A tab you renamed hides the session's title, so for those it steps through the window's tabs until a pane shows that title, then focuses the pane. For other hosts, such as VS Code or a classic console, it brings up the hosting app's window.

Run `powershell -File lib/focus-window.ps1 -TargetPid <pid> -DryRun` to see how a session would be found without switching anything.

Start the server from a normal terminal. If it's started from a sandboxed shell, such as Claude Code's Bash sandbox, Windows blocks it from switching other windows.

## Where the data comes from

All of it is read-only, from files Claude Code already writes:

| Source | Used for |
| --- | --- |
| `~/.claude/sessions/<pid>.json` | The list of sessions, with their status, name, folder and version. The `.key` files next to them are never read. |
| `~/.claude/projects/<project>/<session>.jsonl` | Title, prompts, tool calls, model, token usage, recaps and PR links. Each poll reads only the newly appended bytes. |
| `…/<session>/subagents/*.meta.json` and `*.jsonl` | Subagents and what they are doing. |
| `Get-Process` (Windows) or `ps` | Memory use, and a check that each PID still belongs to the Claude process that registered it. |

A session file whose process has exited, or whose PID now belongs to another process, is ignored.

The only files the server writes are its own, in `~/.claude-agents`: `settings.json` holds the settings that aren't kept in the browser, `history.json` the closed sessions and `todos.json` the to-dos.

## Safety

The server listens on `127.0.0.1` only and rejects requests with any other `Host` header, so other web pages can't read your prompts through DNS rebinding. The session actions, opening a repo, resuming a closed session, the to-do actions and saving settings all need a per-run token that only the served page has. A to-do's title reaches the folder picker only as an environment variable, never as part of a command. The session actions also work only on a session that is currently verified as live. **Stop** runs `taskkill /T /F` on the session and its child processes, after you confirm. Sessions the dashboard opens ask before acting, as Claude Code does by default, unless you turn on *Skip permission prompts*.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Development

```
npm run setup      # once after cloning: turn on the git hooks for the branch rules
npm test           # the tests, with Node's built-in test runner
npm run build      # build the release zip for this platform into dist/
```

There are no dependencies to install. CI runs the tests on Windows, macOS and Linux, with Node 18 and 24, and builds the Windows zip, on every pull request and every push to `main` and `develop`. [NOTES.md](NOTES.md) has working notes: what's planned, what isn't confirmed yet, and the Windows quirks found along the way.

The repository follows gitflow: work happens on `feature/` branches off `develop`, and `main` only takes releases. [CONTRIBUTING.md](CONTRIBUTING.md) has the branch rules, how they're enforced, and the steps for a release. Releases bundle the Node version in `.node-version`.

To add a platform to the releases, give `scripts/build-release.js` a target for it and add its runner to `.github/workflows/release.yml`.

## License

Claude Agents is free software under the [GNU General Public License, version 3](LICENSE) or later. Releases include Node.js, which has its own licence, in `node/LICENSE`.
