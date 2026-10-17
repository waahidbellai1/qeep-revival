# qeep revival - zero-dependency Node server
FROM node:20-alpine

WORKDIR /app

# no dependencies to install, just copy the source
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
