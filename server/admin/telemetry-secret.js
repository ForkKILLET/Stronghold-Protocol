import fs from 'node:fs';
export function telemetryToken(value) {
  if (value === undefined) value = process.env.SP_ADMIN_TOKEN_FILE
    ? fs.readFileSync(process.env.SP_ADMIN_TOKEN_FILE,'utf8').replace(/\r?\n$/,'') : process.env.SP_ADMIN_TOKEN;
  if (!value) return null;
  if (typeof value !== 'string' || value.length < 32 || Buffer.byteLength(value) > 512) throw Error('Collector token requires 32–512 characters');
  return value;
}
