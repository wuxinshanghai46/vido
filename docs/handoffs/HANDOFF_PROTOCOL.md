# VIDO 交接 MD 固定协议

> 本协议适用于以后所有“生成交接 MD”“明天继续”“回家/到公司续接”等请求。

## 一、交接任务必须自动完成的动作

1. 读取最近会话、变更和部署日志，确认当日实际完成内容。
2. 核对当前分支、`HEAD`、工作树和未跟踪文件，不覆盖用户原有修改。
3. `git fetch --all --prune`，核对本地与目标远端分支的 `ahead/behind`。
4. 当用户要求另一台电脑拉取当日更新时，必须把本轮授权范围内的变更提交并推送；不能只生成本地 MD。
5. 通过 SSH 密钥连接生产服务器，核对：
   - 生产目录与运行文件哈希；
   - PM2 状态；
   - 内网和公网健康接口；
   - 数据库只读健康状态；
   - 活动生成任务数量；
   - 是否发生模型、媒体调用或业务写入。
6. 如果本轮包含生产代码并已授权上线，执行备份、原子发布、失败回滚和发布后只读审计；测试范围遵循当前电脑规则，`LAPTOP-LDFOL0GT` 只跑相关模块定向验证，不跑全平台回归。
7. 交接文件必须写入 `docs/handoffs/YYYY-MM-DD-<topic>-handoff.md` 并纳入 Git。
8. 交接完成后再次核对本地、目标 Git 远端与生产运行代码；不一致时必须列出精确差异，不能声称三方一致。

## 二、固定连接信息

- Git 主分支：`codex/story-ad-v3-upgrade`
- 目标远端：`origin` / `gitee`，GitHub 为同步镜像
- 生产主机：`43.98.167.151`
- SSH 用户：`root`
- 推荐 SSH 别名：`vido-prod`
- 生产目录：`/opt/vido/app`
- PM2 应用：`vido`
- 服务端口：`4600`
- 公网健康地址：`https://vido.smsend.cn/api/health`

连接示例：

```powershell
ssh -o BatchMode=yes vido-prod
```

生产采用历史 detached HEAD 加文件级原子发布，因此：

- 本地与 Git：以提交 SHA 和 `ahead/behind=0/0` 为准。
- 生产运行代码：以发布清单逐文件 SHA-256 为准。
- 不能仅凭生产仓库 `git status` 或 detached HEAD 判断运行文件是否一致。

## 三、凭证安全规则

- 禁止把服务器密码、数据库密码、API Key、Token 或 SSH 私钥写入交接 MD、Git、代码、日志或命令示例。
- 服务器只保存客户端公钥；私钥只保存在各自电脑的 `~/.ssh/`。
- 新电脑首次接入时，应在本机生成独立密钥，再把公钥加入服务器；不得通过 Git 复制私钥。
- 如果 `ssh -o BatchMode=yes vido-prod` 失败，交接结论必须写明“该电脑尚未授权 SSH 公钥”，不能退回在 MD 中保存密码。

建议的新电脑初始化：

```powershell
ssh-keygen -t ed25519
```

随后由已经授权的电脑或管理员把新电脑的 `.pub` 公钥追加到服务器。完成后在该电脑创建：

```text
Host vido-prod
    HostName 43.98.167.151
    User root
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

## 四、每份交接 MD 的必备章节

1. 当日目标与用户决策。
2. 修改前后的完整数据流。
3. 代码和文件变更清单。
4. 提交记录、目标分支和公司/家庭电脑拉取命令。
5. 本地、Git、生产三方一致性表。
6. 实际执行的静态、定向、完整和生产验证。
7. 未执行项、剩余风险、费用与数据覆盖边界。
8. 下一次继续优化的明确入口和顺序。

## 五、标准续接命令

```powershell
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
# 随后按当前任务选择真实存在的相关模块测试命令
# LAPTOP-LDFOL0GT 禁止默认运行 platform:upgrade:test
node src/server.js
ssh -o BatchMode=yes vido-prod
```

执行 `git pull` 前必须先看 `git status --short`。禁止使用 `git reset --hard` 覆盖另一台电脑上的未提交工作。
