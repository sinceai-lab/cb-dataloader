#Requires -Version 5.1
#
#  Check which LLM providers in .env are reachable and which model each would use.
#  usage: check-models [provider ...]
#  Windows/PowerShell port of the `check-models` bash script. No jq needed (ConvertFrom-Json).

Set-Location $PSScriptRoot

# Keep in step with COMPAT[].prefer in chat-bot/src/server/llm/registry.ts
function Get-Prefer($id) {
    switch ($id) {
        'openai'      { '^gpt-4o$' }
        'gemini'      { 'gemini-[0-9.]+-flash$' }
        'groq'        { 'gpt-oss-120b$' }
        'openrouter'  { 'llama-3\.3-70b-instruct(:free)?$' }
        'nvidia'      { 'llama-3\.3-70b-instruct$' }
        'cohere'      { 'command-r-plus' }
        'anthropic'   { 'sonnet' }
        default       { $null }
    }
}

function Get-KeyUrl($id) {
    switch ($id) {
        'anthropic'  { 'https://console.anthropic.com/settings/keys' }
        'openai'     { 'https://platform.openai.com/api-keys' }
        'gemini'     { 'https://aistudio.google.com/apikey' }
        'groq'       { 'https://console.groq.com/keys' }
        'openrouter' { 'https://openrouter.ai/keys' }
        'nvidia'     { 'https://build.nvidia.com' }
        'cohere'     { 'https://dashboard.cohere.com/api-keys' }
        default      { $null }
    }
}

function Get-DefaultUrl($id) {
    switch ($id) {
        'openai' { 'https://api.openai.com/v1' }
        'gemini' { 'https://generativelanguage.googleapis.com/v1beta/openai' }
        default  { $null }
    }
}

# Environment wins over .env; values are never echoed.
function Get-Val($name) {
    $v = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($v) { return $v }
    if (Test-Path .env) {
        $m = Select-String -Path .env -Pattern "^$name=" -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($m) {
            $val = $m.Line -replace "^$name=", ''
            $val = $val -replace '^"', '' -replace '"$', ''
            $val = $val -replace "^'", '' -replace "'$", ''
            return $val
        }
    }
    return $null
}

# curl.exe -sS -m 15, body + status code (use curl.exe; `curl` is aliased to Invoke-WebRequest in PS 5.1)
function Invoke-Fetch($url, $headers) {
    $cargs = @('-s', '-S', '-m', '15', '-w', "`n%{http_code}", $url)
    foreach ($k in $headers.Keys) { $cargs += @('-H', ($k + ': ' + $headers[$k])) }
    $raw = (& curl.exe @cargs 2>&1) -join "`n"
    $raw = $raw -replace "`r`n", "`n"
    $idx = $raw.LastIndexOf("`n")
    if ($idx -ge 0) {
        $code = $raw.Substring($idx + 1)
        $body = $raw.Substring(0, $idx)
    } else {
        $code = $raw; $body = ''
    }
    [PSCustomObject]@{ Code = $code; Body = $body }
}

function Invoke-Check($id) {
    $U = $id.ToUpper()
    $key = Get-Val "${U}_API_KEY"
    $pin = Get-Val "${U}_MODEL"
    $base = Get-Val "${U}_BASE_URL"

    if ($id -eq 'ollama') {
        $base = Get-Val 'OLLAMA_BASE_URL'
        if ($base) { $base = $base -replace 'host\.docker\.internal', 'localhost' }
        $key = 'ollama'
        if (-not $base) { Write-Host ("{0,-11} skipped (OLLAMA_BASE_URL not set)" -f $id); return }
    }
    elseif (-not $key) {
        Write-Host ("{0,-11} skipped (no {1}_API_KEY - obtain key from {2})" -f $id, $U, (Get-KeyUrl $id)); return
    }

    if ($id -eq 'anthropic') {
        $b = if ($base) { $base } else { 'https://api.anthropic.com' }
        $r = Invoke-Fetch "$b/v1/models?limit=1000" @{ 'x-api-key' = $key; 'anthropic-version' = '2023-06-01' }
    } else {
        $b = if ($base) { $base } else { (Get-DefaultUrl $id) }
        $r = Invoke-Fetch ($b.TrimEnd('/') + '/models') @{ 'Authorization' = "Bearer $key" }
    }

    if ($r.Code -ne '200') {
        $snippet = $r.Body
        if ($snippet.Length -gt 120) { $snippet = $snippet.Substring(0, 120) }
        Write-Host ("{0,-11} FAIL   HTTP {1} {2}" -f $id, $r.Code, $snippet); return
    }

    try { $json = $r.Body | ConvertFrom-Json } catch { Write-Host ("{0,-11} FAIL   bad JSON response" -f $id); return }
    $ids = @($json.data.id | Sort-Object -Unique)
    $count = if ($ids) { @($ids).Count } else { 0 }

    if ($pin) {
        if ($ids -contains $pin) {
            Write-Host ("{0,-11} OK     {1} models; pinned {2} (available)" -f $id, $count, $pin)
        } else {
            Write-Host ("{0,-11} FAIL   {1} models; pinned {2} NOT in list" -f $id, $count, $pin)
        }
        return
    }

    $pat = Get-Prefer $id
    $pick = $null
    if ($pat) {
        $matched = @($ids | Where-Object { $_ -match $pat })
        $pick = $matched | Select-Object -Last 1
    } else {
        $pick = $ids | Select-Object -First 1
    }

    if ($pick) {
        Write-Host ("{0,-11} OK     {1} models; would use {2}" -f $id, $count, $pick)
    } else {
        Write-Host ("{0,-11} FAIL   no model matches /{1}/. Available:" -f $id, $pat)
        $ids | ForEach-Object { Write-Host ("             {0}" -f $_) }
        Write-Host ("             Set {0}_MODEL to one of these, or update prefer in registry.ts." -f $U)
    }
}

$providers = if ($args.Count -gt 0) { $args } else { @('anthropic','openai','gemini','groq','openrouter','nvidia','cohere','ollama') }
foreach ($p in $providers) { Invoke-Check $p }