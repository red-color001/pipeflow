FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/server/package.json   ./apps/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk-node/package.json ./packages/sdk-node/

RUN npm install --no-audit --no-fund --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/server     ./apps/server
COPY db              ./db

RUN npm -w @pipeflow/server run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/db ./db
COPY --from=build /app/package.json ./package.json

EXPOSE 4000
CMD ["sh", "-c", "node apps/server/dist/migrate.js && node apps/server/dist/index.js"]
