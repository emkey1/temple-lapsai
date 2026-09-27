#!/bin/bash
# Temple Lapsai — double-click this file to play.
# It starts the little local server and opens the game in your browser.
# Closing this Terminal window stops the game.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Temple Lapsai needs Node.js to run, and it is not installed."
  echo "Install the LTS build from https://nodejs.org and run this again."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

PORT="${PORT:-8080}"
echo "Starting Temple Lapsai on http://localhost:$PORT ..."
( sleep 1; open "http://localhost:$PORT" >/dev/null 2>&1 ) &
exec node server.js
