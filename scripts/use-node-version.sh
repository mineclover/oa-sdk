#!/usr/bin/env bash
# Source this file so nvm can change the current shell's Node.js version:
#   source scripts/use-node-version.sh stable
#   source scripts/use-node-version.sh node26

lane="${1:-stable}"
case "$lane" in
  stable) version_file=".nvmrc" ;;
  node26|latest) version_file=".nvmrc.latest" ;;
  *)
    printf 'Usage: source scripts/use-node-version.sh [stable|node26]\n' >&2
    return 2 2>/dev/null || exit 2
    ;;
esac

if ! command -v nvm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    printf 'nvm is not installed. Install it, then source this script again.\n' >&2
    return 1 2>/dev/null || exit 1
  fi
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

if [ ! -f "$version_file" ]; then
  printf 'Missing Node.js version file: %s\n' "$version_file" >&2
  return 1 2>/dev/null || exit 1
fi

nvm use "$(tr -d '[:space:]' < "$version_file")"
