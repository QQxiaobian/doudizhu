# 在线斗地主 🃏

一个完整的在线斗地主游戏，支持好友联机、人机对战、记牌器、账号系统与管理员后台。

## 功能特性

- **账号系统**：用户注册 / 登录，密码 bcrypt 加密，JWT 鉴权
- **好友联机**：创建房间，通过房间号邀请好友实时对战
- **人机对战**：内置 AI 玩家，支持单人练习
- **完整规则**：单张、对子、三张、三带一/二、顺子、连对、飞机、炸弹、火箭等全部牌型
- **叫地主**：1-3 分叫分，底牌归属地主
- **记牌器**：实时统计剩余牌数，管理员可按玩家开关
- **声音与音乐**：Web Audio API 生成出牌音效、炸弹音效、背景音乐，音量可调
- **管理员后台**：管理用户、设置每个玩家的记牌器/音效/音乐开关、全局音量控制

## Docker 部署

```bash
# 克隆后在项目根目录执行
docker compose up -d --build
```

服务启动后访问 `http://localhost:3000`。

默认管理员账号：`admin` / `admin123`（首次启动自动创建，登录后可在管理后台修改）。

数据持久化在 Docker volume `doudizhu-data` 中。

## 本地运行

```bash
npm install
npm start
# 访问 http://localhost:3000
```

## 项目结构

```
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server/
│   ├── index.js          # 服务入口
│   ├── db.js             # SQLite 数据库
│   ├── auth.js           # JWT 鉴权
│   ├── routes.js         # HTTP 接口（认证/管理）
│   ├── room.js           # 房间与游戏流程
│   ├── sockets.js        # Socket.io 实时交互
│   └── game/
│       ├── doudizhu.js   # 核心牌型规则
│       └── ai.js         # AI 玩家逻辑
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── app.js        # 认证/大厅/路由
        ├── game.js       # 游戏界面
        ├── admin.js      # 管理后台
        └── sound.js      # 音效与音乐
```

## 管理员功能

登录管理员账号后，点击右上角 ⚙️ 图标进入后台：

- **用户管理**：为每个玩家单独开启/关闭记牌器、音效、音乐，设置管理员权限
- **全局设置**：全局音效/音乐/记牌器开关，音效与音乐音量调节
