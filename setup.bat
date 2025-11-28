@echo off
echo.
echo  🚀 LIFTOFF - Agent Manager Setup
echo  ================================
echo.
echo  Installing dependencies...
call npm install

echo.
echo  Compiling TypeScript...
call npm run compile

echo.
echo  ✅ Setup complete!
echo.
echo  To run the extension:
echo  1. Open this folder in VS Code
echo  2. Press F5 to launch debug mode
echo  3. Click the rocket icon in the sidebar
echo.
echo  Or install globally:
echo  code --install-extension liftoff-0.1.0.vsix
echo.
pause
