import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { createGroup, deleteGroup, getGroupSettings, listGroups, setEndpointGroup, setGroupSettings } from '../controllers/groups.js';

// UrBackup groups are server-wide, so the whole API is admin only.
const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', listGroups);
router.post('/', createGroup);
router.delete('/:groupId', deleteGroup);
router.get('/:groupId/settings', getGroupSettings);
router.put('/:groupId/settings', setGroupSettings);
router.put('/endpoints/:clientId', setEndpointGroup);

export default router;
