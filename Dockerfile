FROM mirror.gcr.io/library/nginx:alpine
COPY index.html app.js games.js style.css /usr/share/nginx/html/
