#!/bin/sh
# Tabherd, on macOS and Linux: opens the dashboard, starting its server in the
# background if it isn't running. The server stops by itself 10 minutes after
# the last dashboard closes.
#
#   tabherd               open the dashboard
#   tabherd --install     add Tabherd to the applications menu, or ~/Applications
#                         on macOS, and a `tabherd` command in ~/.local/bin
#   tabherd --uninstall   remove them again
#
# A release has this file beside server.js, as `tabherd`, with Node in node/.

# Where this script really is, through any links to it.
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname "$self")/$link ;;
  esac
done
here=$(cd "$(dirname "$self")" && pwd)
# Run from the source, it's in launcher/, one folder down.
[ -f "$here/server.js" ] || here=$(dirname "$here")

# The Node in a release, else the one on the PATH.
node="$here/node/bin/node"
if [ ! -x "$node" ]; then
  node=$(command -v node) || {
    echo "Tabherd needs Node.js 18 or later. Install it from nodejs.org, or download a release of Tabherd that includes it." >&2
    exit 1
  }
fi

case "$1" in
  --install | --uninstall) exec "$node" "$here/scripts/desktop-entry.js" "$1" "$self" ;;
esac

# With --open, a server that's already running is opened rather than started
# again.
nohup "$node" "$here/server.js" --open --exit-when-idle > /dev/null 2>&1 &
