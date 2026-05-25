FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/web/package.json    ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY packages/sdk-node/package.json ./packages/sdk-node/

RUN npm install --no-audit --no-fund --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/web        ./apps/web

# Bundle uses same-origin /api and /socket.io — nginx proxies to the server.
# No host-specific URLs baked into the JS, so the build works on any IP.
RUN npm -w @pipeflow/web run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
