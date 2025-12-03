# 快速获取电脑 IP 地址

## 方法一：使用 PowerShell（推荐）

打开 PowerShell，复制粘贴以下命令：

```powershell
# 自动获取当前活动网络的 IPv4 地址
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.PrefixOrigin -eq 'Dhcp' -and $_.InterfaceAlias -notlike '*Loopback*' -and $_.InterfaceAlias -notlike '*VirtualBox*' -and $_.InterfaceAlias -notlike '*VMware*'} | Select-Object -First 1).IPAddress
Write-Host "`n您的局域网 IP 地址是: $ip" -ForegroundColor Green
Write-Host "`n移动端应输入: http://${ip}:4000" -ForegroundColor Yellow
Write-Host ""
```

## 方法二：使用 ipconfig

1. 打开命令提示符或 PowerShell
2. 输入命令：
   ```
   ipconfig
   ```
3. 找到以下部分之一：
   - **无线局域网适配器 WLAN**（如果使用 Wi-Fi）
   - **以太网适配器 以太网**（如果使用网线）
4. 记录其中的 **IPv4 地址**，例如：`192.168.1.100`

## 方法三：在桌面端应用中显示（待实现）

可以考虑在桌面端应用的设置页面显示当前 IP，方便用户配置移动端。

## 示例输出

```
无线局域网适配器 WLAN:

   连接特定的 DNS 后缀 . . . . . . . :
   IPv4 地址 . . . . . . . . . . . . : 192.168.1.100  ← 这个就是你需要的
   子网掩码  . . . . . . . . . . . . : 255.255.255.0
   默认网关. . . . . . . . . . . . . : 192.168.1.1
```

## 移动端配置

在移动端 App 的 Settings 页面：
1. 找到 "API Base URL" 输入框
2. 输入：`http://YOUR_IP:4000`
   - 例如：`http://192.168.1.100:4000`
3. 点击 Save
4. 返回主页，数据应该开始加载

## 故障排查

### 无法连接
1. 确认桌面端应用正在运行
2. 确认手机和电脑在同一个 Wi-Fi 网络
3. 关闭电脑的 VPN（VPN 可能改变网络路由）
4. 检查 Windows 防火墙（见下方）

### 防火墙配置

如果仍无法连接，需要在防火墙中开放端口 4000：

**PowerShell（管理员权限）**：
```powershell
New-NetFirewallRule -DisplayName "FilmGallery API" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
```

**或者手动配置**：
1. 打开"控制面板" → "Windows Defender 防火墙"
2. 点击"高级设置"
3. 选择"入站规则" → "新建规则"
4. 选择"端口"，下一步
5. 选择 TCP，特定本地端口：`4000`，下一步
6. 选择"允许连接"，下一步
7. 全部勾选（域、专用、公用），下一步
8. 名称：`FilmGallery API`，完成

### 测试连接

在手机浏览器中访问：`http://YOUR_IP:4000/api/rolls`

如果能看到 JSON 数据，说明连接成功。
