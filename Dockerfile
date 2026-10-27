# ===== 构建阶段：编译原生模块（better-sqlite3） =====
FROM node:20-alpine AS builder

WORKDIR /app

# better-sqlite3 编译需要 python3 / make / g++
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ===== 运行阶段：精简镜像，不含编译工具链 =====
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# 只拷贝编译好的依赖和源码，镜像更小、更安全
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# 数据目录（SQLite 数据库）
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server/index.js"]
