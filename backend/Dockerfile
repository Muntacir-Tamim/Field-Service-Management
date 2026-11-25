FROM node:22-slim
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN DATABASE_URL=postgresql://u:p@localhost:5432/db npx prisma generate
RUN npm run build

EXPOSE 5000
CMD ["node", "dist/src/server.js"]