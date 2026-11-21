@echo off
rem Builds "PDF Editor.exe" from tools\PDFEditorLauncher.cs using the C# compiler that ships with Windows.
rem Run "node tools\make-icon.js" first if you want the exe to carry the app icon.
setlocal
set "BASE=%~dp0.."
for %%I in ("%BASE%") do set "BASE=%%~fI"
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
set ICONARG=
if exist "%BASE%\app\pdf-editor.ico" set ICONARG=/win32icon:"%BASE%\app\pdf-editor.ico"
"%CSC%" /nologo /target:winexe /optimize+ /out:"%BASE%\PDF Editor.exe" %ICONARG% /reference:System.Windows.Forms.dll "%BASE%\tools\PDFEditorLauncher.cs"
if errorlevel 1 (echo Build failed & exit /b 1)
echo Built "%BASE%\PDF Editor.exe"
endlocal
