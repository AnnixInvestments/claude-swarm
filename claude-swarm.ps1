if (-not (Test-Path "dist\bin.js")) {
  npm run build
}
node dist\bin.js
