import fs from 'node:fs';
import path from 'node:path';
export function testLink(source, target, type) {
  if (process.platform !== 'win32') return fs.symlinkSync(source, target, type);
  if (fs.statSync(source).isDirectory()) return fs.symlinkSync(source, target, 'junction');
  try { return fs.symlinkSync(source, target, type); }
  catch (error) {
    if (error.code !== 'EPERM') throw error;
    // Linux/macOS still test file links. Windows also rejects junctions named like files before any read/write.
    return fs.symlinkSync(path.dirname(source), target, 'junction');
  }
}
