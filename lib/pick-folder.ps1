# Shows a Windows folder picker and prints the result as one line of JSON:
# {"ok":true,"path":"..."} or {"ok":true,"cancelled":true}. The server runs it
# for a to-do's folder. The folder to start in and the dialog's title come in
# as environment variables, so nothing in them is ever read as code.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Picker -Name W -MemberDefinition @'
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
'@

$start = $env:AGENTS_PICK_START
$title = $env:AGENTS_PICK_TITLE

try {
  # The server runs in the background, and Windows doesn't let a background
  # process put its windows in front. The dialog's owner is a topmost window,
  # invisible, brought forward with a synthetic Alt press as in
  # focus-window.ps1, so the dialog opens in front of the dashboard.
  $owner = New-Object System.Windows.Forms.Form -Property @{
    TopMost = $true
    ShowInTaskbar = $false
    FormBorderStyle = 'None'
    Opacity = 0
    StartPosition = 'CenterScreen'
    Size = New-Object System.Drawing.Size 1, 1
  }
  $owner.Show()
  # The server starts this hidden, and Windows applies that to the first
  # window the process shows, so the owner stayed hidden and the dialog
  # returned at once without showing. Showing it a second time works; it has
  # no size or opacity, so nothing appears.
  [void][Picker.W]::ShowWindow($owner.Handle, 5)
  [Picker.W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [void][Picker.W]::SetForegroundWindow($owner.Handle)
  [Picker.W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)

  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = if ($title) { $title } else { 'Choose a folder' }
  # Windows PowerShell's .NET has the older dialog, without these.
  $modern = [bool]($dialog | Get-Member -Name InitialDirectory)
  if ($modern) { $dialog.UseDescriptionForTitle = $true }
  if ($start -and (Test-Path -LiteralPath $start -PathType Container)) {
    if ($modern) { $dialog.InitialDirectory = $start } else { $dialog.SelectedPath = $start }
  }
  $result = $dialog.ShowDialog($owner)
  $owner.Close()
  if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
    ConvertTo-Json -Compress @{ ok = $true; path = $dialog.SelectedPath }
  } else {
    '{"ok":true,"cancelled":true}'
  }
} catch {
  ConvertTo-Json -Compress @{ ok = $false; error = "The folder picker failed: $($_.Exception.Message)" }
}
