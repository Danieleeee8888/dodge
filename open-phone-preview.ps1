param(
  [int]$Port = 8765,
  # Dimensioni indicative viewport portrait (simile a iPhone ~390×844 CSS px)
  [int]$Width = 390,
  [int]$Height = 844
)

$url = "http://127.0.0.1:$Port/"
Start-Sleep -Seconds 1

$launchArgs = @(
  "--window-size=${Width},${Height}",
  "--window-position=80,40",
  "--app=$url"
)

$pfx86 = ${env:ProgramFiles(x86)}
$chrome = Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
  $chrome = Join-Path $pfx86 "Google\Chrome\Application\chrome.exe"
}
if (Test-Path $chrome) {
  Start-Process -FilePath $chrome -ArgumentList $launchArgs
  exit 0
}

$edge = Join-Path $pfx86 "Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) {
  $edge = Join-Path ${env:ProgramFiles} "Microsoft\Edge\Application\msedge.exe"
}
if (Test-Path $edge) {
  Start-Process -FilePath $edge -ArgumentList $launchArgs
  exit 0
}

Start-Process $url
