ARG NODE_IMAGE=node:22-alpine
ARG ASSET_IMAGE
FROM ${ASSET_IMAGE} AS assets
FROM ${NODE_IMAGE} AS page
WORKDIR /app
COPY public/downloads ./public/downloads
COPY public/css/theme.css ./public/css/theme.css
COPY tools/build-downloads.mjs ./tools/build-downloads.mjs
COPY --from=assets /app/public/fonts ./public/fonts
RUN node tools/build-downloads.mjs /out

FROM ${NODE_IMAGE}
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG SOURCE_REVISION=unknown
RUN http_proxy="${HTTP_PROXY}" https_proxy="${HTTPS_PROXY}" apk add --no-cache nginx
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
COPY --from=page /out /srv/downloads
COPY deploy/downloads/nginx.conf /etc/nginx/downloads.conf.template
COPY deploy/downloads/start.sh /usr/local/bin/start-downloads
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD node -e 'fetch("http://127.0.0.1:8080/downloads/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
ENTRYPOINT ["sh", "/usr/local/bin/start-downloads"]
