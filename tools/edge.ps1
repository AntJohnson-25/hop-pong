# Start (or restart) a headless Edge with software WebGL and DevTools on a port,
# for tools/shot.js. A throwaway profile, and the flags that stop a fresh Edge
# profile from signing in to the user's Microsoft account and syncing.
#   powershell -File tools\edge.ps1            # start on 9333
#   powershell -File tools\edge.ps1 -Stop      # stop it
#   powershell -File tools\edge.ps1 -Gpu       # real GPU (D3D11) instead of SwiftShader: ~10x faster for tools/record.js
param([int]$Port = 9333, [switch]$Stop, [switch]$Gpu)

# One profile per port, so two instances can run side by side.
$profileDir = Join-Path $env:TEMP "hk-edge-profile-$Port"
Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
  Where-Object { $_.CommandLine -like "*hk-edge-profile-$Port*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($Stop) { return }

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$edgeArgs = @(
  "--headless=new", "--remote-debugging-port=$Port", "--user-data-dir=$profileDir",
  $(if ($Gpu) { "--use-angle=d3d11" } else { "--use-angle=swiftshader" }), "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--disable-sync", "--disable-extensions", "--disable-features=msImplicitSignin",
  "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files",
  "--autoplay-policy=no-user-gesture-required", "about:blank"
)
Start-Process -FilePath $edge -ArgumentList $edgeArgs -WindowStyle Hidden
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  try { $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json/version" -TimeoutSec 1; "edge ready on $Port"; return } catch { }
}
"edge did not come up on $Port"
