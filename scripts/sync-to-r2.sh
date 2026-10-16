#!/usr/bin/env bash
# Run on the deployment host. No remote writes without --apply.
set -euo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${R2_REPO_ROOT:-$script_dir/..}"
config_file="${R2_CONFIG:-}"
apply=false
mirror=false
while (( $# )); do
  case "$1" in
    --apply) apply=true ;;
    --mirror) mirror=true ;;
    --config)
      [[ $# -ge 2 && -n "$2" ]] || { echo '--config requires a JSON file' >&2; exit 1; }
      config_file="$2"; shift ;;
    --help|-h)
      echo 'Usage: bash scripts/sync-to-r2.sh [--config config/r2-sync.json] [--apply] [--mirror]'
      echo 'Default: dry run. --mirror deletes remote objects missing locally within each uploaded prefix.'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

node_bin="${NODE_BIN:-node}"
rclone_bin="${RCLONE_BIN:-rclone}"
curl_bin="${CURL_BIN:-curl}"
for tool in "$node_bin" "$rclone_bin"; do
  command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 1; }
done
if $apply; then command -v "$curl_bin" >/dev/null || { echo "Missing dependency: $curl_bin" >&2; exit 1; }; fi
[[ -f "$repo_root/data/assets.json" && -f "$repo_root/data/chess.json" && -d "$repo_root/public/assets" ]] || {
  echo 'Repository must contain data/assets.json, data/chess.json and public/assets/' >&2; exit 1;
}

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/sp-r2-sync.XXXXXXXX")"
trap 'rm -rf -- "$work_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
rclone_config=()
if [[ -z "$config_file" && -f "$repo_root/config/r2-sync.json" ]]; then config_file="$repo_root/config/r2-sync.json"; fi
if [[ -n "$config_file" ]]; then
  "$node_bin" "$script_dir/prepare-r2-config.mjs" "$config_file" "$work_dir" >/dev/null
  read_config() { "$node_bin" -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))[process.argv[2]]; console.log(typeof v === "object" ? JSON.stringify(v) : v)' "$work_dir/runtime.json" "$1"; }
  target="$(read_config target)"
  data_base="$(read_config dataBaseUrl)"
  assets_base="$(read_config assetsBaseUrl)"
  transfers="$(read_config transfers)"
  checkers="$(read_config checkers)"
  routes="$(read_config packRoutes)"
  zone_id="$(read_config zoneId)"
  [[ "$(read_config mirror)" != true ]] || mirror=true
  read_config purge > "$work_dir/purge.json"
  rclone_config=(--config "$work_dir/rclone.conf")
else
  target="${R2_TARGET:?Set R2_TARGET or use --config}"
  data_base="${DATA_CDN_BASE_URL:?Set DATA_CDN_BASE_URL or use --config}"
  assets_base="${ASSETS_CDN_BASE_URL:?Set ASSETS_CDN_BASE_URL or use --config}"
  transfers="${R2_TRANSFERS:-32}"
  checkers="${R2_CHECKERS:-64}"
  routes="${SP_RESOURCE_PACK_ROUTES:-[]}"
  zone_id="${CF_ZONE_ID:-}"
  # Legacy environment mode retains the documented whole-zone purge.
  printf '%s\n' '{"purge_everything":true}' > "$work_dir/purge.json"
  if $apply; then
    [[ "$zone_id" =~ ^[a-fA-F0-9]{32}$ && -n "${CF_API_TOKEN:-}" ]] || { echo 'Set CF_ZONE_ID and CF_API_TOKEN for cache purge' >&2; exit 1; }
    "$node_bin" -e 'const fs=require("node:fs"); const token=process.env.CF_API_TOKEN; if(/[\r\n\0]/.test(token)) throw Error("Invalid CF_API_TOKEN"); fs.writeFileSync(process.argv[1], "header = " + JSON.stringify("Authorization: Bearer " + token) + "\n", {mode:0o600});' "$work_dir/curl.conf"
  fi
fi
[[ "$target" =~ ^[A-Za-z0-9_-]+:[A-Za-z0-9][A-Za-z0-9._/-]*$ && "$target" != *'/../'* && "$target" != */.. ]] || { echo 'Invalid R2 target' >&2; exit 1; }
[[ "$transfers" =~ ^[1-9][0-9]*$ && "$checkers" =~ ^[1-9][0-9]*$ ]] || { echo 'Transfers and checkers must be positive integers' >&2; exit 1; }

mkdir -- "$work_dir/data"
cp -a -- "$repo_root/data/." "$work_dir/data/"
"$node_bin" "$script_dir/prepare-r2-data.mjs" "$work_dir/data" "$repo_root/public" "$assets_base" "$routes"
operation=copy
flags=(--checksum --fast-list --transfers "$transfers" --checkers "$checkers" --retries 3 --stats 10s)
if $mirror; then operation=sync; flags+=(--delete-after); fi
if ! $apply; then flags+=(--dry-run); echo 'DRY RUN: no uploads, deletions or cache purge.'; fi
upload() {
  local source="$1" prefix="$2" cache_control="$3"
  echo "Sync $prefix -> ${target%/}/$prefix"
  "$rclone_bin" "$operation" "$source" "${target%/}/$prefix" "${rclone_config[@]}" "${flags[@]}" --s3-no-check-bucket --header-upload "Cache-Control: $cache_control"
}
# Publish all payloads before data manifests that reference them.
upload "$repo_root/public/assets" assets 'public, max-age=86400'
for prefix in fonts i18n resource-packs; do
  if [[ -d "$repo_root/public/$prefix" ]]; then upload "$repo_root/public/$prefix" "$prefix" 'public, max-age=86400'; fi
done
if [[ -d "$repo_root/packs" ]]; then
  # UI and game texts share pack paths, so upload packs to the same bucket root.
  upload "$repo_root/packs" packs 'no-cache'
fi
upload "$work_dir/data" data 'no-cache'

if $apply; then
  "$curl_bin" --config "$work_dir/curl.conf" --fail-with-body --silent --show-error \
    --connect-timeout 15 --max-time 120 --request POST \
    --header 'Content-Type: application/json' --data-binary "@$work_dir/purge.json" \
    "https://api.cloudflare.com/client/v4/zones/$zone_id/purge_cache" > "$work_dir/purge-response.json"
  "$node_bin" -e 'const fs=require("node:fs"); const body=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(body.success !== true) { console.error("Cloudflare cache purge failed; retry the script after fixing API permissions."); process.exit(1); } console.log("Cloudflare cache purge accepted.");' "$work_dir/purge-response.json"
fi
