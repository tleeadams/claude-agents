# Changelog

Notable changes in each release. Version numbers follow [Semantic Versioning](https://semver.org). The release build takes each release's notes from its section here.

## Unreleased

- Each release page starts by saying what Tabherd does, as SignPath Foundation asks of download pages.

## 0.2.0 - 2026-11-20

To update from Claude Agents 0.1.x: close its dashboard window, put this release's folder in place of the old one, run **Tabherd.exe**, then run **Install shortcuts.cmd** if you use shortcuts. The old version's server stops by itself within 10 minutes of its window closing; until then, Tabherd.exe opens the old page.

- Claude Agents is now **Tabherd**. The launcher is `Tabherd.exe` and the release zip `tabherd-v<version>-windows-x64.zip`. Settings, history and to-dos move from `~/.claude-agents` to `~/.tabherd` the first time the new version starts, and the settings this browser saved carry over. **Install shortcuts.cmd** replaces the old "Claude Agents" shortcuts, and **Remove shortcuts.cmd** removes either. `TABHERD_DATA_DIR` replaces `AGENTS_DATA_DIR`.
- The launcher's file details show its product name and version.
- Releases are ready to be signed through SignPath Foundation, once the project is approved. The README has the code signing policy, and how to uninstall.

## 0.1.2 - 2026-11-20

- History no longer lists sessions closed before Claude was asked anything. Claude saves no conversation for them, so Resume opened a tab that closed straight away.
- A to-do whose session closes unused comes back to its own card, ready to start again, rather than disappearing with its notes.
- A dashboard page left open while the server restarted can change things again. It kept sending the old run's token, so every change was refused: a setting such as *Skip permission prompts* switched straight back.
- Messages show on top of an open dialog, such as Settings, rather than hidden behind it.

## 0.1.1 - 2026-11-19

The first release built by the release workflow on GitHub rather than by hand. The dashboard itself is the same as in 0.1.0.

- CI can be run by hand, from the Actions tab or with `gh workflow run CI --ref <branch>`.
- CONTRIBUTING.md explains how to clear a failed check left on a commit by another pull request.

## 0.1.0 - 2026-11-19

The first public release. The dashboard runs anywhere Node 18 or later does. The window and terminal features, the desktop launcher and the release download are Windows-only for now.

- A live card for every Claude Code session on the computer: its status (Needs you, Working, Shell running, Idle), the tools running now, the latest reply or recap, the last prompt, the model, context use, subagents and PR links.
- Filters for each status, and Todo for everything waiting on you.
- Go to window, which finds the session's Windows Terminal tab, even a renamed one. Catch up, which asks the session where things stand.
- Sounds and a pop-up when a session needs you or finishes, and a list of those notifications that clears itself.
- A ☰ menu of the git repos under `~/source`, opening Claude in a new Windows Terminal tab. Settings can hide folders from it.
- History of closed sessions, filled in from the last 30 days of transcripts, with Resume.
- To-dos: cards with a title and notes that start a Claude session in a chosen folder and then follow it.
- Settings for theme, card size, notifications, the repo menu, to-dos, and whether new sessions skip permission prompts. They're off by default.
- A desktop launcher that starts the server in the background and opens the dashboard in its own window.
