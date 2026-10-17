# qeep revival - Node server
FROM node:20-alpine

WORKDIR /app

# install optional deps (pg, used only when DATABASE_URL is set)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund || true

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
