' Launcher for DeepSeek Harness with the Russian shell translation.
'
' 1. applies the prepared shell patch (tools/apply-if-needed.mjs) - at this
'    moment app.asar is not locked by the running application;
' 2. starts DeepSeek Harness.
'
' ASCII only on purpose: Windows Script Host reads .vbs in the ANSI codepage.
' Keep in mind: every shortcut that points at this file must also keep working
' when the language pack is missing, so the patch step is wrapped in error
' handling and the application always starts.
Option Explicit

Dim fso, shell, packRoot, nodeExe, appExe, script

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

packRoot = fso.GetParentFolderName(WScript.ScriptFullName)
script = packRoot & "\tools\apply-if-needed.mjs"
nodeExe = shell.ExpandEnvironmentStrings("%USERPROFILE%") & _
  "\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"

If fso.FileExists(script) Then
  On Error Resume Next
  shell.Run """" & nodeExe & """ """ & script & """ --quiet", 0, True
  On Error GoTo 0
End If

appExe = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & _
  "\Programs\DeepSeek Harness\DeepSeek Harness.exe"

If fso.FileExists(appExe) Then
  shell.Run """" & appExe & """", 1, False
Else
  MsgBox "DeepSeek Harness was not found at:" & vbCrLf & appExe, 16, "DeepSeek Harness"
End If
