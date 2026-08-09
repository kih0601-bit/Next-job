param(
  [string]$Repo = "kih0601-bit/Next-job",
  [string]$DownloadDir = ".\next-job-actions-results"
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "GitHub CLI(gh)가 설치되어 있지 않습니다. 이 Helper는 아무 것도 설치하지 않습니다." -ForegroundColor Yellow
  Write-Host "개인 PC에서 GitHub CLI 설치/로그인 후 다시 실행하세요. 약국/공용 PC에서는 웹 방식 사용을 권장합니다."
  exit 2
}
$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "GitHub CLI 로그인이 필요합니다: gh auth login" -ForegroundColor Yellow
  exit 3
}
$runJson = gh run list --repo $Repo --workflow "Update job postings" --limit 1 --json databaseId,status,conclusion,url,createdAt,updatedAt
$run = $runJson | ConvertFrom-Json | Select-Object -First 1
if (-not $run) { throw "최근 Actions run을 찾지 못했습니다." }
Write-Host "Run: $($run.databaseId)  status=$($run.status)  conclusion=$($run.conclusion)"
Write-Host "URL: $($run.url)"
if ($run.status -ne "completed") {
  Write-Host "완료될 때까지 기다립니다..."
  gh run watch $run.databaseId --repo $Repo --exit-status
}
$target = Join-Path $DownloadDir ("run-" + $run.databaseId)
New-Item -ItemType Directory -Force -Path $target | Out-Null
gh run download $run.databaseId --repo $Repo --dir $target
Write-Host "Artifact 저장 완료: $target" -ForegroundColor Green
Write-Host "저장소 최신 전체 ZIP과 함께 ChatGPT에 올리면 브리핑할 수 있습니다."
