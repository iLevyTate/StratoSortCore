const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const { scanDirectory } = require('../src/main/folderScanner');

describe('scanDirectory symlink handling', () => {
  test('ignores symbolic links', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-'));

    const realFile = path.join(tmpDir, 'real.txt');
    await fs.writeFile(realFile, 'content');

    let symlinkPath;

    try {
      // On Windows, symlink creation might fail due to permissions
      if (process.platform === 'win32') {
        // Try to create symlink, but don't fail the test if it doesn't work
        try {
          symlinkPath = path.join(tmpDir, 'link.txt');
          await fs.symlink(realFile, symlinkPath);
        } catch (symlinkError) {
          // If symlink creation fails on Windows, skip the symlink part of the test
          console.warn(
            'Symlink creation failed on Windows (requires elevated privileges):',
            symlinkError.message
          );
        }
      } else {
        // On Unix-like systems, symlinks should work
        symlinkPath = path.join(tmpDir, 'link.txt');
        await fs.symlink(realFile, symlinkPath);
      }

      const items = await scanDirectory(tmpDir);

      await fs.rm(tmpDir, { recursive: true, force: true });

      const names = items.map((item) => item.name);
      expect(names).toContain('real.txt');

      // Verify symlink handling - should always have 1 file
      expect(items).toHaveLength(1);
      // When symlink is created, it should be excluded
      expect(names).not.toContain('link.txt');
    } catch (error) {
      // Clean up on any error
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (cleanupError) {
        if (cleanupError) {
          // Ignore cleanup errors
        }
      }
      throw error;
    }
  });
});
