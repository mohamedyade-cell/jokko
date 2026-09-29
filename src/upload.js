const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');

const ALLOWED = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function cvUpload(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED[path.extname(file.originalname).toLowerCase()]) return cb(null, true);
      const err = new Error('Le CV doit être un fichier PDF, DOC ou DOCX.');
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    },
  });
}

module.exports = { cvUpload, ALLOWED };
