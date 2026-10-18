ARG NODE_IMAGE=node:22-alpine
ARG ASSET_IMAGE
FROM ${ASSET_IMAGE} AS assets
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY . .
COPY --from=assets /app/public/fonts ./public/fonts
RUN npm run build:admin

FROM ${NODE_IMAGE}
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
ENV NODE_ENV=production PORT=8000 HOST=0.0.0.0 SP_ADMIN_REVISION=$SOURCE_REVISION
WORKDIR /app
COPY --from=build /app/dist/admin ./
RUN printf '{"type":"module"}\n' > package.json
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD node -e 'fetch("http://127.0.0.1:8000/healthz",{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["node", "server.js"]
