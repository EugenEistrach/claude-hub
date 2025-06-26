import { Router } from 'express';
import { executeCommand } from '../controllers/claudeController';

const router = Router();

// POST /api/claude/execute - Execute a Claude command
router.post('/execute', executeCommand);

export default router;
