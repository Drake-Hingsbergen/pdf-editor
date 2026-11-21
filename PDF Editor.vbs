' PDF Editor - double-click to open, or pass a .pdf path (used by "Open with").
' Runs launch.js without showing a console window.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "node """ & base & "\launch.js"""
If WScript.Arguments.Count > 0 Then
  cmd = cmd & " """ & WScript.Arguments(0) & """"
End If
sh.CurrentDirectory = base
sh.Run cmd, 0, False
