# Claude Agents

A local dashboard that lists every Claude Code session running on this machine and shows what each one is doing. It has no dependencies; Node 18 or later is all it needs.

```
npm start          # serve on http://localhost:4317 and open the browser
npm run serve      # serve without opening a browser
npm run check      # print a one-off table in the terminal
```

Set `PORT` to use another port. Set `CLAUDE_CONFIG_DIR` if your Claude config isn't in `~/.claude`.

## Desktop app (Windows)

```
npm run install-shortcut     # build launcher/ClaudeAgents.exe; add Desktop and Start menu shortcuts
npm run uninstall-shortcut   # remove the shortcuts
```

The **Claude Agents** shortcut starts the server in the background, with no console window, if it isn't already running. It then opens the dashboard in its own Edge app window, with no tabs or address bar. If that window is already open, the shortcut brings it to the front instead. A server started this way stops by itself 10 minutes after the last dashboard closes, and the next launch starts it again in a couple of seconds.

The launcher is a small C# program (`launcher/ClaudeAgents.cs`), compiled with the C# compiler that comes with Windows. The install script also draws its icon (`launcher/app.ico`) from the same shapes as the favicon. Run the install again after moving the folder or switching Node versions; it records which `node.exe` to use.

## What it shows

- **Status**: *Needs you* (blocked on a prompt or dialog), *Working*, *Shell running* (at the prompt while a background shell runs) or *Idle*, plus how long it has been in that state.
- **Activity**: the tools running now and for how long, the latest message or recap, and the last prompt. Click a message to expand it.
- **Model and tokens**: the model, how full the context window is, output tokens and number of prompts.
- **Subagents**: running subagents with their current step, then recently finished ones.
- **Actions**: go to the session's window, catch up, open its folder, copy a `claude --resume` command, or stop the session. Clicking a session's name also goes to its window.

## Catch up (Windows)

**Catch up** goes to the session's window and asks: *"Catch me up: where do things stand? Briefly cover what's done, what's in progress, and anything you need from me."* Set `CATCH_UP_PROMPT` to change the wording. The server holds the prompt, so the API can't be used to type anything else into an agent.

The keystrokes go straight into that session's console input, never to whichever window has focus, so they can't land in the wrong place. Enter is sent on its own a moment after the text, so Claude Code submits the prompt rather than treating it as a pasted newline. If the session is busy, Claude Code queues the question until its current step finishes.

Catch up is disabled while a session is waiting on a permission prompt or dialog, where typing and Enter could answer it. The script checks the session's status again just before typing. If you've half-typed something in that session's prompt box, the question is added to the end of it and sent with it.

## Dings

The page plays a sound when an agent changes state:

- **Needs you** (it starts waiting on a prompt or dialog): two rising notes.
- **Finished** (Working to Idle, or to "Shell running" at the prompt): one soft bell.

A toast says which agent it was, and its card pulses. If several agents change at once you hear one sound, and sounds are at least 2 seconds apart. The sounds are synthesized in the page, so there are no audio files. The bell button in the header turns sound on or off, and the setting is remembered.

Browsers only let a page play sound after you've clicked or typed in it, so after opening or reloading the dashboard the bell reads **Click to enable sound** until you click anywhere on the page. To skip that, allowing media autoplay for `http://localhost:4317` in Edge (Settings → Cookies and site permissions → Media autoplay) should let it play straight away.

The server pushes each update to open dashboards (`/api/stream`, server-sent events) instead of the page checking every few seconds. A browser slows timers in hidden or covered windows to as little as once a minute, which would make dings late. Pushed messages are handled right away.

## Repo menu (Windows)

The ☰ button at the top left lists the git repos under `~/source` (set `REPOS_DIR` to change it) as a folder tree, e.g. work → acme → api. Any folder with a `.git` entry counts, worktrees included. Each folder shows how many repos it holds, and a green dot marks repos that already have a Claude session running. Folders you open stay open next time. Typing in the filter keeps repos whose path contains every word and whose name contains at least one. Enter opens the repo when only one matches. `http://localhost:4317/#repos/<filter>` opens the menu already filtered.

Clicking a repo opens a tab in your most recent Windows Terminal window with:

```
wt -w 0 new-tab -p <your default profile> -d <repo> pwsh -NoExit -EncodedCommand <claude --dangerously-skip-permissions>
```

Claude runs inside pwsh, so when you quit Claude the tab stays open at a prompt in the repo. The server only opens folders from its own scan, never a path sent by the page.

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

## Safety

The server listens on `127.0.0.1` only and rejects requests with any other `Host` header, so other web pages can't read your prompts through DNS rebinding. The open-folder and stop actions need a per-run token that only the served page has. They also work only on a session that is currently verified as live. **Stop** runs `taskkill /T /F` on the session and its child processes, after you confirm.
