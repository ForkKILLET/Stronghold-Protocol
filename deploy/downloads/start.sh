#!/bin/sh
set -eu
rate=${SP_DOWNLOAD_RATE:-1m}
connections=${SP_DOWNLOAD_CONNECTIONS:-4}
printf '%s' "$rate" | grep -Eq '^[0-9]{1,8}[km]?$' || exit 64
printf '%s' "$connections" | grep -Eq '^([1-9]|[1-5][0-9]|6[0-4])$' || exit 64
sed -e "s/__RATE__/$rate/g" -e "s/__CONNECTIONS__/$connections/g" /etc/nginx/downloads.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
