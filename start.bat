@echo off
setlocal EnableDelayedExpansion

REM === Проверка Node.js/npm ===
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ════════ Ошибка запуска Kaitos ═════════╗
    echo                                         ║
    echo ❌ Node.js не найден!
    echo Установите: https://nodejs.org/
    echo После установки запустите start.bat снова.
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
    echo После установки запустите start.bat снова.
    echo ==========================================╝
    pause
    exit /b 1
)

echo ════════ Kaitos ═════════════════════╗
echo                                         ║
echo ✅ Node.js и npm найдены!
echo ==============================================╝
echo                                          ║
REM Проверка, не запущен ли уже сервер на порту 5173 или 5178
netstat -aon | findstr "5173" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo ⚠️ Предупреждение: порт 5173 уже занят! Вдруг это Kaitos — второй экземпляр не запустится.
) else (
    echo ✅ Порт 5173 свободен или занят другим процессом без конфликта.
)

netstat -aon | findstr "5178" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo ⚠️ Предупреждение: порт 5178 уже занят! Вдруг это сервер файлов Kaitos.
) else (
    echo ✅ Порт 5178 свободен или занят другим процессом без конфликта.
)

echo                                          ║

REM === Установка зависимостей если есть lock-файл ===
if exist package-lock.json (
    echo 🔄 Запуск npm ci для установки/обновления зависимостей...
    call npm ci --loglevel warn || (
        goto :error_installation_failed
    )
) else if exist package.json (
    echo ℹ️  package-lock.json отсутствует, устанавливаем через npm install...
    call npm install --loglevel warn || (
        goto :error_installation_failed
    )
) else (
echo ════════ Ошибка запуска Kaitos ═════════╗
    echo                                         ║
    echo ❌ Проект не найден в этой папке!
    echo Нет ни package.json, ни package-lock.json.
    echo Проверьте путь: откройте start.bat из корня проекта.
    echo ==========================================╝
    pause
    exit /b 1
)

echo                                          ║
REM === Запуск через npm run dev:full ===
echo 🚀 Кaitos запускается в дисковом режиме (сервер файлов + приложение)...
call npm run dev:full || goto :error_start_failed


GOTO :EOF

:error_installation_failed
:==========================================================═╗ 
║                                                            ║
❌ Не удалось установить зависимости!                   ║
Посмотрите сообщение об ошибке выше.                        ║
Попробуйте вручную в командной строке:                            ║ npm ci (или npm install)                                     ║
================================================================╝

:error_start_failed
echo ℹ️  Команда dev:full завершилась с кодом %ERRORLEVEL%


REM Пауза перед выходом чтобы пользователь мог прочитать ошибки
pause >nul
