# Test-only virtual native observations. No Win32, process, ACL or storage effects.
# Authority: enforce-windows-secret-protection/design.md, Unit seam.
param([Parameter(Mandatory = $true)][string]$DispatcherPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Loading this file must define only production functions. It must not bootstrap.
. $DispatcherPath
foreach ($name in @('New-ProceedStorageSession', 'Initialize-ProceedStorageSession',
    'Invoke-ProceedStorageRequest', 'Stop-ProceedStorageSession')) {
    if (-not (Get-Command $name -CommandType Function -ErrorAction SilentlyContinue)) {
        throw "Missing production callable: $name"
    }
}

$script:Account = 'S-1-5-21-100-200-300-1001'
$script:Foreign = 'S-1-5-21-100-200-300-1002'
$script:Passed = 0
$script:Failed = 0

function Assert-That($condition, [string]$label) {
    if (-not $condition) { throw $label }
}
function Assert-Equal($actual, $expected, [string]$label) {
    Assert-That ($actual -ceq $expected) $label
}
function New-Ace($sid = $script:Account, [uint32]$mask = 0x1f01ff, [int]$flags = 0, $type = 'allow') {
    return @{ type = $type; sid = $sid; mask = $mask; flags = $flags }
}
function New-Observation($kind, $id) {
    return @{
        identity = @{ volume_serial = '0000000000000001'; file_id = $id.ToString('x32') }
        kind = $kind; attributes = $(if ($kind -eq 'directory') { 16 } else { 0 })
        link_count = 1; size = 0
        security = @{ owner_sid = $script:Account; control = 0x1004; dacl = 'present'; aces = @((New-Ace)) }
    }
}
function New-Fake {
    # This is an adapter fake, not an admission implementation. It returns raw
    # observations, accepts any requested masks, and records every operation.
    $fake = @{
        Clock = 0; Calls = [System.Collections.ArrayList]::new()
        Records = @{
            'C:\' = (New-Observation 'directory' 1)
            'C:\safe' = (New-Observation 'directory' 2)
        }
        Handles = @{}; Content = @{}; NextHandle = 0; NextIdentity = 2
        Fault = $null; InspectChange = $null; WriteLimit = 49152
    }
    $fake.Call = {
        param($operation, $arguments)
        [void]$fake.Calls.Add(@{ op = $operation; args = $arguments })
        if ($null -ne $fake.Fault) {
            $fault = & $fake.Fault $operation $arguments
            if ($null -ne $fault) { return $fault }
        }
        $value = @{}
        switch ($operation) {
            'account' { $value = @{ account_sid = $script:Account; trusted_installer_sid = 'S-1-5-80-1-2-3-4-5' } }
            'volume' { $value = @{ drive_type = 'fixed'; filesystem = 'NTFS'; persistent_acls = $true } }
            'open' {
                $path = $arguments.path
                if ($arguments.disposition -eq 'CREATE_NEW') {
                    if ($fake.Records.ContainsKey($path)) { return @{ ok = $false; error = @{ kind = 'exists' } } }
                    $fake.NextIdentity++
                    $fake.Records[$path] = New-Observation 'regular' $fake.NextIdentity
                    $fake.Content[$path] = [byte[]]@()
                }
                if (-not $fake.Records.ContainsKey($path)) { return @{ ok = $false; error = @{ kind = 'not_found' } } }
                $fake.NextHandle++
                $handle = 'virtual-' + $fake.NextHandle
                $fake.Handles[$handle] = $path
                $value = @{ handle = $handle }
            }
            'create-directory' {
                $path = $arguments.path
                if ($fake.Records.ContainsKey($path)) { return @{ ok = $false; error = @{ kind = 'exists' } } }
                $fake.NextIdentity++
                $fake.Records[$path] = New-Observation 'directory' $fake.NextIdentity
            }
            'inspect' {
                $path = $fake.Handles[$arguments.handle]
                if ($null -ne $fake.InspectChange) { & $fake.InspectChange $path $fake.Records[$path] }
                # Copy observations so mutations cannot silently update a retained
                # production observation by shared reference.
                $value = $fake.Records[$path] | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
            }
            'list' { $value = @{ names = @() } }
            'read' {
                $path = $fake.Handles[$arguments.handle]
                [byte[]]$bytes = $fake.Content[$path]
                $count = [Math]::Min($arguments.length, [Math]::Max(0, $bytes.Length - $arguments.offset))
                [byte[]]$chunk = @()
                if ($count -gt 0) { $chunk = $bytes[$arguments.offset..($arguments.offset + $count - 1)] }
                $value = @{ bytes = $chunk; eof = ($arguments.offset + $count -ge $bytes.Length) }
            }
            'write' {
                $path = $fake.Handles[$arguments.handle]
                $count = [Math]::Min($fake.WriteLimit, $arguments.bytes.Length)
                $size = [Math]::Max($fake.Records[$path].size, $arguments.offset + $count)
                $fake.Records[$path].size = $size
                $value = @{ written = $count }
            }
            'flush' { }
            'truncate' { $fake.Records[$fake.Handles[$arguments.handle]].size = $arguments.length }
            'rename' {
                $oldPath = $fake.Handles[$arguments.handle]
                $newPath = $fake.Handles[$arguments.parent].TrimEnd('\') + '\' + $arguments.name
                $fake.Records[$newPath] = $fake.Records[$oldPath]
                $fake.Records.Remove($oldPath)
                if ($fake.Content.ContainsKey($oldPath)) {
                    $fake.Content[$newPath] = $fake.Content[$oldPath]
                    $fake.Content.Remove($oldPath)
                }
                foreach ($key in @($fake.Handles.Keys)) {
                    if ($fake.Handles[$key] -eq $oldPath) { $fake.Handles[$key] = $newPath }
                }
            }
            'dispose' { }
            'close' {
                if (-not $fake.Handles.ContainsKey($arguments.handle)) { throw 'double-close virtual handle' }
                $fake.Handles.Remove($arguments.handle)
            }
            default { throw 'unrecognized normalized native operation' }
        }
        return @{ ok = $true; value = $value }
    }.GetNewClosure()
    $fake.Now = { return $fake.Clock }.GetNewClosure()
    return $fake
}
function New-Context {
    $fake = New-Fake
    $session = New-ProceedStorageSession -NativeCall $fake.Call -NowMs $fake.Now
    Assert-Equal $fake.Calls.Count 0 'construction must store bindings only'
    return @{ Fake = $fake; Session = $session; NextId = 0 }
}
function Initialize-Context($context) {
    $ready = Initialize-ProceedStorageSession -Session $context.Session -DeadlineMs 20000
    Assert-Equal $ready.protocol 'windows-protected-storage-v1' 'exact ready protocol'
    Assert-Equal $ready.account_sid $script:Account 'ready account from native identity'
    Assert-Equal @($context.Fake.Calls | Where-Object op -eq 'account').Count 1 'one account observation'
}
function Send-Request($context, $op, $arguments) {
    $context.NextId++
    return Invoke-ProceedStorageRequest -Session $context.Session -DeadlineMs 20000 -Request @{
        v = 1; id = $context.NextId; op = $op; args = $arguments
    }
}
function Open-Directory($context, $create = $false) {
    $reply = Send-Request $context 'directory' @{ path = 'C:\safe'; create = $create }
    Assert-Equal $reply.ok $true 'safe dedicated directory must work'
    return $reply.result.directory
}
function Open-File($context, $directory, $mode = 'create') {
    $reply = Send-Request $context 'open' @{ directory = $directory; name = 'synthetic.token'; mode = $mode }
    Assert-Equal $reply.ok $true 'safe file must work'
    return $reply.result.file
}
function Seed-File($context) {
    $context.Fake.Records['C:\safe\synthetic.token'] = New-Observation 'regular' 3
    $context.Fake.Records['C:\safe\synthetic.token'].size = 3
    $context.Fake.Content['C:\safe\synthetic.token'] = [byte[]]@(65, 66, 10)
}
function Assert-Refusal($reply, $code) {
    $reply = $reply | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
    Assert-Equal $reply.ok $false 'expected refusal'
    Assert-Equal $reply.error.code $code 'closed refusal code'
    Assert-Equal @($reply.error.PSObject.Properties).Count 1 'error exposes code only'
    Assert-That ($null -eq $reply.PSObject.Properties['result']) 'no result or bytes in refusal'
}
function Assert-NoContent($context) {
    Assert-Equal @($context.Fake.Calls | Where-Object { $_.op -in @('read', 'write', 'truncate', 'rename', 'dispose') }).Count 0 'no unsafe private access or mutation'
}
function Test-Case($name, [scriptblock]$body) {
    try { & $body; $script:Passed++; Write-Output "PASS $name" }
    catch { $script:Failed++; Write-Output "FAIL $name : $($_.Exception.Message)" }
}

Test-Case 'WIN-INIT: no request before ready' {
    $c = New-Context
    Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) 'PROTOCOL_INVALID'
    Assert-NoContent $c
}
Test-Case 'WIN-CREATE: protected exclusive creation, short writes, flush then exact cleanup' {
    $c = New-Context; Initialize-Context $c
    $d = Open-Directory $c
    $f = Open-File $c $d
    $opens = @($c.Fake.Calls | Where-Object op -eq 'open')
    Assert-That (@($opens | Where-Object { $_.args.path -eq 'C:\' }).Count -gt 0) 'root must be opened'
    foreach ($open in $opens) {
        Assert-Equal ($open.args.share -band 4) 0 'never share delete'
        Assert-That (($open.args.access -band 0x20000) -ne 0) 'READ_CONTROL requested'
        Assert-That (($open.args.flags -band 0x200000) -ne 0) 'OPEN_REPARSE_POINT requested'
    }
    $created = @($opens | Where-Object { $_.args.disposition -eq 'CREATE_NEW' })
    Assert-Equal $created.Count 1 'exclusive create, no overwrite'
    Assert-Equal $created[0].args.security.owner_sid $script:Account 'descriptor at create'
    Assert-Equal $created[0].args.security.protected $true 'protected initial descriptor'
    Assert-Equal $created[0].args.security.entries[0].sid $script:Account 'account-only grant'
    Assert-Equal $created[0].args.security.entries[0].mask 0x1f01ff 'full access grant'
    Assert-Equal $created[0].args.security.entries[0].flags 0 'file self-only grant'
    $c.Fake.WriteLimit = 1
    $written = Send-Request $c 'write' @{ file = $f; offset = 0; bytes = 'QUIK' }
    Assert-Equal $written.result.written 3 'short writes must complete full chunk'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'write').Count 3 'partial write loop'
    $flushed = Send-Request $c 'flush' @{ file = $f }
    Assert-Equal $flushed.ok $true 'flush acknowledged only on verified success'
    $removed = Send-Request $c 'remove-created' @{ object = $f }
    Assert-Equal $removed.result.removed $true 'owned exact file removed'
    $dispose = @($c.Fake.Calls | Where-Object op -eq 'dispose')
    Assert-Equal $dispose[0].args.handle @($c.Fake.Calls | Where-Object op -eq 'write')[0].args.handle 'cleanup uses exact retained write handle'
    $settled = Stop-ProceedStorageSession -Session $c.Session -DeadlineMs 20000
    Assert-Equal $settled.settled $true 'settled all capabilities'
    $count = @($c.Fake.Calls | Where-Object op -eq 'close').Count
    $again = Stop-ProceedStorageSession -Session $c.Session -DeadlineMs 20000
    Assert-Equal $again.settled $true 'repeated stop remains settled'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'close').Count $count 'no double close'
}
Test-Case 'WIN-LOAD: inspect before and after same-handle bounded read' {
    $c = New-Context; Seed-File $c; Initialize-Context $c
    $d = Open-Directory $c; $f = Open-File $c $d 'read'
    $reply = Send-Request $c 'read' @{ file = $f; offset = 0; length = 3 }
    Assert-Equal $reply.ok $true 'safe load succeeds'
    Assert-Equal $reply.result.bytes 'QUIK' 'same synthetic bytes'
    $readIndex = -1
    for ($i = 0; $i -lt $c.Fake.Calls.Count; $i++) { if ($c.Fake.Calls[$i].op -eq 'read') { $readIndex = $i } }
    Assert-That ($readIndex -gt 0) 'native read used'
    $handle = $c.Fake.Calls[$readIndex].args.handle
    Assert-That (@($c.Fake.Calls[0..($readIndex - 1)] | Where-Object { $_.op -eq 'inspect' -and $_.args.handle -eq $handle }).Count -gt 0) 'inspect actual file before read'
    Assert-That (@($c.Fake.Calls[($readIndex + 1)..($c.Fake.Calls.Count - 1)] | Where-Object { $_.op -eq 'inspect' -and $_.args.handle -eq $handle }).Count -gt 0) 'inspect actual file after read'
    Assert-Equal $c.Fake.Calls[$readIndex].args.length 3 'bounded requested read'
}

# Raw descriptor observations, not injected admission booleans.
foreach ($case in @('null', 'absent', 'empty', 'foreign-owner', 'foreign-ace', 'deny', 'unknown', 'inherit-only', 'incomplete-grant')) {
    Test-Case "WIN-DACL: $case refuses dedicated directory" {
        $c = New-Context
        $s = $c.Fake.Records['C:\safe'].security
        switch ($case) {
            'null' { $s.dacl = 'null'; $s.aces = @() }
            'absent' { $s.dacl = 'absent'; $s.aces = @() }
            'empty' { $s.aces = @() }
            'foreign-owner' { $s.owner_sid = $script:Foreign }
            'foreign-ace' { $s.aces = @((New-Ace), (New-Ace $script:Foreign)) }
            'deny' { $s.aces = @((New-Ace $script:Account 0x1f01ff 0 'deny')) }
            'unknown' { $s.aces = @(@{ type = 'unknown'; sid = $null; mask = $null; flags = 0 }) }
            'inherit-only' { $s.aces = @((New-Ace $script:Account 0x1f01ff 8)) }
            'incomplete-grant' { $s.aces = @((New-Ace $script:Account 0x120089)) }
        }
        Initialize-Context $c
        Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) 'UNSAFE'
        Assert-NoContent $c
    }
}
Test-Case 'WIN-DACL: inherited and redundant ordinary full account grants need no repair' {
    $c = New-Context
    $c.Fake.Records['C:\safe'].security.aces = @((New-Ace $script:Account 0x1f01ff 19), (New-Ace))
    Initialize-Context $c; $null = Open-Directory $c
    Assert-Equal @($c.Fake.Calls | Where-Object { $_.op -notin @('account', 'volume', 'open', 'inspect') }).Count 0 'admission never repairs existing ACL'
}
foreach ($mask in @(0x10000, 0x40000, 0x80000, 0x40, 0x2, 0x10, 0x100)) {
    Test-Case "WIN-ANCESTOR: foreign mutation mask $mask refuses" {
        $c = New-Context
        $c.Fake.Records['C:\'].security.owner_sid = 'S-1-5-18'
        $c.Fake.Records['C:\'].security.aces = @((New-Ace 'S-1-5-18'), (New-Ace $script:Foreign $mask))
        Initialize-Context $c
        Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) 'UNSAFE'
        Assert-NoContent $c
    }
}
Test-Case 'WIN-ANCESTOR: foreign read/traverse/add-subdirectory alone permits existing chain' {
    $c = New-Context
    $c.Fake.Records['C:\'].security.owner_sid = 'S-1-5-18'
    $c.Fake.Records['C:\'].security.aces = @((New-Ace 'S-1-5-18'), (New-Ace $script:Foreign 0x1200ad))
    Initialize-Context $c; $null = Open-Directory $c
}
foreach ($path in @('C:\', 'C:\safe', 'C:\safe\synthetic.token')) {
    Test-Case "WIN-REPARSE: raw reparse attribute at $path refuses regardless of tag" {
        $c = New-Context; Seed-File $c
        $c.Fake.Records[$path].attributes = $c.Fake.Records[$path].attributes -bor 0x400
        Initialize-Context $c
        $reply = Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }
        if ($reply.ok) { $reply = Send-Request $c 'open' @{ directory = $reply.result.directory; name = 'synthetic.token'; mode = 'read' } }
        Assert-Refusal $reply 'UNSAFE'; Assert-NoContent $c
    }
}
foreach ($path in @('C:relative', '\\server\share', '\\?\C:\safe', 'C:\safe\..\other', 'C:\safe\.', 'C:\safe\bad.', 'C:\safe\bad ', 'C:\safe\NUL', 'C:\safe\file:stream', "C:\safe`nother")) {
    Test-Case "WIN-PATH: unsupported spelling $($path.Replace("`n", '<LF>'))" {
        $c = New-Context; Initialize-Context $c
        $reply = Send-Request $c 'directory' @{ path = $path; create = $false }
        Assert-Equal $reply.ok $false 'unsafe spelling never admitted'
        Assert-NoContent $c
    }
}
Test-Case 'WIN-HARDLINK: multiple file links refuse before read' {
    $c = New-Context; Seed-File $c
    $c.Fake.Records['C:\safe\synthetic.token'].link_count = 2
    Initialize-Context $c; $d = Open-Directory $c
    Assert-Refusal (Send-Request $c 'open' @{ directory = $d; name = 'synthetic.token'; mode = 'read' }) 'UNSAFE'
    Assert-NoContent $c
}
Test-Case 'WIN-IDENTITY: changed file after read discards bytes' {
    $c = New-Context; Seed-File $c; Initialize-Context $c
    $d = Open-Directory $c; $f = Open-File $c $d 'read'
    $fake = $c.Fake
    $c.Fake.Fault = {
        param($op, $a)
        if ($op -eq 'read') { $fake.Records['C:\safe\synthetic.token'].identity.file_id = '000000000000000000000000000000ff' }
        return $null
    }.GetNewClosure()
    Assert-Refusal (Send-Request $c 'read' @{ file = $f; offset = 0; length = 3 }) 'IDENTITY_CHANGED'
}
Test-Case 'WIN-COLLISION: existing destination neither written nor disposed' {
    $c = New-Context; Seed-File $c; Initialize-Context $c; $d = Open-Directory $c
    Assert-Refusal (Send-Request $c 'open' @{ directory = $d; name = 'synthetic.token'; mode = 'create' }) 'EXISTS'
    Assert-NoContent $c
}
Test-Case 'WIN-FLUSH: failed flush never acknowledges durability or retries mutation' {
    $c = New-Context; Initialize-Context $c; $d = Open-Directory $c; $f = Open-File $c $d
    $c.Fake.Fault = { param($op, $a); if ($op -eq 'flush') { return @{ ok = $false; error = @{ kind = 'io_failure' } } } }
    Assert-Refusal (Send-Request $c 'flush' @{ file = $f }) 'IO_FAILURE'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'flush').Count 1 'no automatic flush retry'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'rename').Count 0 'no publication after failed flush'
}
Test-Case 'WIN-WRITE: zero progress fails without looping' {
    $c = New-Context; Initialize-Context $c; $d = Open-Directory $c; $f = Open-File $c $d
    $c.Fake.WriteLimit = 0
    Assert-Refusal (Send-Request $c 'write' @{ file = $f; offset = 0; bytes = 'QUIK' }) 'IO_FAILURE'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'write').Count 1 'zero progress bounded'
}
Test-Case 'WIN-CLEANUP: existing file cannot become rollback-owned' {
    $c = New-Context; Seed-File $c; Initialize-Context $c; $d = Open-Directory $c; $f = Open-File $c $d 'read'
    $reply = Send-Request $c 'remove-created' @{ object = $f }
    Assert-That (-not ($reply.ok -and $reply.result.removed)) 'existing object is preserved'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'dispose').Count 0 'no native disposal'
}
Test-Case 'WIN-CLOSE: uncertain native close never retried or settled successfully' {
    $c = New-Context; Initialize-Context $c; $null = Open-Directory $c
    $c.Fake.Fault = { param($op, $a); if ($op -eq 'close') { return @{ ok = $false; error = @{ kind = 'io_failure' } } } }
    $result = Stop-ProceedStorageSession -Session $c.Session -DeadlineMs 20000
    Assert-Equal $result.settled $false 'uncertain close blocks settled success'
    $count = @($c.Fake.Calls | Where-Object op -eq 'close').Count
    $null = Stop-ProceedStorageSession -Session $c.Session -DeadlineMs 20000
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'close').Count $count 'no uncertain close retry'
}
foreach ($kind in @('unavailable', 'unsafe', 'identity_changed', 'not_found', 'exists', 'io_failure', 'invalid_observation')) {
    Test-Case "WIN-ERROR: $kind is a closed secret-free code" {
        $codes = @{ unavailable = 'UNAVAILABLE'; unsafe = 'UNSAFE'; identity_changed = 'IDENTITY_CHANGED'; not_found = 'NOT_FOUND'; exists = 'EXISTS'; io_failure = 'IO_FAILURE'; invalid_observation = 'UNSAFE' }
        $c = New-Context; Initialize-Context $c
        $errorKind = $kind
        $c.Fake.Fault = { param($op, $a); return @{ ok = $false; error = @{ kind = $errorKind } } }.GetNewClosure()
        Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) $codes[$kind]
        Assert-NoContent $c
    }
}
Test-Case 'WIN-DEADLINE: expired original budget makes no private access' {
    $c = New-Context; Initialize-Context $c; $c.Fake.Clock = 20000
    Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) 'IO_FAILURE'
    Assert-NoContent $c
}
Test-Case 'WIN-PROTOCOL: duplicate request ID cannot repeat creation' {
    $c = New-Context; Initialize-Context $c; $null = Open-Directory $c
    $before = $c.Fake.Calls.Count
    $reply = Invoke-ProceedStorageRequest -Session $c.Session -DeadlineMs 20000 -Request @{ v = 1; id = 1; op = 'directory'; args = @{ path = 'C:\safe'; create = $true } }
    Assert-Refusal $reply 'PROTOCOL_INVALID'
    Assert-Equal @($c.Fake.Calls | Select-Object -Skip $before | Where-Object op -eq 'create-directory').Count 0 'duplicate cannot create'
}
foreach ($bytes in @('QQ', '!!!!', 'QR==', ('QQ==' * 20000))) {
    Test-Case 'WIN-BOUNDS: malformed/noncanonical/oversize chunk cannot write' {
        $c = New-Context; Initialize-Context $c; $d = Open-Directory $c; $f = Open-File $c $d
        $reply = Send-Request $c 'write' @{ file = $f; offset = 0; bytes = $bytes }
        Assert-Equal $reply.ok $false 'invalid chunk refused'
        Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'write').Count 0 'no native write'
    }
}
Test-Case 'WIN-MKDIR: new missing directory receives its descriptor before descent' {
    $c = New-Context; $c.Fake.Records.Remove('C:\safe'); Initialize-Context $c
    $reply = Send-Request $c 'directory' @{ path = 'C:\safe'; create = $true }
    Assert-Equal $reply.ok $true 'protected missing directory creation works'
    Assert-Equal $reply.result.created $true 'created provenance retained'
    $creates = @($c.Fake.Calls | Where-Object op -eq 'create-directory')
    Assert-Equal $creates.Count 1 'root never created or modified'
    Assert-Equal $creates[0].args.path 'C:\safe' 'only missing tail created'
    Assert-Equal $creates[0].args.security.owner_sid $script:Account 'account owner at create'
    Assert-Equal $creates[0].args.security.protected $true 'protected from creation'
    Assert-Equal $creates[0].args.security.entries[0].flags 3 'self/files/subdirectories inheritance'
    Assert-Equal $creates[0].args.security.entries[0].mask 0x1f01ff 'ordinary full access'
    Assert-NoContent $c
}
foreach ($variant in @('remote', 'filesystem', 'acls')) {
    Test-Case "WIN-VOLUME: unsupported $variant refuses" {
        $c = New-Context; Initialize-Context $c
        $choice = $variant
        $c.Fake.Fault = {
            param($op, $a)
            if ($op -eq 'volume') {
                $v = @{ drive_type = 'fixed'; filesystem = 'NTFS'; persistent_acls = $true }
                if ($choice -eq 'remote') { $v.drive_type = 'unsupported' }
                if ($choice -eq 'filesystem') { $v.filesystem = 'ReFS' }
                if ($choice -eq 'acls') { $v.persistent_acls = $false }
                return @{ ok = $true; value = $v }
            }
        }.GetNewClosure()
        Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) 'UNAVAILABLE'
        Assert-NoContent $c
    }
}
Test-Case 'WIN-OBSERVATION: missing required native descriptor refuses without content' {
    $c = New-Context; Initialize-Context $c
    $c.Fake.Records['C:\safe'].Remove('security')
    Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) 'UNSAFE'
    Assert-NoContent $c
}
Test-Case 'WIN-EXCEPTION: adapter exception does not escape or authorize access' {
    $c = New-Context; Initialize-Context $c
    $c.Fake.Fault = { param($op, $a); throw 'SYNTHETIC-PRIVATE-ERROR' }
    Assert-Refusal (Send-Request $c 'directory' @{ path = 'C:\safe'; create = $false }) 'IO_FAILURE'
    Assert-NoContent $c
}
Test-Case 'WIN-CAPABILITY: parent cannot close while dependent file is live' {
    $c = New-Context; Seed-File $c; Initialize-Context $c
    $d = Open-Directory $c; $null = Open-File $c $d 'read'
    $before = @($c.Fake.Calls | Where-Object op -eq 'close').Count
    $reply = Send-Request $c 'close' @{ object = $d }
    Assert-Equal $reply.ok $false 'parent lifetime protects live dependent'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'close').Count $before 'no parent native close'
}
Test-Case 'WIN-CAPABILITY: closed file ID cannot read or reopen itself' {
    $c = New-Context; Seed-File $c; Initialize-Context $c
    $d = Open-Directory $c; $f = Open-File $c $d 'read'
    Assert-Equal (Send-Request $c 'close' @{ object = $f }).ok $true 'close file succeeds'
    $reply = Send-Request $c 'read' @{ file = $f; offset = 0; length = 3 }
    Assert-Equal $reply.ok $false 'closed capability invalid'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'read').Count 0 'closed ID cannot reach native read'
}
Test-Case 'WIN-READ-ONLY: admitted read handle cannot be used for write/truncate' {
    foreach ($op in @('write', 'truncate')) {
        $c = New-Context; Seed-File $c; Initialize-Context $c
        $d = Open-Directory $c; $f = Open-File $c $d 'read'
        $a = if ($op -eq 'write') { @{ file = $f; offset = 0; bytes = 'QUIK' } } else { @{ file = $f; length = 0 } }
        Assert-Equal (Send-Request $c $op $a).ok $false 'read capability cannot mutate'
        Assert-NoContent $c
    }
}
Test-Case 'WIN-JOURNAL: truncation is journal-only and requires a later flush' {
    $c = New-Context; Initialize-Context $c; $d = Open-Directory $c
    $opened = Send-Request $c 'open' @{ directory = $d; name = 'journal.log'; mode = 'journal' }
    Assert-Equal $opened.ok $true 'journal existing-or-exclusive-create works'
    $f = $opened.result.file
    Assert-Equal (Send-Request $c 'write' @{ file = $f; offset = 0; bytes = 'QUIK' }).result.written 3 'journal append'
    Assert-Equal (Send-Request $c 'truncate' @{ file = $f; length = 2 }).result.size 2 'authorized tail truncation'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'flush').Count 0 'truncate does not forge durability'
    Assert-Equal (Send-Request $c 'flush' @{ file = $f }).ok $true 'explicit durable acknowledgement'
    $writes = @($c.Fake.Calls | Where-Object op -eq 'write')
    $truncates = @($c.Fake.Calls | Where-Object op -eq 'truncate')
    $flushes = @($c.Fake.Calls | Where-Object op -eq 'flush')
    Assert-Equal $writes[0].args.handle $truncates[0].args.handle 'same retained journal handle'
    Assert-Equal $truncates[0].args.handle $flushes[0].args.handle 'same handle durability'
}
Test-Case 'WIN-PUBLISH: new sibling must flush before native rename' {
    $c = New-Context; Initialize-Context $c; $d = Open-Directory $c; $f = Open-File $c $d
    $reply = Send-Request $c 'publish' @{ file = $f; directory = $d; name = 'published.token'; replace = $false }
    Assert-Equal $reply.ok $false 'unflushed new file cannot publish'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'rename').Count 0 'no unflushed rename'
}
Test-Case 'WIN-PUBLISH: flushed protected new sibling can publish create-only' {
    $c = New-Context; Initialize-Context $c; $d = Open-Directory $c; $f = Open-File $c $d
    Assert-Equal (Send-Request $c 'write' @{ file = $f; offset = 0; bytes = 'QUIK' }).ok $true 'write before flush'
    Assert-Equal (Send-Request $c 'flush' @{ file = $f }).ok $true 'flush before publication'
    $reply = Send-Request $c 'publish' @{ file = $f; directory = $d; name = 'published.token'; replace = $false }
    Assert-Equal $reply.ok $true 'publish works after verified flush'
    $rename = @($c.Fake.Calls | Where-Object op -eq 'rename')
    Assert-Equal $rename.Count 1 'no rename retry'
    Assert-Equal $rename[0].args.replace $false 'create-only credential publication'
    Assert-Equal $reply.result.identity.file_id $c.Fake.Records['C:\safe\published.token'].identity.file_id 'published identity is verified'
}
Test-Case 'WIN-BOUNDS: oversized read cannot reach native I/O' {
    $c = New-Context; Seed-File $c; Initialize-Context $c; $d = Open-Directory $c; $f = Open-File $c $d 'read'
    Assert-Refusal (Send-Request $c 'read' @{ file = $f; offset = 0; length = 49153 }) 'LIMIT_EXCEEDED'
    Assert-Equal @($c.Fake.Calls | Where-Object op -eq 'read').Count 0 'read bound before native call'
}
Test-Case 'WIN-PROTOCOL: unknown request fields and forged authority refuse' {
    $c = New-Context; Initialize-Context $c
    $reply = Invoke-ProceedStorageRequest -Session $c.Session -DeadlineMs 20000 -Request @{
        v = 1; id = 1; op = 'directory'; args = @{ path = 'C:\safe'; create = $false }; account_sid = $script:Foreign
    }
    Assert-Refusal $reply 'PROTOCOL_INVALID'; Assert-NoContent $c
}
Write-Output "RESULT passed=$script:Passed failed=$script:Failed"
if ($script:Failed -gt 0) { exit 1 }
exit 0
