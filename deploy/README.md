# gd6.super-idol.com VPS 联网测试

此配置运行一个 Node.js 后端进程，房间、身份和战绩写入 Docker 命名卷。客户端入口已经默认指向 `https://gd6.super-idol.com`。配置文件就绪不代表域名或 VPS 已经部署成功。

本地验证：Compose 配置解析、后端 ESM 打包、直接使用 Node 启动打包模块后的健康接口/游客登录/建房、49 项回归测试及客户端构建通过。本机 Docker daemon 未运行，尚未验证镜像构建与容器启动；VPS 部署、证书签发和公网 WSS 验收需要连接服务器后完成。

## 前提

- Linux VPS 已安装 Docker Engine 和 Compose 插件。
- DNS 中 `gd6.super-idol.com` 的 A 记录指向 VPS 公网 IPv4；只有实际支持 IPv6 时才添加 AAAA。
- 使用本项目 Caddy 时，VPS 的 TCP 80/443 可从公网访问，且没有其他进程占用。若已运行 Nginx、Caddy 或面板网站，请复用现有反向代理，按下面的“已有反向代理”部署，勿停掉其他网站。
- SSH 密码、私钥和微信 AppSecret 不进入 Git。

## 空闲 VPS：自动 HTTPS

在准备安装项目的目录执行：

```sh
git clone https://github.com/xiwei26/guandan-six.git
cd guandan-six
cp .env.example .env
chmod 600 .env
# 在服务器本地编辑 .env：确认小游戏 AppID，按需填写 WECHAT_SECRET。
# 未填写密钥时，仍可以使用游客完成六人联网测试。
docker compose --profile https up -d --build
docker compose ps
curl --fail https://gd6.super-idol.com/api/health
```

健康接口应返回 `ok: true` 和 `ruleVersion: 6P_V2`。Caddy 自动申请和续期证书，转发 HTTP 与 WebSocket。后端 3001 只绑定 VPS 回环地址，公网使用 443。

## 已有反向代理

```sh
docker compose up -d --build app
curl --fail http://127.0.0.1:3001/api/health
```

在已有代理中，为 `gd6.super-idol.com` 配置证书并将全部请求转发到 `http://127.0.0.1:3001`，包括 `/api/` 和 `/ws`；开启 WebSocket Upgrade 支持。不要启用本项目 `https` profile，否则会抢占 80/443。若现有代理也运行在容器内，需将它接入应用 Docker 网络，代理目标改为 `app:3001`，不能用代理容器自己的回环地址。

## 微信开发者工具与真机

1. 在小游戏管理后台配置 request 合法域名 `https://gd6.super-idol.com` 和 socket 合法域名 `wss://gd6.super-idol.com`。这里填域名，不带 `/ws`。
2. 重新编译小游戏。如果以前保存过本机地址，在大厅「连接设置」改成 `https://gd6.super-idol.com`；已有设置优先于代码默认值。
3. 六名测试者分别进入同一房间，准备后开局。验证不同网络下出牌同步、切后台重进和下一局。服务端只发送各自手牌。
4. 微信登录需要 `.env` 中 AppID 与小游戏一致，并填写该账号 AppSecret；游客身份和微信身份目前不会自动合并。

## 更新、日志和备份

更新会短暂断开 socket，客户端可重新连接。建议牌局结束后更新。

```sh
git pull --ff-only
# 空闲 VPS 使用下行；已有代理只更新 app 服务。
docker compose --profile https up -d --build
docker compose logs --tail 100 app caddy
```

数据卷不会随着重建镜像被清空。不要执行 `docker compose down -v`，它会删除存档与证书卷。

服务器备份（存档采用原子替换，读取到的是完整快照）：

```sh
mkdir -p backups
chmod 700 backups
backup="backups/state-$(date +%Y%m%d-%H%M%S).json"
umask 077
docker compose exec -T app node -e 'process.stdout.write(require("fs").readFileSync("/app/data/state.json"))' > "$backup"
```

首次产生身份或房间前可能尚无 `state.json`。备份应另存到 VPS 以外的位置；恢复存档需先停止 app，再将备份写回数据卷并保持 node 用户可写，不能在运行时覆盖。

当前仍为小规模测试部署：单进程 JSON 存档，不支持多副本共享写入；尚未验证大规模并发。反向代理后的请求限流当前按代理连接地址聚合，六人测试可以使用，大规模开放前需单独完善受信代理和按玩家限流。
