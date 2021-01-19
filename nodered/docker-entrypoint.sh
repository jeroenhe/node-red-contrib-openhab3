#!/usr/bin/env bash

# Install or update the node-red-contrib-openhab2 plugin
npm install --no-audit --no-update-notifier --no-fund --save --save-prefix=~ --production /node-red-contrib-openhab2

# Start the original bootstrapper script
exec npm start --cache /data/.npm -- --userDir /data "$@"