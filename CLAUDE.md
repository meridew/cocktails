# cocktails

A SvelteKit party-ordering app, served by one Node process. `docs/HANDOFF.md`
describes the stack; `docs/PLATFORM-PLAN.md` describes where it's going and why.

## Shells on Windows — read before running commands

**Windows PowerShell 5.1 silently corrupts arguments to native executables.** It
strips embedded quotes, so

```
ssh mac 'echo "dan ALL=(ALL) NOPASSWD: ALL"'
```

arrives at the remote shell with the quotes gone, and fails with a parse error
that points nowhere near the real cause. There is no configuration that fixes
it: `$PSNativeCommandArgumentPassing` arrived in PowerShell 7.2 and simply does
not exist in 5.1. This burned three commands in one session — an `ssh`, a piped
script, and a `git commit -m` — before it was diagnosed, each looking like an
unrelated bug.

PowerShell **7.6** is installed (winget `Microsoft.PowerShell`, MSIX under
`%LOCALAPPDATA%\Microsoft\WindowsApps`) and fixes it outright — its default
`Windows` argument-passing mode already quotes correctly, with nothing to
configure. Claude Code prefers `pwsh.exe` over `powershell.exe`, but resolves
the shell **at startup**.

So:

- **Check `$PSVersionTable.PSVersion` before trusting PowerShell. If it reports
  5.x, restart Claude Code** — otherwise every quoted argument is a coin flip.
- **Prefer the Bash tool** (Git Bash) for anything POSIX — ssh, git, npm,
  pipelines, heredocs. Its quoting is correct regardless of PowerShell version,
  and it is one process rather than two.
- Use PowerShell for genuinely Windows-specific work: cmdlets, the registry,
  `[Environment]`, services.
- **Multi-line commit messages go through `git commit -F <file>`**, never `-m`.
  This was the same bug wearing a different hat; 7.6 passes multi-line arguments
  correctly, but `-F` can't be broken by a shell at all, so keep using it.
- **`bash` on PATH is not Git Bash.** It resolves to
  `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`, the WSL launcher stub, which
  silently drops the arguments you pass it — `bash -c '…' _ foo` reports `$# = 0`
  and looks exactly like a quoting bug. Git Bash is
  `C:\Program Files\Git\bin\bash.exe`. The Bash **tool** already uses the right
  one; this only bites when invoking `bash` from PowerShell.

## The Mac mini host

`scripts/mac.ps1 -Script <file.sh>` runs a shell script on the Mac. Read its
header before hand-rolling an `ssh mac …` — it normalises encodings that
otherwise produce baffling remote errors. Keys, sudo and the host's state are
recorded in `docs/PLATFORM-PLAN.md` §9.

## Conventions

- `src/lib/neo.css` is a **verbatim** copy of the original design and is in
  `.prettierignore`. Keep it byte-identical; additions go in `app.css`.
- `$lib/server/*` must never be imported from client code — the build enforces it.
- Gates are `npm run check` and `npm test`. Don't call work done on a green
  typecheck alone.
- Deploy only when asked. Pushes gate; they do not deploy.
