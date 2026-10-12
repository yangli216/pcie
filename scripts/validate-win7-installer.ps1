param(
  [Parameter(Mandatory = $true)][string]$BundlePath,
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$Report
)
$ErrorActionPreference = 'Stop'
$installers = @(Get-ChildItem -LiteralPath $BundlePath -File -Filter '*.msi')
if ($installers.Count -ne 1) { throw 'Expected exactly one Win7 MSI from this build.' }
$extractionPath = Join-Path ([System.IO.Path]::GetTempPath()) ('pcie-win7-imports-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $extractionPath | Out-Null
$logPath = Join-Path $extractionPath 'msi-extraction.log'
# Administrative extraction does not install or launch the application.
$arguments = '/a "' + $installers[0].FullName + '" /qn /norestart TARGETDIR="' + $extractionPath + '" /l*v "' + $logPath + '"'
$process = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList $arguments -Wait -PassThru
if ($process.ExitCode -ne 0) {
  Get-Content -LiteralPath $logPath -Tail 60
  throw "Win7 MSI administrative extraction failed: $($process.ExitCode)"
}
node "$PSScriptRoot/validate-win7-imports.mjs" --directory "$extractionPath" --executable "$Executable" --report "$Report"
if ($LASTEXITCODE -ne 0) { throw 'Installed Win7 PE compatibility gate failed.' }
