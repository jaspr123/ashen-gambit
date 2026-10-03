# Ashen Gambit — one container: Express + Socket.IO server that also serves the built client.
# Build:  docker build --build-arg VITE_BASE=/Ashengambit/ -t ashen-gambit .
# The 3D armies (apps/client/public/assets/factions, anims, environment.glb) are built
# locally from licensed Synty packs and are NOT in git; include them in the build context
# when building a deployable image (see deploy/README.md).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_BASE=/
ENV VITE_BASE=${VITE_BASE}
RUN npm run build -w @ashen/client

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data UPLOAD_DIR=/data/uploads
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
# tsx runs the TypeScript server directly (no separate compile step).
RUN npm ci --no-audit --no-fund -w @ashen/server -w @ashen/shared --include-workspace-root && npm cache clean --force
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=build /app/apps/client/dist apps/client/dist
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
