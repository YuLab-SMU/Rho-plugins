import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// How a terminal's shell tells Rho where each command starts and ends, so Rho can record it, and
// which history file it keeps. The person's own startup files run first and unchanged; after
// them the shell gets a history file of Rho's (so a terminal here neither reads nor adds to the
// machine's own shell history) and two hooks. Before a command runs, the hook prints the command
// line and folder; before the next prompt, its exit status. The marks are an escape sequence
// (OSC 6973) that terminals ignore, carrying a nonce only this shell knows, so a program that
// prints one cannot pass it off as a command. zsh, bash and fish have hooks. sh, dash and ksh93
// have none: their prompt carries the marks instead, the last status where it starts and the
// folder where it ends, and the command is the line typed after it, with any lines typed after
// the continuation prompt (terminal-commands.ts). mksh and pdksh scroll a long line sideways as
// it is typed, so the screen does not show it whole: they keep Rho's history but are not marked.
// tcsh, csh and other shells run without marks and their commands are not recorded.
//
// On Windows the console host draws what a shell prints on its next frame but passes a mark on at
// once, so a mark printed right after a command's output can arrive before that output. There the
// shell waits markSettleMs before each mark, which let every mark arrive in order in 30 of 30
// trials (20 ms already did; with no wait, 5 of 30 were out of order). PowerShell (pwsh and
// Windows PowerShell) marks a command when its line editor, PSReadLine, hands the line over, and its
// status before the next prompt. Git Bash gets bash's hooks, with its folders as Windows paths.
// cmd.exe can do neither: its prompt cannot carry the last status and cannot wait, so its commands
// are not recorded.
export const markCode = 6973;
export const markSettleMs = 50;
export type MarkedShell = 'zsh' | 'bash' | 'fish' | 'sh' | 'powershell';
const shFamily = ['sh', 'dash', 'ash', 'ksh', 'ksh93', 'mksh', 'pdksh', 'oksh'];
export const markedShell = (shell: string): MarkedShell | null => {
  if (process.platform === 'win32') {
    const name = path.basename(shell).toLowerCase().replace(/\.exe$/, '');
    return name === 'pwsh' || name === 'powershell' ? 'powershell' : name === 'bash' ? 'bash' : name === 'sh' ? 'sh' : null;
  }
  const name = path.basename(shell);
  return name === 'zsh' || name === 'bash' || name === 'fish' ? name : shFamily.includes(name) ? 'sh' : null;
};

// A text field of a mark: backslash, semicolon and control characters escaped as \\ and \xHH.
export const unescapeMark = (text: string) => text.replace(/\\(\\|x([0-9a-fA-F]{2}))/g, (_, all: string, hex?: string) => hex ? String.fromCharCode(parseInt(hex, 16)) : '\\');

