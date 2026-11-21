@echo off
rem Removes everything register-open-with.cmd added (current user only).
reg delete "HKCU\Software\Classes\PDFEditor.Local" /f >nul 2>&1
reg delete "HKCU\Software\Classes\.pdf\OpenWithProgids" /v "PDFEditor.Local" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Applications\PDF Editor.exe" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Applications\PDF Editor.vbs" /f >nul 2>&1
reg delete "HKCU\Software\PDFEditor" /f >nul 2>&1
reg delete "HKCU\Software\RegisteredApplications" /v "PDF Editor" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\PDF Editor.exe" /f >nul 2>&1
echo Removed PDF Editor from Open with / Default apps.
