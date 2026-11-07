#Requires -Version 5.1
# Starts APISIX, Keycloak (with users), Coraine with its Mongo + Timescale databases, and the @context httpd.
# Windows/PowerShell port of the `services` bash script.

Set-Location $PSScriptRoot

$Usage = 'usage: services [start [coraine]|stop|reset|status|upload [Schema...]|subscribe-inference [--dry-run]|clear-uploads]'

# Equivalent of `set -a; source .env; set +a`
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        if ($line -match '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value -match '^"(.*)"$') { $value = $Matches[1] }
            elseif ($value -match "^'(.*)'$") { $value = $Matches[1] }
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

$Network = "$($env:COMPOSE_PROJECT_NAME)_default"

# Equivalent of `set -e` for native commands
function Test-Exit {
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Wait-Healthy($Name, $Container) {
    Write-Host -NoNewline "Waiting for $Name "
    while ($true) {
        $status = docker inspect --format '{{.State.Health.Status}}' $Container 2>$null
        if ("$status".Trim() -eq 'healthy') { break }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 5
    }
    Write-Host ' done'
}

function Wait-ForCoraine {
    Write-Host -NoNewline 'Waiting for Coraine '
    while ($true) {
        $code = docker run --network $Network --rm "quay.io/curl/curl:$($env:CURL_VERSION)" `
            -s -o /dev/null -w '%{http_code}' http://coraine:1026/admin/health 2>$null
        if ("$code".Trim() -eq '200') { break }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 5
    }
    Write-Host ' done'
}

function Import-Users {
    docker run --rm `
        --network $Network `
        -v "$PSScriptRoot\import_users:/import_users" `
        -e KEYCLOAK_HOST=keycloak `
        -e KEYCLOAK_PORT=8080 `
        --entrypoint /bin/sh `
        python:3-alpine -c 'apk add --no-cache curl && /import_users'
    Test-Exit
}

function Clear-Uploads {
    $dir = 'data-loader/uploads'
    if (Test-Path $dir) {
        Get-ChildItem $dir -Force | Where-Object { $_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force
    }
    Write-Host 'Cleared data-loader/uploads'
}

$command = if ($args.Count -gt 0) { $args[0] } else { '' }
$rest = @($args | Select-Object -Skip 1)

switch ($command) {
    'start' {
        if ($rest.Count -gt 0 -and $rest[0] -eq 'coraine') {
            docker compose up -d coraine; Test-Exit
			Wait-ForCoraine
            Write-Host "Coraine (direct):   http://localhost:$($env:CORAINE_PORT)"
            Write-Host "Contexts:           http://localhost:$($env:CONTEXT_PORT)/user-context.jsonld"
            exit 0
        }
        docker compose up -d; Test-Exit
        Wait-Healthy 'Keycloak' 'apetit-keycloak'
        Import-Users
        Wait-Healthy 'APISIX' 'apetit-apisix'
        Wait-ForCoraine
        Write-Host "Coraine (direct):   http://localhost:$($env:CORAINE_PORT)"
        Write-Host "Contexts:           http://localhost:$($env:CONTEXT_PORT)/user-context.jsonld"
        Write-Host "Coraine (secured):  http://localhost:$($env:APISIX_EXPOSED_PORT)/coraine/ngsi-ld/v1/entities"
        Write-Host "Keycloak:           http://localhost:$($env:KEYCLOAK_PORT) (admin / 1234)"
    }
    'stop' {
        docker compose down; Test-Exit
        Clear-Uploads
    }
    'reset' {
        docker compose down -v; Test-Exit
    }
    'status' {
        docker compose ps; Test-Exit
    }
    'upload' {
        # Turn existing relative paths into absolute ones, since we cd into data-loader
        $resolved = @()
        foreach ($a in $rest) {
            if (Test-Path -LiteralPath $a) { $a = (Resolve-Path -LiteralPath $a).Path }
            $resolved += $a
        }
        Push-Location data-loader
        try {
            npm run --silent load -- @resolved; Test-Exit
            npm run --silent prettier | Out-Null
        }
        finally {
            Pop-Location
        }
    }
    'subscribe-inference' {
        Push-Location data-loader
        try { npm run --silent subscribe:inference -- @rest; Test-Exit }
        finally { Pop-Location }
    }
    'clear-uploads' {
        Clear-Uploads
    }
    default {
        Write-Host $Usage
        exit 1
    }
}