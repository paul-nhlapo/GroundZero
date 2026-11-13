# Builds the web app and the server into one small image.
FROM node:22-slim AS build
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server ci && npm --prefix web ci
COPY server server
COPY web web
RUN npm --prefix web run build && npm --prefix server run build && npm --prefix server prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
