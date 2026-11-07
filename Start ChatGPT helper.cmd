@echo off
pushd "%~dp0"
node scripts\chatgpt-helper.mjs
if errorlevel 1 pause
popd
