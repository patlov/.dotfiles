# Homebrew (Apple Silicon and Intel macOS)
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"

# zsh-syntax-highlighting should remain last.
plugins=(git poetry zsh-autosuggestions zsh-syntax-highlighting)

[[ -s "$ZSH/oh-my-zsh.sh" ]] && source "$ZSH/oh-my-zsh.sh"

export NVM_DIR="$HOME/.nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"
[[ -s "$NVM_DIR/bash_completion" ]] && source "$NVM_DIR/bash_completion"

export PATH="$HOME/.local/bin:$PATH"

# Optional local development environments.
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"
[[ -d "$HOME/.rbenv/bin" ]] && export PATH="$HOME/.rbenv/bin:$PATH"
[[ -d "$HOME/.rvm/bin" ]] && export PATH="$PATH:$HOME/.rvm/bin"

if [[ -d "$HOME/Library/Android/sdk" ]]; then
  export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
  export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator"
fi

alias cnv='git commit --no-verify'
alias pp='git push'
alias gc='git checkout'
alias p='git pull'
alias gcb='git checkout -b'
alias gs='git stash'
alias gsd='git stash drop'
alias gsp='git stash pop'
alias gm='git merge'
alias upd='brew update && brew upgrade'
alias gfa='f() { git fetch origin "$1" && git switch -c "$1" FETCH_HEAD; }; f'
alias gfb='f() { git fetch origin "$1" || return; if git show-ref --verify --quiet "refs/heads/$1"; then git switch "$1"; else git switch -c "$1" FETCH_HEAD; fi; git config "branch.$1.remote" origin; git config "branch.$1.merge" "refs/heads/$1"; }; f'
alias bdev="cd ~/Documents/askLio/backend/"
alias fdev="cd ~/Documents/askLio/frontend/"
alias rbe="uv run python main.py"
alias rfe="npm run dev"
alias whatsmyip="ifconfig -l | xargs -n1 ipconfig getifaddr"

if [ -f "$HOME/Downloads/google-cloud-sdk/path.zsh.inc" ]; then . "$HOME/Downloads/google-cloud-sdk/path.zsh.inc"; fi
if [ -f "$HOME/Downloads/google-cloud-sdk/completion.zsh.inc" ]; then . "$HOME/Downloads/google-cloud-sdk/completion.zsh.inc"; fi
