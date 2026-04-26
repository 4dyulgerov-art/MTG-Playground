FROM oven/bun:1.1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY server.js ./

ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["bun", "run", "server.js"]
