const fs = require('fs');
const path = require('path');
const fsPromises = require('fs').promises;

function moveFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    // Try atomic rename first
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device: copy and unlink
      fs.copyFileSync(src, dest);
      try { fs.unlinkSync(src); } catch (e) {}
    } else if (err.code === 'EPERM' || err.code === 'EBUSY') {
      // Locked or permission issue.
      // Do NOT unlink dest explicitly, as it causes data loss if subsequent write fails.
      // Try copyFileSync which overwrites and might handle locks differently or at least fail safely.
      try {
        fs.copyFileSync(src, dest);
        try { fs.unlinkSync(src); } catch (e) {}
      } catch (copyErr) {
        // If copy fails, throw the error. Dest is preserved (if it existed).
        console.error('moveFileSync failed (locked?):', copyErr);
        throw copyErr;
      }
    } else {
      throw err;
    }
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function moveFileAsync(src, dest, retries = 3) {
  await fsPromises.mkdir(path.dirname(dest), { recursive: true });
  
  for (let i = 0; i < retries; i++) {
    try {
      await fsPromises.rename(src, dest);
      return;
    } catch (err) {
      console.log(`[moveFileAsync] Attempt ${i+1} failed for ${src} -> ${dest}: ${err.code}`);
      const isLastAttempt = i === retries - 1;
      if (err.code === 'EXDEV') {
        await fsPromises.copyFile(src, dest);
        await fsPromises.unlink(src).catch(() => {});
        return;
      }
      
      if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
        if (isLastAttempt) throw err;
        // Wait longer for each retry (e.g. 500ms, 1000ms, 1500ms)
        await sleep(500 * (i + 1));
        continue;
      }
      
      throw err;
    }
  }
}

module.exports = { moveFileSync, moveFileAsync };
