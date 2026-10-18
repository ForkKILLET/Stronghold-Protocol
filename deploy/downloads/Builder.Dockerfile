ARG ASSET_IMAGE
FROM ${ASSET_IMAGE}
USER root
ARG HTTP_PROXY
ARG HTTPS_PROXY
RUN http_proxy="${HTTP_PROXY}" https_proxy="${HTTPS_PROXY}" apk add --no-cache python3 curl
COPY tools/resource_packs.py tools/resource_downloads.py /download-tools/
ENV PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python3", "/download-tools/resource_downloads.py"]
CMD []