// zsh: ZDOTDIR points at these files, each of which reads the person's own file of that name
// from their ZDOTDIR (or home), the way VS Code's terminal does. The last one puts ZDOTDIR back.
const zshStep = (file: string) => `__rho_zdotdir=$ZDOTDIR
if [[ -f \${RHO_USER_ZDOTDIR:-$HOME}/${file} ]]; then
  ZDOTDIR=\${RHO_USER_ZDOTDIR:-$HOME}; . "$ZDOTDIR/${file}"; RHO_USER_ZDOTDIR=$ZDOTDIR; ZDOTDIR=$__rho_zdotdir
fi
`;
const zshMarks = `__rho_nonce=$RHO_TERMINAL_NONCE; unset RHO_TERMINAL_NONCE
__rho_esc() { local c=\${1//\\\\/\\\\\\\\}; c=\${c//;/\\\\x3b}; c=\${c//$'\\n'/\\\\x0a}; c=\${c//$'\\r'/\\\\x0d}; c=\${c//$'\\t'/\\\\x09}; c=\${c//$'\\a'/\\\\x07}; c=\${c//$'\\e'/\\\\x1b}; print -rn -- "$c"; }
__rho_preexec() { print -rn -- $'\\e]${markCode};'"$__rho_nonce;S;$(__rho_esc "$1");$(__rho_esc "$PWD")"$'\\a'; }
__rho_precmd() { local s=$?; print -rn -- $'\\e]${markCode};'"$__rho_nonce;F;$s"$'\\a'; return $s; }
autoload -Uz add-zsh-hook
preexec_functions=(__rho_preexec \${preexec_functions:#__rho_preexec})
precmd_functions=(__rho_precmd \${precmd_functions:#__rho_precmd})
`;
const zshHistory = `[[ -n $RHO_HISTFILE ]] && HISTFILE=$RHO_HISTFILE
`;
const zshFiles: Record<string, string> = {
  '.zshenv': zshStep('.zshenv'),
  '.zprofile': zshStep('.zprofile'),
  '.zshrc': zshStep('.zshrc') + zshHistory + zshMarks,
  '.zlogin': zshStep('.zlogin') + zshHistory + `if [[ -n $RHO_ZDOTDIR_SET || $RHO_USER_ZDOTDIR != $HOME ]]; then ZDOTDIR=\${RHO_USER_ZDOTDIR:-$HOME}; else unset ZDOTDIR; fi
unset RHO_USER_ZDOTDIR RHO_ZDOTDIR_SET RHO_HISTFILE __rho_zdotdir
`,
};

// bash: an init file read instead of ~/.bashrc, which reads the login files as bash -l would,
// then sets the history file and the hooks. The hook before a command is a DEBUG trap that acts
// only on the first command after a prompt, and reads the line typed from the history (a line
// left out of the history by HISTCONTROL is recorded as the one before it).
const bashLogin = `if [ -f /etc/profile ]; then . /etc/profile; fi
for __rho_file in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$__rho_file" ]; then . "$__rho_file"; break; fi
done
unset __rho_file
`;
// Git Bash on Windows names its folders as Windows paths (pwd -W), and waits before each mark with
// a timed read on a pipe of its own, which starts no program (sleep, its fallback, does). Windows
// ends a shell whose console closes before bash writes its history, so each line is added to the
// history file before the next prompt (history -a).
const settle = markSettleMs / 1000;
const bashWindows = `__rho_wait=$(mktemp -u 2>/dev/null) && mkfifo "$__rho_wait" 2>/dev/null && exec {__rho_wait_fd}<>"$__rho_wait"; rm -f "$__rho_wait"; unset __rho_wait
__rho_settle() { if [ -n "$__rho_wait_fd" ]; then read -t ${settle} -u "$__rho_wait_fd"; else sleep ${settle}; fi; return 0; }
`;
const bashMarks = (windows: boolean) => `if [ -n "$RHO_HISTFILE" ]; then HISTFILE=$RHO_HISTFILE; fi
unset RHO_HISTFILE
__rho_nonce=$RHO_TERMINAL_NONCE; unset RHO_TERMINAL_NONCE
__rho_ready=
__rho_esc() { local c=\${1//\\\\/\\\\\\\\}; c=\${c//;/\\\\x3b}; c=\${c//$'\\n'/\\\\x0a}; c=\${c//$'\\r'/\\\\x0d}; c=\${c//$'\\t'/\\\\x09}; c=\${c//$'\\a'/\\\\x07}; c=\${c//$'\\033'/\\\\x1b}; printf '%s' "$c"; }
${windows ? bashWindows : ''}__rho_preexec() {
  [ -n "$__rho_ready" ] || return 0
  [ -n "$COMP_LINE" ] && return 0
  __rho_ready=
  local c; c=$(HISTTIMEFORMAT= builtin history 1); c=\${c#"\${c%%[![:space:]]*}"}; c=\${c#*[0-9][ *]}; c=\${c#"\${c%%[![:space:]]*}"}
  ${windows ? 'local d; d=$(builtin pwd -W); __rho_settle\n  ' : ''}printf '\\033]${markCode};%s;S;%s;%s\\007' "$__rho_nonce" "$(__rho_esc "$c")" "$(__rho_esc "${windows ? '$d' : '$PWD'}")"
}
__rho_precmd() { ${windows ? 'builtin history -a; __rho_settle; ' : ''}printf '\\033]${markCode};%s;F;%s\\007' "$__rho_nonce" "$__rho_status"; __rho_ready=1; }
trap '__rho_preexec' DEBUG
PROMPT_COMMAND="__rho_status=\\$?;\${PROMPT_COMMAND:+$PROMPT_COMMAND;}__rho_precmd"
`;

