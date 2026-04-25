# launch-oci-vm.ps1
# Polite retry loop that creates an Always Free OCI VM,
# cycling through ADs and falling back to E2.1.Micro after a few A1.Flex attempts.
#
# Required PowerShell session variables:
#   $compartment, $subnet, $imageArm, $imageX86

param(
    [string]$VmName    = "awards-sidecar",
    [string]$SshKeyPub = "C:\Users\Tejas\past-awards-dashboard\keys\oracle\ssh-key-2026-04-23.key.pub",
    [int]   $MaxArmAttempts = 6,
    [int]   $RetryDelaySec  = 90
)

foreach ($v in 'compartment','subnet','imageArm','imageX86') {
    if (-not (Get-Variable -Name $v -ErrorAction SilentlyContinue).Value) {
        Write-Host "ERROR: `$$v not set. Run the OCID discovery block first." -ForegroundColor Red
        exit 1
    }
}
if (-not (Test-Path $SshKeyPub)) {
    Write-Host "ERROR: SSH public key not found at $SshKeyPub" -ForegroundColor Red
    exit 1
}

$ads = @(
    "DzpV:US-ASHBURN-AD-1",
    "DzpV:US-ASHBURN-AD-2",
    "DzpV:US-ASHBURN-AD-3"
)

function Try-Launch {
    param(
        [string]$Shape,
        [string]$Image,
        [string]$Ad,
        [string]$ShapeConfigJson
    )
    $argsList = @(
        "compute", "instance", "launch",
        "--compartment-id", $compartment,
        "--availability-domain", $Ad,
        "--subnet-id", $subnet,
        "--image-id", $Image,
        "--shape", $Shape,
        "--display-name", $VmName,
        "--assign-public-ip", "true",
        "--ssh-authorized-keys-file", $SshKeyPub,
        "--wait-for-state", "RUNNING"
    )
    $tmpFile = $null
    if ($ShapeConfigJson) {
        # OCI CLI on Windows mangles inline JSON because of cmd.exe arg parsing.
        # Write the JSON to a temp file and pass file:// URI instead.
        $tmpFile = [System.IO.Path]::GetTempFileName()
        $ShapeConfigJson | Set-Content -Path $tmpFile -NoNewline -Encoding ASCII
        $argsList += "--shape-config"
        $argsList += "file://$tmpFile"
    }
    try {
        $output = & oci @argsList 2>&1
        return @{ exitCode = $LASTEXITCODE; output = ($output | Out-String) }
    } finally {
        if ($tmpFile -and (Test-Path $tmpFile)) { Remove-Item $tmpFile -Force }
    }
}

# --- A1.Flex retry loop ---
for ($i = 1; $i -le $MaxArmAttempts; $i++) {
    $ad = $ads[($i - 1) % $ads.Count]
    $now = [DateTime]::Now.ToString('HH:mm:ss')
    Write-Host "[$now] attempt $i - A1.Flex (1 OCPU, 6 GB) in $ad ..." -ForegroundColor Cyan
    $r = Try-Launch -Shape "VM.Standard.A1.Flex" -Image $imageArm -Ad $ad -ShapeConfigJson '{"ocpus":1,"memoryInGBs":6}'
    if ($r.exitCode -eq 0) {
        Write-Host ""
        Write-Host "OK: A1.Flex instance is RUNNING" -ForegroundColor Green
        Write-Host $r.output
        exit 0
    }
    if ($r.output -match "OutOfCapacity|capacity|LimitExceeded|TooManyRequests") {
        Write-Host "  capacity issue - sleeping ${RetryDelaySec}s ..." -ForegroundColor Yellow
        Start-Sleep -Seconds $RetryDelaySec
    } else {
        Write-Host "  unexpected error:" -ForegroundColor Red
        Write-Host $r.output
        exit 1
    }
}

# --- Fallback: E2.1.Micro (AMD x86) ---
$now = [DateTime]::Now.ToString('HH:mm:ss')
Write-Host ""
Write-Host "[$now] A1.Flex unavailable - falling back to E2.1.Micro" -ForegroundColor Yellow
foreach ($ad in $ads) {
    Write-Host "  trying E2.1.Micro in $ad ..." -ForegroundColor Cyan
    $r = Try-Launch -Shape "VM.Standard.E2.1.Micro" -Image $imageX86 -Ad $ad -ShapeConfigJson ""
    if ($r.exitCode -eq 0) {
        Write-Host ""
        Write-Host "OK: E2.1.Micro instance is RUNNING" -ForegroundColor Green
        Write-Host $r.output
        exit 0
    }
    Start-Sleep -Seconds 30
}

Write-Host ""
Write-Host "FAILED: All shapes / ADs exhausted. Try a different region or wait." -ForegroundColor Red
exit 2
