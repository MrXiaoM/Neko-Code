# Neko Notifier

Neko Notifier 是一个面向 Windows 的独立常驻服务，为 Zoo Code 的人工审批提供：

- 带待审批数字徽章的系统托盘图标；
- 有待审批时持续闪烁；
- 所有 VS Code 窗口共享的全局 FIFO；
- 单击托盘后快速聚焦全局最早的待审批窗口；
- 基于心跳租约的自动过期清理。

它**不发送系统 Toast**。Zoo Code 扩展始终沿用自己的 Toast 实现，无论本服务是否运行。

## 环境

- Windows 10/11
- Python `>=3.12,<3.13`
- [uv](https://docs.astral.sh/uv/)

## 从源码一键安装

```batch
cd neko-notifier
uv sync
pwsh scripts\build-and-install.ps1
```

## 源码启动

```bash
cd neko-notifier
uv sync
uv run neko-notifier --data-dir "C:/Users/you/AppData/Local/NekoNotifier"
```

`--data-dir` 是服务与 VS Code 扩展共享的专用数据目录。扩展只读取该目录，不会启动、停止或守护服务；通知设置中的“重新加载服务连接”按钮会重新读取发现文件并执行健康检查，方便服务更新后重新连接。

## Windows 构建与安装

构建机需要 Windows、Python 3.12 和 `uv`。以下命令生成包含项目及全部 Windows 依赖 wheel 的离线 zip：

```powershell
pwsh -NoProfile -File scripts/build-package.ps1
```

产物位于 `dist-package/neko-notifier-<version>-windows.zip`。目标机只需 Windows 和 Python `>=3.12,<3.13`，无需 `uv`，安装时也不需要联网。解压后执行包内安装器：

```powershell
pwsh -NoProfile -File neko-notifier/scripts/install.ps1
```

默认路径：

- 安装目录：`%LOCALAPPDATA%\Programs\NekoNotifier`；
- 数据目录：`%LOCALAPPDATA%\NekoNotifier`。

可覆盖路径或仅安装而不立即启动：

```powershell
pwsh -NoProfile -File neko-notifier/scripts/install.ps1 `
  -InstallDirectory "D:\Apps\NekoNotifier" `
  -DataDirectory "D:\Data\NekoNotifier" `
  -DoNotStart
```

开发机可顺序执行构建、解包并安装：

```powershell
pwsh -NoProfile -File scripts/build-and-install.ps1
```

安装器会创建当前用户登录时启动的计划任务 `Neko Notifier`，使用 `pythonw.exe` 在交互式用户会话中运行托盘程序。这里不能使用传统 Windows 服务：服务运行在 Session 0，无法在登录用户桌面显示系统托盘图标。登录计划任务提供相同的自动启动效果，且不需要管理员权限。

安装或更新完成后，在 Zoo Code 的通知设置中填写上述**数据目录**。保存设置后，扩展会重新读取发现文件并执行健康检查；后续更新服务后，可使用同一区域的“重新加载服务连接”按钮重新连接，无需改动设置或重启 VS Code。

服务运行后会写入：

- `neko-notifier.json`：当前服务实例的发现信息；
- `neko-notifier.log`：UTF-8 轮转日志；
- `.neko-notifier.lock`：数据目录单实例锁。

同一数据目录只能运行一个实例。不同数据目录彼此独立。

## 发现文件

`neko-notifier.json` 通过“临时文件 + `fsync` + 原子替换”发布：

```json
{
	"protocolVersion": 1,
	"host": "127.0.0.1",
	"port": 54321,
	"pid": 1234,
	"instanceId": "随机服务实例标识",
	"token": "随机 Bearer 令牌",
	"startedAt": "2026-07-25T15:00:00+00:00"
}
```

扩展必须在启用客户端前：

1. 校验文件大小、JSON 结构、协议版本、回环主机和端口；
2. 使用 `token` 请求 `GET /v1/health`；
3. 核对响应中的 `protocolVersion` 与 `instanceId`。

只有全部成功，当前 VS Code 窗口才使用通知服务。

## HTTP API

服务仅监听动态分配的 `127.0.0.1` 端口。所有接口要求：

```text
Authorization: Bearer <discovery token>
```

### 健康检查

```text
GET /v1/health
```

返回协议版本、服务实例标识、待审批数量、租约 TTL 和建议心跳间隔。

### 创建或更新审批

```text
PUT /v1/approvals/<notificationId>
```

请求体包含 `protocolVersion`、`notificationId`、`clientId`、标题、正文，以及扩展窗口提供的可重复回环聚焦地址和随机回调令牌。

同一个 `notificationId` 的更新是幂等的，不改变它在 FIFO 中的位置。

### 批量心跳

```text
POST /v1/heartbeats
```

扩展只续租自己 `clientId` 所拥有的通知。默认租约 TTL 为 20 秒，建议每 5 秒发送一次心跳。

### 删除审批

```text
DELETE /v1/approvals/<notificationId>
X-Neko-Client-Id: <clientId>
X-Neko-Protocol-Version: 1
```

删除是幂等的。只有匹配的所有者可以删除通知。

### 清理窗口的全部审批

```text
POST /v1/clients/remove
```

用于设置目录变化或扩展停用时尽力清理当前 VS Code 窗口的全部租约。

## 托盘行为

- 无待审批：显示静态猫耳图标；
- 有待审批：在普通和高亮图标间闪烁；
- 徽章显示 `1` 到 `8`，实际数量达到 `9` 或更多时统一显示 `9`；
- tooltip 显示真实待审批数量；
- 左键单击始终调用全局 FIFO 队首的回调；
- 点击不会删除或重排审批；
- 回调失败也不会删除审批；
- 只有扩展显式删除或租约过期才会 dismiss。

## 扩展接入行为

- 未配置数据目录时，扩展客户端完全禁用；
- 扩展激活或保存新目录后，先严格校验发现文件，再调用健康接口核对协议版本和服务实例身份；
- 健康检查失败、心跳失败或服务身份不匹配时，当前窗口立即停用客户端；
- 只有真正阻塞的人工审批会创建租约，自动审批和队列自动响应不会创建租约；
- 审批响应、任务替换、窗口关闭、设置目录变化或扩展停用都会尽力撤销租约，TTL 负责异常退出兜底；
- 托盘聚焦回调在租约存活期间可重复调用，独立于 Toast 使用的一次性回调凭据；
- 系统 Toast 始终由扩展原有实现发送，不受 Neko Notifier 可用性影响。

## 开发检查

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy src
```

`--headless` 仅供自动化测试与诊断使用，不创建 Windows 托盘图标。
