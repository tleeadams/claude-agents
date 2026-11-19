# Changelog

Notable changes in each release. Version numbers follow [Semantic Versioning](https://semver.org). The release build takes each release's notes from its section here.

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
