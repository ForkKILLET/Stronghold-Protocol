import fs from 'node:fs/promises';
import path from 'node:path';
import { parseResourcePackRoutes } from '../shared/resourcePackRoutes.js';

const [configPath, tempDir] = process.argv.slice(2);
if (!configPath || !tempDir) throw new Error('usage: prepare-r2-config.mjs <config.json> <temporary-directory>');

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const r2 = config.r2 || {};
const cdn = config.cdn || {};
const cloudflare = config.cloudflare || {};
const sync = config.sync || {};
const required = [
  ['r2.accountId', r2.accountId], ['r2.accessKeyId', r2.accessKeyId],
  ['r2.secretAccessKey', r2.secretAccessKey], ['r2.bucket', r2.bucket],
  ['cdn.dataBaseUrl', cdn.dataBaseUrl], ['cdn.assetsBaseUrl', cdn.assetsBaseUrl],
  ['cloudflare.zoneId', cloudflare.zoneId], ['cloudflare.apiToken', cloudflare.apiToken],
];
for (const [name, value] of required) if (typeof value !== 'string' || !value.trim()) throw new Error(`R2 config missing ${name}`);
for (const [name, value] of required) if (/[\r\n\0]/.test(value)) throw new Error(`R2 config invalid ${name}`);
if (!/^[a-f0-9]{32}$/i.test(r2.accountId)) throw new Error('r2.accountId must be 32 hexadecimal characters');
if (!/^[a-f0-9]{32}$/i.test(cloudflare.zoneId)) throw new Error('cloudflare.zoneId must be 32 hexadecimal characters');
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(r2.bucket)) throw new Error('r2.bucket is invalid');
for (const [name, value] of [['cdn.dataBaseUrl', cdn.dataBaseUrl], ['cdn.assetsBaseUrl', cdn.assetsBaseUrl]]) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${name} must be an HTTPS base URL without credentials/query/hash`);
}
const prefix = String(r2.prefix || '').replace(/^\/+|\/+$/g, '');
if (prefix.split('/').some((part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) {
  if (prefix) throw new Error('r2.prefix contains an invalid path component');
}
const purgeMode = cloudflare.purgeMode || 'prefixes';
for (const key of ['transfers', 'checkers']) {
  if (sync[key] != null && (!Number.isInteger(sync[key]) || sync[key] < 1 || sync[key] > 256)) throw new Error(`sync.${key} must be an integer from 1 to 256`);
}
const packRoutes = parseResourcePackRoutes(sync.packRoutes);
if (!['prefixes', 'hosts', 'everything'].includes(purgeMode)) throw new Error('cloudflare.purgeMode must be prefixes, hosts or everything');
const baseInfo = (value) => {
  const url = new URL(value);
  return { host: url.host, path: url.pathname.replace(/\/+$/, '') };
};
const dataBase = baseInfo(cdn.dataBaseUrl);
const assetsBase = baseInfo(cdn.assetsBaseUrl);
let purge;
if (purgeMode === 'everything') purge = { purge_everything: true };
else if (purgeMode === 'hosts') purge = { hosts: [...new Set([dataBase.host, assetsBase.host])] };
else purge = { prefixes: [...new Set([
  `${dataBase.host}${dataBase.path}/data/`,
  `${dataBase.host}${dataBase.path}/packs/`,
  ...['assets/', 'fonts/', 'i18n/', 'packs/', 'resource-packs/'].map((part) => `${assetsBase.host}${assetsBase.path}/${part}`),
])] };

const rclonePath = path.join(tempDir, 'rclone.conf');
const curlPath = path.join(tempDir, 'curl.conf');
const runtimePath = path.join(tempDir, 'runtime.json');
await fs.mkdir(tempDir, { recursive: true });
await fs.writeFile(rclonePath, [
  '[r2]',
  'type = s3',
  'provider = Cloudflare',
  `access_key_id = ${r2.accessKeyId}`,
  `secret_access_key = ${r2.secretAccessKey}`,
  `endpoint = https://${r2.accountId}.r2.cloudflarestorage.com`,
  'region = auto',
  '',
].join('\n'), { mode: 0o600 });
const curlHeader = `Authorization: Bearer ${cloudflare.apiToken}`.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
await fs.writeFile(curlPath, `header = "${curlHeader}"\n`, { mode: 0o600 });
await fs.chmod(rclonePath, 0o600);
await fs.chmod(curlPath, 0o600);
await fs.writeFile(runtimePath, JSON.stringify({
  target: `r2:${r2.bucket}${prefix ? `/${prefix}` : ''}`,
  dataBaseUrl: cdn.dataBaseUrl.replace(/\/+$/, ''),
  assetsBaseUrl: cdn.assetsBaseUrl.replace(/\/+$/, ''),
  transfers: sync.transfers ?? 32,
  checkers: sync.checkers ?? 64,
  mirror: sync.mirror === true,
  packRoutes,
  purge,
  rclonePath,
  curlPath,
  zoneId: cloudflare.zoneId,
}), { mode: 0o600 });
await fs.chmod(runtimePath, 0o600);
console.log(runtimePath);
