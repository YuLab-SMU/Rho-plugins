import * as fs from 'node:fs/promises';
import path from 'node:path';

// How a terminal's shell tells Rho where each command starts and ends, so Rho can record it, and
// which history file it keeps. The person's own startup files run first and unchanged; after
// them the shell gets a history file of Rho's (so a terminal here neither reads nor adds to the
// machine's own shell history) and two hooks. Before a command runs, the hook prints the command
// line and folder; before the next prompt, its exit status. The marks are an escape sequence
// (OSC 6973) that terminals ignore, carrying a nonce only this shell knows, so a program that
// prints one cannot pass it off as a command. zsh and bash have hooks; other shells run without
// marks and their commands are not recorded.
export const markCode = 6973;
export type MarkedShell = 'zsh' | 'bash';
export const markedShell = (shell: string): MarkedShell | null => {
  const name = path.basename(shell);
  return name === 'zsh' ? 'zsh' : name === 'bash' ? 'bash' : null;
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
const bashInit = `if [ -f /etc/profile ]; then . /etc/profile; fi
for __rho_file in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$__rho_file" ]; then . "$__rho_file"; break; fi
done
unset __rho_file
if [ -n "$RHO_HISTFILE" ]; then HISTFILE=$RHO_HISTFILE; fi
unset RHO_HISTFILE
__rho_nonce=$RHO_TERMINAL_NONCE; unset RHO_TERMINAL_NONCE
__rho_ready=
__rho_esc() { local c=\${1//\\\\/\\\\\\\\}; c=\${c//;/\\\\x3b}; c=\${c//$'\\n'/\\\\x0a}; c=\${c//$'\\r'/\\\\x0d}; c=\${c//$'\\t'/\\\\x09}; c=\${c//$'\\a'/\\\\x07}; c=\${c//$'\\033'/\\\\x1b}; printf '%s' "$c"; }
__rho_preexec() {
  [ -n "$__rho_ready" ] || return 0
  [ -n "$COMP_LINE" ] && return 0
  __rho_ready=
  local c; c=$(HISTTIMEFORMAT= builtin history 1); c=\${c#"\${c%%[![:space:]]*}"}; c=\${c#*[0-9][ *]}; c=\${c#"\${c%%[![:space:]]*}"}
  printf '\\033]${markCode};%s;S;%s;%s\\007' "$__rho_nonce" "$(__rho_esc "$c")" "$(__rho_esc "$PWD")"
}
__rho_precmd() { printf '\\033]${markCode};%s;F;%s\\007' "$__rho_nonce" "$__rho_status"; __rho_ready=1; }
trap '__rho_preexec' DEBUG
PROMPT_COMMAND="__rho_status=\\$?;\${PROMPT_COMMAND:+$PROMPT_COMMAND;}__rho_precmd"
`;

// The files for a shell, written into the console's state folder (each run of Rho writes them
// again, so a changed version of Rho takes effect), and how the shell is started with them.
export async function shellMarks(kind: MarkedShell, folder: string, nonce: string, env: NodeJS.ProcessEnv): Promise<{ args: string[]; env: NodeJS.ProcessEnv }> {
  const history = path.join(folder, 'history');
  await fs.mkdir(history, { recursive: true, mode: 0o700 });
  if (kind === 'zsh') {
    const dir = path.join(folder, 'zsh');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    for (const [name, text] of Object.entries(zshFiles)) await fs.writeFile(path.join(dir, name), '# Written by Rho for its terminals; see shell-marks.ts in Rho-plugins.\n' + text, { mode: 0o600 });
    const own = env.ZDOTDIR;
    return { args: ['-l'], env: { ZDOTDIR: dir, RHO_USER_ZDOTDIR: own || env.HOME || '', ...(own ? { RHO_ZDOTDIR_SET: '1' } : {}), RHO_HISTFILE: path.join(history, 'zsh_history'), RHO_TERMINAL_NONCE: nonce } };
  }
  const file = path.join(folder, 'bash-init.sh');
  await fs.writeFile(file, '# Written by Rho for its terminals; see shell-marks.ts in Rho-plugins.\n' + bashInit, { mode: 0o600 });
  return { args: ['--init-file', file, '-i'], env: { RHO_HISTFILE: path.join(history, 'bash_history'), RHO_TERMINAL_NONCE: nonce } };
}
