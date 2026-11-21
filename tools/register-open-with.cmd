@echo off
rem Registers "PDF Editor.exe" with Windows (current user only, no admin) so it shows in
rem right-click > Open with and in Settings > Apps > Default apps, where you can make it
rem the default for .pdf. Windows does not allow a program to set the default itself.
rem Run unregister-open-with.cmd to remove everything this adds.
setlocal
set "BASE=%~dp0.."
for %%I in ("%BASE%") do set "BASE=%%~fI"
set "EXE=%BASE%\PDF Editor.exe"
set "ICO=%BASE%\app\pdf-editor.ico"
if not exist "%EXE%" (echo PDF Editor.exe not found - run tools\build-launcher.cmd first & exit /b 1)

rem Old entries from the first version (script-host based) - remove
reg delete "HKCU\Software\Classes\Applications\PDF Editor.vbs" /f >nul 2>&1

rem ProgID that describes how to open a PDF with us
reg add "HKCU\Software\Classes\PDFEditor.Local" /ve /d "PDF Document (PDF Editor)" /f >nul
reg add "HKCU\Software\Classes\PDFEditor.Local" /v "FriendlyTypeName" /d "PDF Document" /f >nul
reg add "HKCU\Software\Classes\PDFEditor.Local\DefaultIcon" /ve /d "%ICO%,0" /f >nul
reg add "HKCU\Software\Classes\PDFEditor.Local\shell\open" /ve /d "Open with PDF Editor" /f >nul
reg add "HKCU\Software\Classes\PDFEditor.Local\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
reg add "HKCU\Software\Classes\.pdf\OpenWithProgids" /v "PDFEditor.Local" /t REG_NONE /d "" /f >nul

rem Application entry (Open with > Choose another app)
reg add "HKCU\Software\Classes\Applications\PDF Editor.exe" /v "FriendlyAppName" /d "PDF Editor" /f >nul
reg add "HKCU\Software\Classes\Applications\PDF Editor.exe\DefaultIcon" /ve /d "%ICO%,0" /f >nul
reg add "HKCU\Software\Classes\Applications\PDF Editor.exe\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
reg add "HKCU\Software\Classes\Applications\PDF Editor.exe\SupportedTypes" /v ".pdf" /d "" /f >nul

rem Default Programs registration (Settings > Apps > Default apps)
reg add "HKCU\Software\PDFEditor\Capabilities" /v "ApplicationName" /d "PDF Editor" /f >nul
reg add "HKCU\Software\PDFEditor\Capabilities" /v "ApplicationDescription" /d "Fill, sign and edit PDF files locally" /f >nul
reg add "HKCU\Software\PDFEditor\Capabilities\FileAssociations" /v ".pdf" /d "PDFEditor.Local" /f >nul
reg add "HKCU\Software\RegisteredApplications" /v "PDF Editor" /d "Software\PDFEditor\Capabilities" /f >nul

rem App Paths so "PDF Editor.exe" resolves from Run / Open with
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\PDF Editor.exe" /ve /d "%EXE%" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\PDF Editor.exe" /v "Path" /d "%BASE%" /f >nul

rem Tell Explorer the associations changed
powershell -NoProfile -Command "Add-Type -Namespace W -Name S -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int e, int f, IntPtr a, IntPtr b);'; [W.S]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)" >nul 2>&1

echo Registered "PDF Editor". To make it the default for .pdf:
echo   Settings ^> Apps ^> Default apps ^> PDF Editor ^> .pdf   (or right-click a PDF ^> Open with ^> Choose another app ^> PDF Editor ^> Always)
endlocal
