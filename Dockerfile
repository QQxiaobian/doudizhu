FROM node:20-alpine

WORKDIR /app

# 安装系统依赖（better-sqlite3 编译需要）
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
