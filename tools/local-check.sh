#!/usr/bin/env bash
# Local heavy checks must live outside the editor/Paseo cgroup. Never fall back to an unbounded run.
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
  printf 'local-check requires Linux with a user systemd manager.\n' >&2
  exit 69
fi
limit_high=6G limit_max=8G swap_max=512M heap_mb=2048 required_kb=10485760
if [[ ${1:-} == --small ]]; then
  shift
  limit_high=3G limit_max=4G swap_max=256M heap_mb=1024 required_kb=6291456
fi
if (( $# == 0 )); then set -- npm test; fi

if [[ ${SP_LOCAL_CHECK:-} == 1 ]]; then
  group=$(awk -F: '$1 == "0" {print $3}' /proc/self/cgroup)
  max=$(cat "/sys/fs/cgroup${group}/memory.max")
  if [[ $group != *sp-local-check-* || $max == max || $max -gt 8589934592 ]]; then
    printf 'SP_LOCAL_CHECK is set outside the bounded test scope; refusing to bypass limits.\n' >&2
    exit 78
  fi
  exec "$@"
fi

for executable in systemd-run flock; do
  command -v "$executable" >/dev/null || { printf 'Missing %s; refusing an unbounded check.\n' "$executable" >&2; exit 69; }
done
available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
if (( available < required_kb )); then
  printf 'Less than %d MiB available RAM; defer this check.\n' "$((required_kb / 1024))" >&2
  exit 75
fi
exec 9>"${XDG_RUNTIME_DIR:?user runtime directory is required}/stronghold-protocol-check.lock"
flock -n 9 || { printf 'Another bounded Stronghold check is running; run heavy checks sequentially.\n' >&2; exit 75; }

export SP_LOCAL_CHECK=1 SP_TEST_CONCURRENCY=1
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$heap_mb"
printf 'Local check: serial tests; memory high/max %s/%s; swap max %s; Node heap max %s MiB.\n' "$limit_high" "$limit_max" "$swap_max" "$heap_mb" >&2
exec systemd-run --user --scope --quiet --expand-environment=no --unit="sp-local-check-$$" \
  --property="MemoryHigh=$limit_high" --property="MemoryMax=$limit_max" --property="MemorySwapMax=$swap_max" \
  --property=TasksMax=256 --property=OOMPolicy=kill bash -c '
    "$@"; result=$?
    group=$(awk -F: '\''$1 == "0" {print $3}'\'' /proc/self/cgroup)
    printf "Local check memory peak (bytes): " >&2
    cat "/sys/fs/cgroup${group}/memory.peak" >&2
    cat "/sys/fs/cgroup${group}/memory.events" >&2
    exit "$result"
  ' sp-local-check "$@"
