# Acceso a móviles conectados por cable (MTP/PTP: Android y iPhone) mediante Shell.Application.
# Modo list : devuelve JSON con los dispositivos portátiles.
# Modo copy : copia las fotos más recientes de DCIM/Pictures al destino, emitiendo una línea JSON por archivo.
param(
  [string]$Mode = 'list',
  [string]$Device = '',
  [string]$Dest = '',
  [int]$Max = 300
)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$shell = New-Object -ComObject Shell.Application
$pc = $shell.Namespace(17)

function Get-Devices {
  # En "Este equipo" los móviles aparecen como carpetas que no son del sistema de archivos.
  @($pc.Items() | Where-Object { $_.IsFolder -and -not $_.IsFileSystem })
}

if ($Mode -eq 'list') {
  $list = @(Get-Devices | ForEach-Object { @{ name = $_.Name } })
  ConvertTo-Json -InputObject $list -Compress
  exit 0
}

$dev = Get-Devices | Where-Object { $_.Name -eq $Device } | Select-Object -First 1
if (-not $dev) { Write-Output '{"error":"Dispositivo no encontrado. Desbloquea el móvil y elige \"Transferir archivos\"."}'; exit 1 }

$imgExt = '\.(jpe?g|png|heic|heif|webp|dng)$'
$photoFolders = '^(DCIM|Pictures|Imágenes|Imagenes|Camera|WhatsApp|WhatsApp Images|Download|Screenshots)$'
$found = New-Object System.Collections.ArrayList

function Walk($folder, $depth, $inside) {
  if ($depth -gt 7) { return }
  foreach ($it in $folder.GetFolder.Items()) {
    if ($it.IsFolder) {
      $enter = $inside -or ($it.Name -match $photoFolders) -or ($depth -le 1)
      if ($enter) { Walk $it ($depth + 1) ($inside -or ($it.Name -match $photoFolders)) }
    } elseif ($inside -and $it.Name -match $imgExt) {
      [void]$found.Add($it)
    }
  }
}

Walk $dev 0 $false
if ($found.Count -eq 0) { Write-Output '{"error":"No se han encontrado fotos. En el móvil, permite el acceso a los archivos (Transferir archivos / Confiar en este ordenador)."}'; exit 1 }

$sorted = $found | Sort-Object -Property ModifyDate -Descending | Select-Object -First $Max
$destNs = $shell.Namespace($Dest)
$total = @($sorted).Count
Write-Output (ConvertTo-Json -Compress @{ total = $total })
$i = 0
foreach ($it in $sorted) {
  $i++
  $name = $it.Name
  $target = Join-Path $Dest $name
  if (-not (Test-Path -LiteralPath $target)) {
    $destNs.CopyHere($it, 4 + 16 + 1024)
    $wait = 0
    # CopyHere es asíncrono con MTP: esperar a que el archivo aparezca y deje de crecer.
    while ($wait -lt 600) {
      Start-Sleep -Milliseconds 100; $wait++
      $f = Get-ChildItem -LiteralPath $Dest -Filter ($name + '*') | Select-Object -First 1
      if ($f -and $f.Length -gt 0) {
        $s1 = $f.Length; Start-Sleep -Milliseconds 150; $f.Refresh()
        if ($f.Length -eq $s1) { $target = $f.FullName; break }
      }
    }
  }
  Write-Output (ConvertTo-Json -Compress @{ done = $i; total = $total; file = $target })
}
exit 0
