const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SECONDS = 90;

// Recompresse une vidéo envoyée depuis la caméra du téléphone (souvent en haute définition)
// en 480p / ~500 kbit/s, pour qu'elle se charge bien sur une connexion mobile moyenne.
// Actif uniquement si FFMPEG_PATH est défini ; sinon la vidéo est gardée telle quelle
// (l'enregistreur intégré au navigateur produit déjà un fichier léger).
function compressVideo(inputPath, callback) {
  const ffmpeg = process.env.FFMPEG_PATH;
  if (!ffmpeg) return callback(null, null);
  const output = inputPath.replace(/\.[^.]+$/, '') + '-480p.mp4';
  const args = [
    '-y', '-i', inputPath,
    '-t', String(MAX_SECONDS + 2),
    '-vf', 'scale=-2:480',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-maxrate', '600k', '-bufsize', '1200k',
    '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart',
    output,
  ];
  execFile(ffmpeg, args, { timeout: 5 * 60 * 1000 }, (err) => {
    if (err || !fs.existsSync(output)) {
      fs.rm(output, { force: true }, () => {});
      return callback(err || new Error('compression échouée'));
    }
    callback(null, { path: output, filename: path.basename(output), mime: 'video/mp4' });
  });
}

module.exports = { compressVideo, MAX_SECONDS };
