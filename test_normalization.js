const fs = require('fs');
const path = require('path');
const posixPath = path.posix;

const logFile = path.join(__dirname, 'test_log.txt');
const log = (msg) => fs.appendFileSync(logFile, msg + '\n');

const normalizePath = (filePath) => {
  if (typeof filePath !== 'string') return filePath;
  let normalized = posixPath.normalize(filePath).replace(/\\/g, '/');
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  return normalized;
};

const testPath = path.join(__dirname, 'test_file.txt');
const destPath = path.join(__dirname, 'test_file_moved.txt');

async function test() {
    try {
        log('Starting test');
        fs.writeFileSync(testPath, 'hello');
        
        const cwd = __dirname;
        const absSource = testPath;
        const absDest = destPath;
        
        log('Original Source: ' + absSource);
        const normSource = normalizePath(absSource);
        const normDest = normalizePath(absDest);
        log('Normalized Source: ' + normSource);
        log('Normalized Dest: ' + normDest);

        try {
            await fs.promises.rename(normSource, normDest);
            log('Move successful');
            
            // Move back
            await fs.promises.rename(normDest, normSource);
            log('Move back successful');
        } catch (err) {
            log('Move failed: ' + err.message + ' code: ' + err.code);
        }
        
        // Cleanup
        try { fs.unlinkSync(testPath); } catch {}
        try { fs.unlinkSync(destPath); } catch {}
        
    } catch (e) {
        log('Error: ' + e.message);
    }
}

test();