// PowerShell (pwsh and Windows PowerShell 5.1): a script run with -NoExit -EncodedCommand after the
// person's profile (a command, unlike a script file, is not held to the execution policy). With
// PSReadLine loaded it sets PSReadLine's history file to Rho's, before the first line is read, and
// wraps PSConsoleHostReadLine, which hands over each line typed, and prompt, which runs before each
// prompt. The status is what PowerShell knows: 0 when the command succeeded; else the exit code a
// program set during it, or the one it set again when no PowerShell error came with the failure,
// unsigned as Windows has it (3221225786 for a program Ctrl+C ended); else 1. The person's prompt
// then runs with $? as it was. A prompt replaced later is wrapped again
// when the next line is read; the command before it is then recorded as not seen to end.
const powershellMarks = `$global:__rho_marks = @{ nonce = $env:RHO_TERMINAL_NONCE; running = $false; code = $null; errors = 0; error = $null }
Remove-Item Env:RHO_TERMINAL_NONCE -ErrorAction Ignore
if ($env:RHO_HISTFILE -and (Get-Module PSReadLine)) { Set-PSReadLineOption -HistorySavePath $env:RHO_HISTFILE }
Remove-Item Env:RHO_HISTFILE -ErrorAction Ignore
if ($function:PSConsoleHostReadLine -and $global:__rho_marks.nonce) {
  function global:__rho_esc([string]$text) { [regex]::Replace($text, '[\\\\;\\x00-\\x1f\\x7f]', { param($c) if ($c.Value -eq '\\') { '\\\\' } else { '\\x{0:x2}' -f [int][char]$c.Value } }) }
  function global:__rho_mark([string]$text) { [System.Threading.Thread]::Sleep(${markSettleMs}); $Host.UI.Write([string][char]27 + ']${markCode};' + $global:__rho_marks.nonce + ';' + $text + [char]7) }
  function global:__rho_wrap {
    if ("$function:prompt" -match '__rho_status') { return }
    $global:__rho_marks.prompt = $function:prompt
    function global:prompt {
      $ok = $global:?; $code = $global:LASTEXITCODE
      $m = $global:__rho_marks; $__rho_status = ''
      if ($m.running) {
        $m.running = $false
        $fresh = $global:Error.Count -ne $m.errors -or ($global:Error.Count -gt 0 -and -not [object]::ReferenceEquals($global:Error[0], $m.error))
        $__rho_status = if ($ok) { 0 } elseif ($code -is [int] -and $code -ne 0 -and ($code -ne $m.code -or -not $fresh)) { $code } else { 1 }
        # Windows exit codes are unsigned (0xC000013A for Ctrl+C); PowerShell holds them signed.
        if ($__rho_status -lt 0) { $__rho_status = [int64]$__rho_status + 4294967296 }
      }
      __rho_mark "F;$__rho_status"
      if (-not $ok) { Write-Error 'failure' -ErrorAction Ignore }
      & $m.prompt
    }
  }
  $global:__rho_marks.read = $function:PSConsoleHostReadLine
  function global:PSConsoleHostReadLine {
    $line = & $global:__rho_marks.read
    $m = $global:__rho_marks
    if ("$line".Trim()) {
      $m.code = $global:LASTEXITCODE; $m.errors = $global:Error.Count; $m.error = if ($global:Error.Count) { $global:Error[0] } else { $null }
      $folder = if ($PWD.Provider.Name -eq 'FileSystem') { $PWD.ProviderPath } else { '' }
      __rho_mark ('S;' + (__rho_esc $line) + ';' + (__rho_esc $folder))
      $m.running = $true
    }
    __rho_wrap
    $line
  }
  __rho_wrap
}
`;

