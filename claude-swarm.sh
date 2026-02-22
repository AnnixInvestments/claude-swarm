#!/usr/bin/env bash
[ -f dist/bin.js ] || npm run build
node dist/bin.js
