# ===========================================================
#  立绘构建：images/ 里的原图 → assets/cast/ 的网页版
#      powershell -File tools/build-cast.ps1
#  -----------------------------------------------------------
#  images/ 里放的是原始大图（1344x1792 PNG，单张 2-3MB）。
#  直接上线会让页面卡死，所以要压到 720x960 的 JPEG。
#  映射按"文件名里的性格描述"匹配角色，改映射就改下面的 $map。
# ===========================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root 'images'
$outDir = Join-Path $root 'assets\cast'

if (-not (Test-Path $srcDir)) {
  Write-Host "找不到 $srcDir —— 请把原始人像图放进 images/ 目录" -ForegroundColor Red
  exit 1
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# 文件名关键词 → 输出 key（key 规则：角色_性别）
#   wan/xia/gu = 苏晚/林知夏/顾清和（有男女两版）
#   chiang = 江迟（固定男）   zheng = 郑维（固定男，反派）
$map = [ordered]@{
  '冰蓝长发冰雪法师' = 'wan_f'      # 苏晚·女  克制、压抑情绪、清冷疏离、会推开对方
  '银白发冷峻赛博'   = 'wan_m'      # 苏晚·男  外冷内热、不擅表达、用行动保护
  '绿发精灵弓箭手'   = 'xia_f'      # 林知夏·女 灵动真诚、情绪直接
  '橙发校园风热血'   = 'xia_m'      # 林知夏·男 开朗真诚、情绪写在脸上、直球
  '黑发中华风幻想'   = 'gu_f'       # 顾清和·女 聪明独立、有分寸、外柔内刚
  '白发机甲飞行员'   = 'gu_m'       # 顾清和·男 自律、独自承担压力
  '金发贵族骑士'     = 'chiang_m'   # 江迟     正直、道德洁癖、主动守护
  '黑金长发暗黑和风' = 'zheng_m'    # 郑维     强势、目标感极强、表面危险
  '粉发双马尾甜酷'   = 'spare_f1'   # 备用
  '紫发哥特暗黑'     = 'spare_f2'   # 备用
}

$W = 720; $H = 960; $Q = 84

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
         Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality, [long]$Q)

$totalIn = 0; $totalOut = 0; $n = 0
foreach ($f in Get-ChildItem (Join-Path $srcDir '*.png')) {
  $key = $null
  foreach ($k in $map.Keys) { if ($f.BaseName -like "*$k*") { $key = $map[$k]; break } }
  if (-not $key) { Write-Host "  跳过（无映射）: $($f.Name)" -ForegroundColor Yellow; continue }

  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($img, 0, 0, $W, $H)
  $g.Dispose()

  $out = Join-Path $outDir "$key.jpg"
  $bmp.Save($out, $codec, $ep)
  $bmp.Dispose(); $img.Dispose()

  $inKB  = [math]::Round($f.Length / 1KB)
  $outKB = [math]::Round((Get-Item $out).Length / 1KB)
  $totalIn += $f.Length; $totalOut += (Get-Item $out).Length; $n++
  Write-Host ("  {0,-10} {1,7}K → {2,5}K" -f $key, $inKB, $outKB)
}
Write-Host ""
Write-Host ("共 {0} 张：{1} MB → {2} MB" -f $n, [math]::Round($totalIn/1MB,1), [math]::Round($totalOut/1MB,2)) -ForegroundColor Green
Write-Host "输出目录：assets/cast/"