// fish: a file sourced by --init-command, after the person's configuration. fish keeps its history
// by name in its own data folder, so Rho's terminals use a history of their own name there, one
// per project.
const fishMarks = `set -g __rho_nonce $RHO_TERMINAL_NONCE; set -e RHO_TERMINAL_NONCE
if set -q RHO_FISH_HISTORY; set -g fish_history $RHO_FISH_HISTORY; set -e RHO_FISH_HISTORY; end
function __rho_esc
  test -n "$argv[1]"; or return 0
  set -l c (string replace -a -- '\\\\' '\\\\\\\\' $argv[1] | string collect)
  set c (string replace -a -- \\n '\\x0a' "$c"); set c (string replace -a -- ';' '\\x3b' $c); set c (string replace -a -- \\r '\\x0d' $c)
  set c (string replace -a -- \\t '\\x09' $c); set c (string replace -a -- \\a '\\x07' $c); set c (string replace -a -- \\e '\\x1b' $c)
  printf '%s' $c
end
function __rho_preexec --on-event fish_preexec
  set -l c (__rho_esc $argv[1]); set -l d (__rho_esc $PWD)
  printf '\\x1b]${markCode};%s;S;%s;%s\\x07' $__rho_nonce "$c" "$d"
end
function __rho_postexec --on-event fish_postexec
  printf '\\x1b]${markCode};%s;F;%s\\x07' $__rho_nonce $status
end
function __rho_prompt --on-event fish_prompt
  printf '\\x1b]${markCode};%s;F;\\x07' $__rho_nonce
end
`;

// sh, dash and ksh: ENV names this file, which an interactive shell reads. It reads the login
// files as a login shell would, then the person's own ENV file (or ksh's ~/.kshrc and mksh's
// ~/.mkshrc, read when ENV is unset), then sets the history file and the marks. /bin/sh that is
// bash gets bash's hooks; the others get prompts that carry the marks around the person's own.
// A prompt they set later replaces them, and their commands are then not recorded.
const shInit = `__rho_self=$ENV
if [ -n "\${RHO_LOGIN:-}" ]; then
  if [ -f /etc/profile ]; then . /etc/profile; fi
  if [ -f "$HOME/.profile" ]; then . "$HOME/.profile"; fi
fi
if [ -n "\${ENV:-}" ] && [ "$ENV" != "$__rho_self" ]; then __rho_user=$ENV; else __rho_user=\${RHO_USER_ENV:-}; fi
unset RHO_LOGIN RHO_USER_ENV ENV
if [ -n "$__rho_user" ]; then ENV=$__rho_user; export ENV; if [ -f "$__rho_user" ]; then . "$__rho_user"; fi
else
  case \${KSH_VERSION:-} in *MIRBSD*) __rho_user=$HOME/.mkshrc ;; ?*) __rho_user=$HOME/.kshrc ;; esac
  if [ -n "$__rho_user" ] && [ -f "$__rho_user" ]; then . "$__rho_user"; fi
fi
if [ -n "\${BASH_VERSION:-}" ]; then . "\${__rho_self%/*}/bash-marks.sh"
else
  if [ -n "\${RHO_HISTFILE:-}" ]; then HISTFILE=$RHO_HISTFILE; fi
  case \${KSH_VERSION:-} in *MIRBSD*|*PD\\ KSH*) ;; *)
    __rho_nonce=$RHO_TERMINAL_NONCE
    __rho_e=$(printf '\\033'); __rho_b=$(printf '\\007')
    PS1="$__rho_e]${markCode};$__rho_nonce;F;\\$?$__rho_b\${PS1:-\\$ }$__rho_e]${markCode};$__rho_nonce;B;\\\${PWD}$__rho_b"
    PS2="\${PS2:-> }$__rho_e]${markCode};$__rho_nonce;C$__rho_b"
    unset __rho_e __rho_b ;;
  esac
fi
unset RHO_HISTFILE RHO_TERMINAL_NONCE __rho_self __rho_user
`;

