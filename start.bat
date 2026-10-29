@echo off
setlocal
cd /d "%~dp0"
title Kaitos — локальный запуск

echo Запуск Kaitos из папки: %CD%
where node >nul 2>nul
if errorlevel 1 (
  echo ОШИБКА: Node.js не найден. Установите Node.js 20 LTS или новее и снова откройте это окно.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ОШИБКА: npm не найден. Переустановите Node.js, включив пакетный менеджер npm.
  pause
  exit /b 1
)

node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=18?0:1)"
if errorlevel 1 (
  echo ОШИБКА: требуется Node.js 18 или новее. Рекомендуется Node.js 20 LTS или новее.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Устанавливаю зависимости по package-lock.json. Это может занять несколько минут...
  if exist "package-lock.json" (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo ОШИБКА: не удалось установить зависимости. Проверьте интернет-соединение и повторите запуск.
    pause
    exit /b 1
  )
)

echo Проверяю, не запущен ли уже Kaitos...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $p=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($p.Content -match '<title>Kaitos') { exit 0 }; exit 2 } catch { exit 1 }"
if not errorlevel 1 (
  echo Kaitos уже работает. Открываю существующий экземпляр, второй не запускаю.
  start "" "http://localhost:5173"
  exit /b 0
)
if errorlevel 2 (
  echo ОШИБКА: порт 5173 уже занят другим приложением. Освободите порт и повторите запуск.
  pause
  exit /b 1
)

echo Запускаю сервер и приложение. Логи останутся в этом окне.
start /B "" cmd.exe /d /c "npm run dev:full"

echo Жду готовности локального сервера и интерфейса...
for /L %%I in (1,1,30) do (
  call :check_ready
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)
echo ОШИБКА: Kaitos не стал доступен за 90 секунд. Проверьте сообщения выше и убедитесь, что порты 5173 и 5178 свободны.
pause
exit /b 1

:ready
echo Kaitos готов. Открываю http://localhost:5173
start "" "http://localhost:5173"
echo Окно оставлено открытым для логов. Нажмите Ctrl+C, чтобы остановить Kaitos.
:monitor
timeout /t 2 /nobreak >nul
call :check_ready
if errorlevel 1 goto stopped
goto monitor

:stopped
echo Kaitos остановился или потерял соединение. Проверьте сообщения выше.
pause
exit /b 1

:check_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $p=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173/' -TimeoutSec 1; $h=Invoke-RestMethod 'http://127.0.0.1:5173/api/health' -TimeoutSec 1; if (($p.Content -match '<title>Kaitos') -and $h.ok) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %ERRORLEVEL%
