@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === 1. Check Python ===
python --version
if errorlevel 1 (echo [FAIL] python not found & pause & exit /b 1)

echo.
echo === 2. Check pip ===
python -m pip --version
if errorlevel 1 (echo [FAIL] pip not found & pause & exit /b 1)

echo.
echo === 3. Install with verbose (so you see output) ===
python -m pip install -r requirements.txt -v

echo.
echo === 4. Done ===
pause