const header = '# Written by Rho for its terminals; see shell-marks.ts in Rho-plugins.\n';
const fishQuote = (text: string) => `'${text.replace(/[\\']/g, c => '\\' + c)}'`;

// The files for a shell, written into the console's state folder (each run of Rho writes them
// again, so a changed version of Rho takes effect), and how the shell is started with them. A
// PowerShell's script goes on its command line; `shell` names which PowerShell, for its history.
export async function shellMarks(kind: MarkedShell, folder: string, nonce: string, env: NodeJS.ProcessEnv, root = folder, shell = ''): Promise<{ args: string[]; env: NodeJS.ProcessEnv }> {
  const windows = process.platform === 'win32', history = path.join(folder, 'history');
  // Git Bash takes a Windows path, and its sh finds bash-marks.sh beside its init file, with / between folders.
  const posix = (file: string) => windows ? file.replace(/\\/g, '/') : file;
  await fs.mkdir(history, { recursive: true, mode: 0o700 });
  if (kind === 'powershell') {
    const name = path.basename(shell).toLowerCase().replace(/\.exe$/, '') === 'pwsh' ? 'pwsh' : 'powershell';
    return { args: ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(powershellMarks, 'utf16le').toString('base64')], env: { RHO_HISTFILE: path.join(history, name + '_history'), RHO_TERMINAL_NONCE: nonce } };
  }
  if (kind === 'fish') {
    const file = path.join(folder, 'fish-init.fish');
    await fs.writeFile(file, header + fishMarks, { mode: 0o600 });
    const name = 'rho_' + createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12);
    return { args: ['-l', '--init-command', 'source ' + fishQuote(file)], env: { RHO_FISH_HISTORY: name, RHO_TERMINAL_NONCE: nonce } };
  }
  if (kind === 'sh') {
    const file = path.join(folder, 'sh-init.sh');
    await fs.writeFile(file, header + shInit, { mode: 0o600 });
    await fs.writeFile(path.join(folder, 'bash-marks.sh'), header + bashMarks(windows), { mode: 0o600 });
    return { args: ['-i'], env: { ENV: posix(file), RHO_LOGIN: '1', ...(env.ENV ? { RHO_USER_ENV: env.ENV } : {}), RHO_HISTFILE: posix(path.join(history, 'sh_history')), RHO_TERMINAL_NONCE: nonce } };
  }
  if (kind === 'zsh') {
    const dir = path.join(folder, 'zsh');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    for (const [name, text] of Object.entries(zshFiles)) await fs.writeFile(path.join(dir, name), header + text, { mode: 0o600 });
    const own = env.ZDOTDIR;
    return { args: ['-l'], env: { ZDOTDIR: dir, RHO_USER_ZDOTDIR: own || env.HOME || '', ...(own ? { RHO_ZDOTDIR_SET: '1' } : {}), RHO_HISTFILE: path.join(history, 'zsh_history'), RHO_TERMINAL_NONCE: nonce } };
  }
  const file = path.join(folder, 'bash-init.sh');
  await fs.writeFile(file, header + bashLogin + bashMarks(windows), { mode: 0o600 });
  return { args: ['--init-file', posix(file), '-i'], env: { RHO_HISTFILE: posix(path.join(history, 'bash_history')), RHO_TERMINAL_NONCE: nonce } };
}
