import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupService } from '../services/urbackup.js';
import { logger } from '../utils/logger.js';
import { flattenClientSettings, validateGroupName } from '../utils/urbackupSettings.js';

/**
 * UrBackup client groups (issue #57). Group 0 is "Default": its settings are
 * the server-wide defaults. A named group's settings are stored under
 * clientid = -groupid, and its clients inherit them unless they override a
 * setting themselves.
 */
const urbackupService = new UrBackupService();

function groupIdParam(req: AuthRequest, res: Response): number | null {
  const raw = req.params.groupId;
  if (!/^\d+$/.test(raw ?? '')) {
    res.status(400).json({ error: 'Invalid group' });
    return null;
  }
  return Number(raw);
}

export async function listGroups(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const { groups, members } = await urbackupService.getGroups();
    res.json({
      groups: groups.map(g => ({ ...g, members: members.filter(m => m.group === g.id).map(m => ({ id: m.id, name: m.name, override: m.override })) })),
    });
  } catch (error) {
    logger.error('Failed to list groups:', error);
    res.status(500).json({ error: 'Failed to load groups from UrBackup' });
  }
}

export async function createGroup(req: AuthRequest, res: Response): Promise<void> {
  const checked = validateGroupName(req.body?.name);
  if ('error' in checked) {
    res.status(400).json({ error: checked.error });
    return;
  }
  try {
    const { groups } = await urbackupService.getGroups();
    if (checked.name.toLowerCase() === 'default' || groups.some(g => g.name.toLowerCase() === checked.name.toLowerCase())) {
      res.status(409).json({ error: `A group named "${checked.name}" already exists` });
      return;
    }
    const result = await urbackupService.addGroup(checked.name);
    if ('exists' in result) {
      res.status(409).json({ error: `A group named "${checked.name}" already exists` });
      return;
    }
    logger.info(`Group "${result.name}" (id ${result.id}) created by ${req.user?.username}`);
    res.status(201).json(result);
  } catch (error) {
    logger.error('Failed to create group:', error);
    res.status(500).json({ error: 'Failed to create the group' });
  }
}

export async function deleteGroup(req: AuthRequest, res: Response): Promise<void> {
  const id = groupIdParam(req, res);
  if (id === null) return;
  if (id === 0) {
    res.status(400).json({ error: 'The Default group cannot be deleted' });
    return;
  }
  try {
    const { groups } = await urbackupService.getGroups();
    if (!groups.some(g => g.id === id)) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    await urbackupService.removeGroup(id);
    logger.info(`Group ${id} deleted by ${req.user?.username}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete group:', error);
    res.status(500).json({ error: 'Failed to delete the group' });
  }
}

export async function getGroupSettings(req: AuthRequest, res: Response): Promise<void> {
  const id = groupIdParam(req, res);
  if (id === null) return;
  try {
    const { groups } = await urbackupService.getGroups();
    const group = groups.find(g => g.id === id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const result = await urbackupService.getClientSettings(String(-id));
    const { settings, useValues, inherited } = flattenClientSettings(result?.settings || {});
    res.json({ settings, useValues, inherited, group, groups });
  } catch (error) {
    logger.error('Failed to get group settings:', error);
    res.status(500).json({ error: 'Failed to get group settings' });
  }
}

export async function setGroupSettings(req: AuthRequest, res: Response): Promise<void> {
  const id = groupIdParam(req, res);
  if (id === null) return;
  // client_set_settings (managed mode) is handled per endpoint, not per group.
  const updates: Record<string, any> = { ...(req.body || {}) };
  delete updates.client_set_settings;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Settings are required' });
    return;
  }
  try {
    const { groups } = await urbackupService.getGroups();
    if (!groups.some(g => g.id === id)) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const result = await urbackupService.setClientSettings(String(-id), updates);
    logger.info(`Group ${id} settings changed by ${req.user?.username}: ${Object.keys(updates).join(', ')}`);
    res.json(result);
  } catch (error) {
    logger.error('Failed to set group settings:', error);
    res.status(500).json({ error: 'Failed to save group settings' });
  }
}

export async function setEndpointGroup(req: AuthRequest, res: Response): Promise<void> {
  const { clientId } = req.params;
  const groupId = Number(req.body?.groupId);
  if (!/^[1-9]\d*$/.test(clientId ?? '') || !Number.isInteger(groupId) || groupId < 0) {
    res.status(400).json({ error: 'An endpoint and a group are required' });
    return;
  }
  try {
    const { groups, members } = await urbackupService.getGroups();
    if (!groups.some(g => g.id === groupId)) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!members.some(m => m.id === Number(clientId))) {
      res.status(404).json({ error: 'Endpoint not found' });
      return;
    }
    await urbackupService.setClientGroup(clientId, groupId);
    logger.info(`Endpoint ${clientId} moved to group ${groupId} by ${req.user?.username}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to change endpoint group:', error);
    res.status(500).json({ error: 'Failed to change the group' });
  }
}
