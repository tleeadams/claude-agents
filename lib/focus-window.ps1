param([int]$TargetPid, [switch]$DryRun, [string]$Send, [string]$StatusFile)

# Brings the window hosting a console process to the front. In Windows Terminal
# it also selects the tab and focuses the pane that the process runs in.
# -Send then types a prompt into that session and presses Enter.
# Prints one line of JSON. -DryRun reports how the tab would be found and
# changes nothing.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;

// An INPUT_RECORD holding a KEY_EVENT_RECORD, flattened.
[StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
public struct KeyRecord {
  [FieldOffset(0)] public ushort EventType;
  [FieldOffset(4)] public int KeyDown;
  [FieldOffset(8)] public ushort RepeatCount;
  [FieldOffset(10)] public ushort VirtualKeyCode;
  [FieldOffset(12)] public ushort VirtualScanCode;
  [FieldOffset(14)] public char UnicodeChar;
  [FieldOffset(16)] public uint ControlKeyState;
}

public static class W {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern uint GetConsoleTitle(StringBuilder sb, uint size);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", EntryPoint = "WriteConsoleInputW")] public static extern bool WriteConsoleInput(IntPtr input, KeyRecord[] records, uint count, out uint written);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  public static string ClassOf(IntPtr hwnd) {
    var sb = new StringBuilder(256);
    GetClassName(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  // The input buffer of whichever console this process is attached to.
  public static IntPtr OpenConsoleInput() {
    return CreateFile("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
  }

  // Key-down and key-up records for each character, as if typed.
  public static bool Type(IntPtr input, string text) {
    var records = new List<KeyRecord>();
    foreach (char c in text) {
      short scan = VkKeyScan(c);
      ushort vk = (ushort)(scan == -1 ? 0 : scan & 0xff);
      uint shift = scan != -1 && (scan & 0x100) != 0 ? 0x10u : 0u;
      for (int down = 1; down >= 0; down--) {
        records.Add(new KeyRecord { EventType = 1, KeyDown = down, RepeatCount = 1, VirtualKeyCode = vk,
          VirtualScanCode = (ushort)MapVirtualKey(vk, 0), UnicodeChar = c, ControlKeyState = shift });
      }
    }
    uint written;
    return WriteConsoleInput(input, records.ToArray(), (uint)records.Count, out written) && written == records.Count;
  }
}
"@

$AE = [Windows.Automation.AutomationElement]
$Scope = [Windows.Automation.TreeScope]

function Out-Result($ok, $props) {
  $props.ok = $ok
  [Console]::Out.WriteLine(($props | ConvertTo-Json -Compress))
  exit 0
}

# Claude Code prefixes its title with a spinner or status glyph that changes.
function Get-TitleKey([string]$title) {
  return ($title -replace '^[^\p{L}\p{N}]+', '').Trim()
}

# A newly selected tab's panes take a moment to appear, hence the retries.
function Find-Pane($window, [string]$key, [int]$attempts = 1) {
  $cond = New-Object Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'TermControl')
  foreach ($attempt in 1..$attempts) {
    foreach ($pane in $window.FindAll($Scope::Descendants, $cond)) {
      if ((Get-TitleKey $pane.Current.HelpText) -eq $key) { return $pane }
    }
    if ($attempt -lt $attempts) { Start-Sleep -Milliseconds 60 }
  }
  return $null
}

function Select-Tab($tab) {
  $tab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
}

function Get-SelectedTabName($window) {
  $tabCond = New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
  foreach ($tab in $window.FindAll($Scope::Descendants, $tabCond)) {
    if ($tab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) { return $tab.Current.Name }
  }
  return $null
}

function Get-WindowFromAncestors([int]$id) {
  for ($i = 0; $i -lt 10 -and $id -gt 0; $i++) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { return $p.MainWindowHandle }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if (-not $cim) { break }
    $id = [int]$cim.ParentProcessId
  }
  return [IntPtr]::Zero
}

# Writes straight into the session's console input, so the text reaches that
# session even if its window couldn't be brought forward. Returns a problem
# description, or nothing on success.
function Send-Prompt([string]$text) {
  # Typing into an open permission prompt or dialog could answer it.
  if ($StatusFile -and (Test-Path -LiteralPath $StatusFile)) {
    if ((Get-Content -Raw -LiteralPath $StatusFile | ConvertFrom-Json).status -eq 'waiting') { return 'waiting' }
  }
  [void][W]::FreeConsole()
  if (-not [W]::AttachConsole([uint32]$TargetPid)) { return "couldn't attach to its console" }
  try {
    $conIn = [W]::OpenConsoleInput()
    if ($conIn -eq [IntPtr]-1) { return "couldn't open its console input" }
    try {
      if (-not [W]::Type($conIn, $text)) { return "couldn't type into its console" }
      # Sent on its own, Enter submits the prompt; in the same burst Claude Code
      # would take it as part of a paste.
      Start-Sleep -Milliseconds 250
      if (-not [W]::Type($conIn, "`r")) { return "couldn't press Enter in its console" }
    } finally {
      [void][W]::CloseHandle($conIn)
    }
  } finally {
    [void][W]::FreeConsole()
  }
}

# 1. The console tells us both the app's title and, through the owner of its
#    window, which top-level window hosts it.
$top = [IntPtr]::Zero
$key = ''
$hiddenConsole = $false
[void][W]::FreeConsole()
if ([W]::AttachConsole([uint32]$TargetPid)) {
  $con = [W]::GetConsoleWindow()
  $sb = New-Object Text.StringBuilder 1024
  [void][W]::GetConsoleTitle($sb, 1024)
  [void][W]::FreeConsole()
  $key = Get-TitleKey $sb.ToString()
  if ($con -ne [IntPtr]::Zero) {
    $root = [W]::GetAncestor($con, 3)
    if ($root -ne $con) { $top = $root }
    elseif ([W]::IsWindowVisible($con)) { $top = $con }
    # A hidden classic console belongs to a background process. Its ancestors'
    # windows, such as the terminal that launched it, aren't its window.
    elseif ([W]::ClassOf($con) -eq 'ConsoleWindowClass') { $hiddenConsole = $true }
  }
}
# VS Code, Claude Desktop and similar hosts give the session a pseudoconsole
# with no owner, or no console at all; the host app's window is the answer.
if ($top -eq [IntPtr]::Zero -and -not $hiddenConsole) { $top = Get-WindowFromAncestors $TargetPid }
if ($top -eq [IntPtr]::Zero -and -not $Send) {
  Out-Result $false @{ error = 'No window found for this session. It may be running in the background.' }
}

$windowName = $null
$terminal = $false
$tabFound = $false
$tabName = $null
$raised = $false
if ($top -ne [IntPtr]::Zero) {
  # 2. In Windows Terminal, find the tab. Only the selected tab's panes are
  #    visible to UI Automation, and a renamed tab hides the app's title, so
  #    step through the tabs when the name doesn't give it away.
  $window = $AE::FromHandle($top)
  $windowName = $window.Current.Name
  $terminal = $window.Current.ClassName -eq 'CASCADIA_HOSTING_WINDOW_CLASS'
  $pane = $null
  if ($terminal -and $key) {
    $pane = Find-Pane $window $key
    if (-not $pane) {
      $tabCond = New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
      $tabs = @($window.FindAll($Scope::Descendants, $tabCond))
      $original = $tabs | Where-Object { $_.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } | Select-Object -First 1
      $named = @($tabs | Where-Object { (Get-TitleKey $_.Current.Name) -eq $key })
      if ($DryRun) {
        Out-Result $true @{ window = $windowName; terminal = $true; key = $key; tab = $(if ($named.Count) { "named: $($named[0].Current.Name)" } else { "search $($tabs.Count) tabs" }) }
      }
      $candidates = $named + @($tabs | Where-Object { $named -notcontains $_ })
      foreach ($tab in $candidates) {
        Select-Tab $tab
        $pane = Find-Pane $window $key 8
        if ($pane) { break }
      }
      if (-not $pane -and $original) { Select-Tab $original }
    }
    $tabFound = [bool]$pane
    if ($pane) { $tabName = Get-SelectedTabName $window }
  }
  if ($DryRun) { Out-Result $true @{ window = $windowName; terminal = $terminal; key = $key; tab = $(if ($pane) { 'already selected' } else { 'none' }) } }

  # 3. Raise the window. Windows only lets the foreground app hand over focus;
  #    a synthetic Alt press gives this process that right.
  if ([W]::IsIconic($top)) { [void][W]::ShowWindow($top, 9) }
  [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  $raised = [W]::SetForegroundWindow($top)
  [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  if ($pane) { try { $pane.SetFocus() } catch {} }
}

# 4. Optionally ask the session something.
$sent = $false
if ($Send) {
  $problem = Send-Prompt $Send
  if ($problem -eq 'waiting') {
    Out-Result $false @{ error = 'It started waiting on a prompt or dialog, so nothing was typed. Answer that first.'; window = $windowName }
  }
  if ($problem) { Out-Result $false @{ error = "Couldn't send the question: $problem."; window = $windowName } }
  $sent = $true
}

Out-Result $true @{ window = $windowName; hwnd = [string][int64]$top; tab = $tabFound; tabName = $tabName; raised = $raised; terminal = $terminal; sent = $sent }
