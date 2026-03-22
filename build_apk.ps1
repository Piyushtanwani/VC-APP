$ErrorActionPreference = "Stop"
$sdkDir = "$env:LOCALAPPDATA\Android\Sdk"

Write-Host "Setting up Android SDK in $sdkDir"
if (-not (Test-Path "$sdkDir\cmdline-tools\latest\bin\sdkmanager.bat")) {
    Write-Host "Downloading command line tools..."
    Invoke-WebRequest -Uri "https://dl.google.com/android/repository/commandlinetools-win-11479570_latest.zip" -OutFile "sdk.zip"
    
    if (Test-Path "$sdkDir\cmdline-tools") { Remove-Item -Recurse -Force "$sdkDir\cmdline-tools" }
    New-Item -ItemType Directory -Force -Path "$sdkDir\cmdline-tools" | Out-Null
    
    Write-Host "Extracting tools..."
    Expand-Archive -Path "sdk.zip" -DestinationPath "$sdkDir\cmdline-tools" -Force
    Rename-Item -Path "$sdkDir\cmdline-tools\cmdline-tools" -NewName "latest"
    Remove-Item "sdk.zip" -ErrorAction SilentlyContinue
}

$env:ANDROID_HOME = $sdkDir
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdkDir, "User")

Write-Host "Accepting all Android licenses..."
$yes = "y`n" * 100
$yes | & "$sdkDir\cmdline-tools\latest\bin\sdkmanager.bat" --licenses > $null

Write-Host "Building APK via Gradle..."
Set-Location "d:\VC APP\frontend\android"
.\gradlew assembleDebug --no-daemon

Write-Host "Build Complete!"
