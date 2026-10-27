@echo off
setlocal EnableDelayedExpansion

REM === Проверка Node.js/npm ===
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ════════ Ошибка запуска Kaitos ═════════╗
    echo                                         ║
    echo ❌ Node.js не найден!
    echo Установите: https://nodejs.org/
    echo ==========================================╝
    pause
    exit /b 1
)

where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ════════ Ошибка запуска Kaitos ═════════╗
    echo                                         ║
    echo ❌ npm не найден! Это критично для Kaitos.
    echo Установите Node.js LTS с https://nodejs.org/ — там npm в комплекте.
    echo ==========================================╝
    pause
    exit /b 1
)

echo ════════ Kaitos ═════════════════════╗
echo                                         ║
echo ✅ Node.js и npm найдены!
echo ==============================================╝
echo                                          ║

REM === Установка зависимостей если есть lock-файл ===
if exist package-lock.json (
    echo 🔄 Запуск npm ci для установки/обновления зависимостей...
    call npm ci --loglevel warn || goto :error_installation_failed
) else if exist package.json (
    echo ℹ️  package-lock.json отсутствует, устанавливаем через npm install...
    call npm install --loglevel warn || goto :error_installation_failed
)

echo                                          ║

REM === Запуск проекта в дисковом режиме ===
call npm run dev:full || goto :end


GOTO :EOF

:error_installation_failed
echo ==============================================╝ 
║                            ❌ Ошибка                                ║
❌ Не удалось установить зависимости!                      ║
Посмотрите сообщение об ошибке выше.                         ║
Попробуйте:           npm ci (или npm install)               ║
================================================================╚/fi


REM Пауза для чтения ошибок
pause >nul

:end


