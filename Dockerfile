FROM mirror.gcr.io/library/node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js games.js football.js app.js index.html style.css ./
COPY data ./data
USER node
CMD ["node", "server.js"]
