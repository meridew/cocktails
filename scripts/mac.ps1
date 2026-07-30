# Run a local shell script on the Mac mini host, deterministically.
#
#   .\scripts\mac.ps1 -Script .\scripts\whatever.sh
#
# Piping a script into `ssh mac bash` looks simpler but is not. Windows
# PowerShell prepends a UTF-8 BOM, which the remote bash reads as part of the
# first token ("line 1: set: command not found"), and it terminates the stream
# with CRLF, leaving a lone \r that bash reports as an empty command. Both are
# silent-ish and waste a round trip each time. So: normalise to LF with no BOM,
# copy the bytes across, and run the file.
#
# Auth is the ~/.ssh/mac_cocktails key via the `mac` Host entry in ~/.ssh/config,
# and `dan` has passwordless sudo through /etc/sudoers.d/dan-claude. BatchMode
# means this fails fast rather than hanging on a prompt nothing can answer.
param(
    [Parameter(Mandatory = $true)][string]$Script,
    [string]$MacHost = 'mac'
)

$ErrorActionPreference = 'Stop'

$text = [IO.File]::ReadAllText((Resolve-Path $Script)) -replace "`r`n", "`n"
$tmp = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))

try {
    scp -q -o BatchMode=yes -o ConnectTimeout=10 $tmp "${MacHost}:/tmp/claude-run.sh"
    if ($LASTEXITCODE -ne 0) { throw "scp to $MacHost failed ($LASTEXITCODE)" }
    ssh -o BatchMode=yes -o ConnectTimeout=10 $MacHost bash /tmp/claude-run.sh
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
