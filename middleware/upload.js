const multer = require('multer');
const path = require('path');
const fs = require('fs');

function makeStorage(subfolder) {
  const dest = path.join(__dirname, '..', 'public', 'uploads', subfolder);
  fs.mkdirSync(dest, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    }
  });
}

const equipmentUpload = multer({
  storage: makeStorage('equipment'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|gif)/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed.'), ok);
  }
});

const documentUpload = multer({
  storage: makeStorage('documents'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const avatarUpload = multer({
  storage: makeStorage('avatars'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|gif)/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed.'), ok);
  }
});

module.exports = { equipmentUpload, documentUpload, avatarUpload };
