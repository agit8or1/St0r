import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

const DOCS_DIR = '/opt/urbackup-gui/docs';

// List available documentation files
router.get('/list', (req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(DOCS_DIR);
    const docs = files.map(file => {
      const stats = fs.statSync(path.join(DOCS_DIR, file));
      return {
        filename: file,
        size: stats.size,
        modified: stats.mtime
      };
    });

    res.json({
      success: true,
      documentation: docs
    });
  } catch (error: any) {
    logger.error('Failed to list documentation:', error);
    res.status(500).json({
      error: 'Failed to list documentation',
      message: error.message
    });
  }
});

// Download a specific documentation file
router.get('/download/:filename', (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const filePath = path.join(DOCS_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Set appropriate headers
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Set content type based on extension
    if (filename.endsWith('.ps1')) {
      res.setHeader('Content-Type', 'text/plain');
    } else if (filename.endsWith('.sh')) {
      res.setHeader('Content-Type', 'text/x-shellscript');
    } else if (filename.endsWith('.txt')) {
      res.setHeader('Content-Type', 'text/plain');
    }

    // Send file
    res.sendFile(filePath);
    logger.info(`Documentation file downloaded: ${filename} by ${(req as any).user.username}`);

  } catch (error: any) {
    logger.error('Failed to download documentation:', error);
    res.status(500).json({
      error: 'Failed to download file',
      message: error.message
    });
  }
});

export default router;
