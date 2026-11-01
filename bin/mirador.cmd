@echo off
rem Mirador's command line for PowerShell and cmd, e.g. `mirador when-done`; Git Bash runs the mirador script beside this file.
rem It runs on the Bun MIRADOR_BUN names, or the one on your PATH.
setlocal
rem A pid typed here is already a Windows pid, also in a PowerShell started from Git Bash.
set MSYSTEM=
set "bun=%MIRADOR_BUN%"
if not defined bun for %%b in (bun.exe) do set "bun=%%~$PATH:b"
if not defined bun set "bun=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%bun%" echo mirador: Bun not found. Put bun on your PATH, or set MIRADOR_BUN to its path. 1>&2
if not exist "%bun%" exit /b 1
"%bun%" "%~dp0..\host\cli.ts" %*
