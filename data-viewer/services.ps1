#Requires -Version 5.1
# Read-only MCP server + chat-bot over the Apetit Coraine (start Coraine from the repo root first).
# Windows/PowerShell port of the data-viewer `services` bash script.

Set-Location $PSScriptRoot

$Usage = 'usage: services [apetit|apetit stop]'

# Equivalent of `set -a; source .env; set +a`
function Import-DotEnv {
    if (-not (Test-Path .env)) { return }
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

# Equivalent of `set -e` for native commands
function Test-Exit {
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$command = if ($args.Count -gt 0) { $args[0] } else { '' }
$sub = if ($args.Count -gt 1) { $args[1] } else { '' }

switch ($command) {
    'apetit' {
        Import-DotEnv
        $env:AUTH_ENABLED = 'false'
        $env:MCP_ENDPOINT = "http://mcp-server:$($env:MCP_SERVER_PORT)/mcp"

        if ($sub -eq 'stop') {
            docker compose -f docker-compose/apetit.yml -p apetit-viewer down; Test-Exit
            exit 0
        }

        docker network inspect apetit_default *> $null
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'apetit_default missing: run .\services.cmd start in the repo root first'
            exit 1
        }

        docker compose -f docker-compose/apetit.yml -p apetit-viewer up -d --build; Test-Exit
        Write-Host "Chat with the Apetit data at http://localhost:$($env:CHAT_BOT_PORT) (MCP: http://localhost:$($env:MCP_SERVER_PORT)/mcp)"
    }
    default {
        Write-Host $Usage
        exit 1
    }
}
