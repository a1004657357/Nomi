const fs = require('node:fs');
const path = require('node:path');

function safePathPart(value, fallback) {
  const normalized = String(value || '')
    .replace(/[\\/\0]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function decodeDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(value || '').trim());
  if (!match) throw new Error('参考素材必须是 base64 data URL');
  return {
    fileType: match[1] || 'application/octet-stream',
    bytes: Buffer.from(match[2], 'base64'),
  };
}

function assertInsideRoot(filePath, rootDir) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(filePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (resolved !== root) throw new Error('参考素材路径越界');
  }
  return resolved;
}

function externalizeTaskReferenceFiles(task, rootDir) {
  const referenceFiles = Array.isArray(task.referenceFiles) ? task.referenceFiles : [];
  let changed = false;
  const safeTaskCode = safePathPart(task.taskCode, 'task');
  const taskDir = path.join(path.resolve(rootDir), safeTaskCode);

  const nextFiles = referenceFiles.map((raw, index) => {
    const file = raw && typeof raw === 'object' ? raw : {};
    if (!file.base64) return file;
    const decoded = decodeDataUrl(file.base64);
    const originalName = path.basename(String(file.fileName || `reference-${index + 1}`));
    const fileName = safePathPart(originalName, `reference-${index + 1}`);
    const storedName = `${String(index).padStart(3, '0')}-${fileName}`;
    fs.mkdirSync(taskDir, { recursive: true });
    const filePath = path.join(taskDir, storedName);
    fs.writeFileSync(filePath, decoded.bytes);
    changed = true;
    return {
      fileName,
      fileType: String(file.fileType || decoded.fileType || 'application/octet-stream'),
      filePath,
      downloadPath: `/api/task-references/${encodeURIComponent(String(task.taskCode || safeTaskCode))}/${index}`,
      size: decoded.bytes.length,
    };
  });

  return {
    changed,
    task: changed ? { ...task, referenceFiles: nextFiles } : task,
  };
}

function readTaskReference(task, index, rootDir) {
  const files = Array.isArray(task && task.referenceFiles) ? task.referenceFiles : [];
  const reference = files[index];
  if (!reference || typeof reference !== 'object' || !reference.filePath) {
    throw new Error('参考素材不存在');
  }
  const filePath = assertInsideRoot(reference.filePath, rootDir);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('参考素材文件不存在');
  }
  return {
    bytes: fs.readFileSync(filePath),
    fileName: String(reference.fileName || path.basename(filePath)),
    fileType: String(reference.fileType || 'application/octet-stream'),
    filePath,
  };
}

module.exports = {
  externalizeTaskReferenceFiles,
  readTaskReference,
};
