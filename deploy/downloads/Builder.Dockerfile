ARG ASSET_IMAGE
ARG NODE_IMAGE=node:22-alpine
FROM ${ASSET_IMAGE} AS assets

# Keep Python/curl installation cached when the game's resource image changes.
FROM ${NODE_IMAGE} AS download-tools
ARG HTTP_PROXY
ARG HTTPS_PROXY
RUN http_proxy="${HTTP_PROXY}" https_proxy="${HTTPS_PROXY}" apk add --no-cache python3 curl
COPY --from=assets /app/data/resource-manifest.json /app/data/resource-manifest.json
COPY --from=assets /app/public /app/public
COPY tools/resource_packs.py tools/resource_downloads.py /download-tools/
ENV PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python3", "/download-tools/resource_downloads.py"]
CMD []
