FROM mirror.gcr.io/library/node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js games.js football.js app.js index.html privacy.html terms.html style.css icon.svg icon-192.png icon-512.png og.jpg manifest.webmanifest ./
COPY data ./data
USER node
CMD ["node", "server.js"]
