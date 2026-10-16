<#
  卫戍协议：盟约 · 用 Docker 在本机开服，给同一 Wi-Fi / 局域网的设备玩（Windows）。文档：docs\DEPLOY.md 第 3 节
  运行：双击 scripts\start-docker-lan.bat，或
        powershell -ExecutionPolicy Bypass -File scripts\start-docker-lan.ps1 [-Port 3001] [-Assets] [-NoFirewall] [-Stop]
  需要 Docker Desktop（Linux 容器）和源码目录（git clone；整合包没有 Dockerfile），本机不需要 Node.js。
    1. Docker 引擎没有运行时启动 Docker Desktop
    2. 首次（或 -Assets）：用 node:22-alpine 容器把素材下载到 public\assets（tools\fetch-assets.mjs；和 setup 一样，
       会重写 data\assets.json）
    3. 构建镜像（有缓存：git pull 之后只重建改动的部分）
    4. 替换容器 stronghold-lan：端口 → 3000，素材只读挂载，插件在卷 stronghold-plugins；没指定 -Port 而默认端口
       被占用时，自动改用下一个空闲端口
    5. 第一次为端口添加防火墙规则（弹一次管理员授权；-NoFirewall 跳过），列出局域网地址，打开浏览器
       （SP_NO_BROWSER=1 不打开）
  关闭窗口不会停止服务器：再运行一次本脚本（替换容器）或加 -Stop 停止。
  cmd.exe 在 chcp 65001 下会读错含中文的 .bat 行，所以逻辑放在这里，.bat 只负责启动 PowerShell。
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [int]$Port = 0,
  [switch]$Assets,
  [switch]$NoFirewall,
  [switch]$Stop
)
$ErrorActionPreference = 'Continue'   # native tools report through $LASTEXITCODE
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
try { $Host.UI.RawUI.WindowTitle = '卫戍协议：盟约 - Docker 局域网服务器' } catch { }

# ---- 设置 settings ------------------------------------------------------------------------------------------------
$DefaultPort = 3000
# 同盟不计时（README 的 SP_UNTIMED）；'' = 官方计时
$Untimed = '1'
# 最终攻势获胜必进隐秘核心（README 的 SP_HIDDEN_CORE）；'' = 官方的盟约层数 / 生命值条件
$HiddenCore = 'always'
$Image = 'stronghold-protocol:local'
$Name = 'stronghold-lan'
# -------------------------------------------------------------------------------------------------------------------

$Interactive = -not [Console]::IsInputRedirected

function Pause-Exit([int]$code) {
  if ($Interactive) {
    Write-Host ''
    Read-Host '按回车键关闭窗口 / Press Enter to close' | Out-Null
  }
  exit $code
}

function Fail([string]$msg) {
  Write-Host ''
  Write-Host $msg -ForegroundColor Red
  Pause-Exit 1
}

function Test-Engine {
  docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Test-PortBusy([int]$p) {
  return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

function Get-PortOwner([int]$p) {
  $c = docker ps --filter "publish=$p" --format '{{.Names}}' 2> $null | Select-Object -First 1
  if ($c) { return "Docker 容器 $c" }
  $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) { return "程序 $($proc.ProcessName)" }
  }
  return '其他程序'
}

function Add-FirewallRule([int]$p) {
  $rule = "StrongholdProtocol-Docker-$p"
  if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) { return }
  Write-Host "[防火墙] 允许局域网访问端口 $p（会弹出一次管理员授权）..."
  $netshArgs = @('advfirewall', 'firewall', 'add', 'rule', "name=$rule", 'dir=in', 'action=allow', 'protocol=TCP', "localport=$p", 'profile=private,domain')
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($admin) { & netsh @netshArgs | Out-Null }
  else { try { Start-Process -FilePath netsh -ArgumentList $netshArgs -Verb RunAs -Wait -WindowStyle Hidden } catch { } }
  if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
    Write-Host '[防火墙] 没有添加规则，其他设备可能连不上。可在管理员命令提示符里运行：' -ForegroundColor Yellow
    Write-Host "    netsh $($netshArgs -join ' ')"
  }
}

function Stop-Server {
  # docker stop: SIGTERM, the server closes its rooms (room.closed shutdown) before it exits
  docker stop -t 10 $Name *> $null
  docker rm -f $Name *> $null
  Write-Host '服务器已停止 Server stopped.'
}

# ---- Docker -------------------------------------------------------------------------------------------------------
$dockerBin = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $dockerBin 'docker.exe'))) {
  $env:Path = "$dockerBin;$env:Path"   # installed, but this session's PATH predates it
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host '未找到 Docker。Docker not found.' -ForegroundColor Red
  Write-Host '  安装 Docker Desktop：winget install Docker.DockerDesktop   或   https://www.docker.com/products/docker-desktop/'
  Write-Host '  安装后重启电脑、打开一次 Docker Desktop 完成初始设置，再重新双击本脚本。'
  Write-Host '  不想用 Docker 时可直接双击 start-windows.bat（需要 Node.js）。'
  Pause-Exit 1
}
if (-not (Test-Engine)) {
  $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $desktop)) { Fail 'Docker 引擎没有运行：请手动打开 Docker Desktop，等显示 Engine running 后再重新运行本脚本。' }
  Write-Host '[Docker] 正在启动 Docker Desktop，最多等待 2 分钟...'
  Start-Process -FilePath $desktop
  $deadline = (Get-Date).AddMinutes(2)
  while (-not (Test-Engine)) {
    if ((Get-Date) -gt $deadline) { Fail 'Docker 引擎 2 分钟内没有启动：请打开 Docker Desktop，等显示 Engine running 后再重新运行本脚本。' }
    Start-Sleep -Seconds 3
  }
}
$osType = docker info --format '{{.OSType}}' 2> $null
if ($osType -ne 'linux') { Fail 'Docker Desktop 现在是 Windows 容器模式：在任务栏的 Docker 图标上右键，选 Switch to Linux containers 后重试。' }

