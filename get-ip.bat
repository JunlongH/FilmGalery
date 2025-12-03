@echo off
chcp 65001 > nul
echo.
echo ========================================
echo   FilmGallery - 获取局域网 IP 地址
echo ========================================
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4" ^| findstr /V "127.0.0.1"') do (
    set IP=%%a
    goto :found
)

:found
set IP=%IP: =%
if "%IP%"=="" (
    echo [错误] 未找到有效的 IPv4 地址
    echo 请确保电脑已连接到网络
    goto :end
)

echo [成功] 找到您的局域网 IP 地址:
echo.
echo     %IP%
echo.
echo ========================================
echo   移动端配置
echo ========================================
echo.
echo 在移动端 App 的 Settings 页面输入:
echo.
echo     http://%IP%:4000
echo.
echo ========================================
echo.
echo 提示:
echo   1. 确保桌面端应用正在运行
echo   2. 确保手机和电脑在同一个 Wi-Fi 网络
echo   3. 如无法连接，请检查防火墙设置
echo.

:end
pause
