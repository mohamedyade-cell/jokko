const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');

const ALLOWED = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const PROOF_ALLOWED = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

// Formats produits par MediaRecorder (webm / mp4) et par les caméras des téléphones.
const VIDEO_TYPES = { 'video/webm': '.webm', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp' };
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

function rejected(message) {
  const err = new Error(message);
  err.code = 'INVALID_FILE_TYPE';
  return err;
}

function diskUpload(dir, { maxBytes, accept, extension, message }) {
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + extension(file)),
    }),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => (accept(file) ? cb(null, true) : cb(rejected(message))),
  });
}

const extOf = (file) => path.extname(file.originalname).toLowerCase();

function cvUpload(uploadDir) {
  return diskUpload(uploadDir, {
    maxBytes: 5 * 1024 * 1024,
    accept: (f) => Boolean(ALLOWED[extOf(f)]),
    extension: extOf,
    message: 'Le CV doit être un fichier PDF, DOC ou DOCX.',
  });
}

function proofUpload(uploadDir) {
  return diskUpload(uploadDir, {
    maxBytes: 5 * 1024 * 1024,
    accept: (f) => Boolean(PROOF_ALLOWED[extOf(f)]),
    extension: extOf,
    message: 'Le justificatif doit être un PDF, JPG ou PNG.',
  });
}

function baseMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

function videoUpload(uploadDir) {
  return diskUpload(path.join(uploadDir, 'videos'), {
    maxBytes: MAX_VIDEO_BYTES,
    accept: (f) => Boolean(VIDEO_TYPES[baseMime(f.mimetype)]),
    extension: (f) => VIDEO_TYPES[baseMime(f.mimetype)],
    message: 'Format vidéo non reconnu (WebM, MP4 ou MOV attendu).',
  });
}

module.exports = { cvUpload, proofUpload, videoUpload, baseMime, ALLOWED, PROOF_ALLOWED, VIDEO_TYPES, MAX_VIDEO_BYTES };