if ($Stop) { Stop-Server; Pause-Exit 0 }

if (-not (Test-Path 'Dockerfile')) { Fail '没有 Dockerfile：本脚本需要源码目录（git clone）。整合包请直接双击 start-windows.bat。' }

# ---- 素材 art -----------------------------------------------------------------------------------------------------
if ($Assets -or -not (Test-Path 'public\assets')) {
  Write-Host ''
  Write-Host '[素材] 下载游戏素材到 public\assets（首次约 720 MB、约 10 分钟；可中断，再次运行加 -Assets 续传）...'
  docker run --rm -v "${Root}:/app" -v stronghold-fetch-modules:/app/node_modules -w /app node:22-alpine sh -c 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node tools/fetch-assets.mjs'
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[素材] 有文件没有下载成功：游戏照常运行，缺的图片用占位图。之后可加 -Assets 再运行一次补齐。' -ForegroundColor Yellow
  }
}

# ---- 镜像 image ---------------------------------------------------------------------------------------------------
Write-Host ''
Write-Host "[镜像] 构建 $Image ..."
docker build -t $Image .
if ($LASTEXITCODE -ne 0) { Fail '镜像构建失败，请查看上面的错误信息。Image build failed - see the messages above.' }

# ---- 容器 container -----------------------------------------------------------------------------------------------
docker rm -f $Name *> $null   # the previous run's container frees its port first
$explicit = $Port -gt 0
if (-not $explicit) { $Port = $DefaultPort }
if (Test-PortBusy $Port) {
  $owner = Get-PortOwner $Port
  if ($explicit) { Fail "端口 $Port 已被 $owner 占用，请换一个：-Port $($Port + 1)" }
  $free = ($DefaultPort + 1)..($DefaultPort + 99) | Where-Object { -not (Test-PortBusy $_) } | Select-Object -First 1
  if (-not $free) { Fail "端口 $DefaultPort 已被 $owner 占用，附近也没有空闲端口：请用 -Port 指定一个。" }
  Write-Host "[端口] $DefaultPort 已被 $owner 占用，改用 $free（想固定地址可加 -Port $free）。" -ForegroundColor Yellow
  $Port = $free
}
Write-Host ''
Write-Host "[启动] 容器 $Name，端口 $Port ..."
docker run -d --name $Name -p "${Port}:3000" -e "SP_UNTIMED=$Untimed" -e "SP_HIDDEN_CORE=$HiddenCore" `
  -v "${Root}\public\assets:/app/public/assets:ro" -v stronghold-plugins:/app/plugins $Image | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "容器启动失败（端口 $Port）：请查看上面的错误信息，或用 -Port 换一个端口。" }

if (-not $NoFirewall) { Add-FirewallRule $Port }

$up = $false
$deadline = (Get-Date).AddSeconds(60)
while (-not $up -and (Get-Date) -lt $deadline) {
  try { $up = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://localhost:$Port/healthz").StatusCode -eq 200 } catch { Start-Sleep -Seconds 2 }
}
if (-not $up) {
  Write-Host '[启动] 服务器 60 秒内没有响应，最近日志：' -ForegroundColor Yellow
  docker logs --tail 30 $Name
}

# ---- 地址 addresses -----------------------------------------------------------------------------------------------
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker|VirtualBox|VMware' }
Write-Host ''
Write-Host ('=' * 80)
Write-Host '  服务器已启动 Server is running' -ForegroundColor Green
Write-Host "  本机 This PC:   http://localhost:$Port"
Write-Host '  同一 Wi-Fi 的设备 Devices on the same Wi-Fi:'
if ($ips) { foreach ($ip in $ips) { Write-Host ("      http://{0}:{1}      {2}" -f $ip.IPAddress, $Port, $ip.InterfaceAlias) -ForegroundColor Cyan } }
else { Write-Host '      （没有找到局域网地址：请确认本机已连接 Wi-Fi / 网线）' -ForegroundColor Yellow }
Write-Host "  不计时 SP_UNTIMED=$Untimed   隐秘核心 SP_HIDDEN_CORE=$HiddenCore"
Write-Host ('=' * 80)
$publicNets = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object NetworkCategory -eq 'Public')
if ($publicNets.Count) {
  Write-Host ''
  Write-Host '[网络] 当前网络是「公用网络」：Windows 会拦截其他设备的连接。改成专用网络（设置 → 网络和 Internet →' -ForegroundColor Yellow
  Write-Host '       属性 → 网络配置文件类型 → 专用），或在管理员 PowerShell 里运行：' -ForegroundColor Yellow
  foreach ($net in $publicNets) { Write-Host ('       Set-NetConnectionProfile -InterfaceAlias "{0}" -NetworkCategory Private' -f $net.InterfaceAlias) }
}
if ($env:SP_NO_BROWSER -ne '1') { Start-Process "http://localhost:$Port" }

if (-not $Interactive) { exit 0 }   # started from a script: leave the server running
while ($true) {
  Write-Host ''
  Write-Host '  [S] 停止服务器并退出 Stop    [L] 查看最近日志 Logs    [Q] 关闭窗口，服务器继续运行 Leave running'
  $k = Read-Host '请选择 S / L / Q'
  if ($null -eq $k) { exit 0 }
  switch -regex ($k.Trim()) {
    '^[sS]' { Stop-Server; exit 0 }
    '^[lL]' { docker logs --tail 40 $Name }
    '^[qQ]' { exit 0 }
  }
}
