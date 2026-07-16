const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = require('express').Router();
const { isAdmin } = require('../../middleware/auth');
const artifactRepository = require('../../services/videoCanvas/artifactRepository');
const { projectForRequest } = require('./helpers');

fs.mkdirSync(artifactRepository.UPLOAD_ROOT, { recursive: true });
const upload = multer({ dest: path.join(artifactRepository.UPLOAD_ROOT, 'tmp'), limits: { fileSize: 100 * 1024 * 1024 } });

router.get('/', (req, res) => {
  const data = artifactRepository.listArtifacts({ userId: req.user.id, includeAll: isAdmin(req) && req.query.all === '1', projectId: req.query.projectId || '', kind: req.query.kind || '', limit: req.query.limit });
  res.json({ success: true, data });
});
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '未上传文件' });
  const project = projectForRequest(req, req.body.projectId);
  if (!project) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(404).json({ success: false, error: '项目不存在' }); }
  const mime = req.file.mimetype || ''; const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : '';
  if (!kind) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(400).json({ success: false, error: '仅支持图片、视频或音频素材' }); }
  const data = artifactRepository.registerUpload({ projectId: project.id, kind, tempPath: req.file.path, originalName: req.file.originalname, mimeType: mime });
  res.status(201).json({ success: true, data });
});
router.get('/:id/content', (req, res) => {
  if (!artifactRepository.userOwnsArtifact(req.params.id, req.user.id, isAdmin(req))) return res.status(404).json({ success: false, error: '产物不存在' });
  const artifact = artifactRepository.getArtifact(req.params.id);
  if (!artifact.storage_path || !fs.existsSync(artifact.storage_path)) return res.status(404).json({ success: false, error: '产物文件不存在' });
  res.setHeader('Cache-Control', 'private, max-age=3600'); res.sendFile(artifact.storage_path);
});

module.exports = router;
