import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Get all customers
router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        c.*,
        COUNT(DISTINCT cc.id) as client_count,
        COUNT(DISTINCT cu.user_id) as user_count
      FROM customers c
      LEFT JOIN customer_clients cc ON c.id = cc.customer_id
      LEFT JOIN customer_users cu ON c.id = cu.customer_id
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json(rows);
  } catch (error) {
    logger.error('Failed to get customers:', error);
    res.status(500).json({ error: 'Failed to get customers' });
  }
});

// Get single customer
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM customers WHERE id = ? AND is_active = 1',
      [req.params.id]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    logger.error('Failed to get customer:', error);
    res.status(500).json({ error: 'Failed to get customer' });
  }
});

// Create customer
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, email, phone, company, address, notes } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Customer name is required' });
      return;
    }

    const [result] = await pool.query(
      'INSERT INTO customers (name, email, phone, company, address, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email || null, phone || null, company || null, address || null, notes || null]
    );

    const insertResult = result as any;
    res.status(201).json({
      id: insertResult.insertId,
      name,
      email,
      phone,
      company,
      address,
      notes,
      is_active: true
    });
  } catch (error) {
    logger.error('Failed to create customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Update customer
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, email, phone, company, address, notes, is_active } = req.body;

    const [result] = await pool.query(
      `UPDATE customers
       SET name = ?, email = ?, phone = ?, company = ?, address = ?, notes = ?, is_active = ?
       WHERE id = ?`,
      [name, email || null, phone || null, company || null, address || null, notes || null, is_active !== undefined ? is_active : true, req.params.id]
    );

    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json({ message: 'Customer updated successfully' });
  } catch (error) {
    logger.error('Failed to update customer:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Delete customer (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE customers SET is_active = 0 WHERE id = ?',
      [req.params.id]
    );

    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete customer:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// Get customers clients
router.get('/:id/clients', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cc.*, s.name as server_name, s.host as server_host
       FROM customer_clients cc
       LEFT JOIN urbackup_servers s ON cc.server_id = s.id
       WHERE cc.customer_id = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    logger.error('Failed to get customer clients:', error);
    res.status(500).json({ error: 'Failed to get customer clients' });
  }
});

// Add client to customer
router.post('/:id/clients', authenticate, async (req, res) => {
  try {
    const { server_id, client_name, client_id, notes } = req.body;

    if (!server_id || !client_name) {
      res.status(400).json({ error: 'server_id and client_name are required' });
      return;
    }

    const [result] = await pool.query(
      `INSERT INTO customer_clients (customer_id, server_id, client_name, client_id, notes)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notes = VALUES(notes), client_id = VALUES(client_id)`,
      [req.params.id, server_id, client_name, client_id || null, notes || null]
    );

    const insertResult = result as any;
    res.status(201).json({
      id: insertResult.insertId,
      customer_id: req.params.id,
      server_id,
      client_name,
      client_id,
      notes
    });
  } catch (error) {
    logger.error('Failed to add client to customer:', error);
    res.status(500).json({ error: 'Failed to add client to customer' });
  }
});

// Remove client from customer
router.delete('/:customerId/clients/:clientId', authenticate, async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM customer_clients WHERE customer_id = ? AND id = ?',
      [req.params.customerId, req.params.clientId]
    );

    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      res.status(404).json({ error: 'Client assignment not found' });
      return;
    }

    res.json({ message: 'Client removed from customer successfully' });
  } catch (error) {
    logger.error('Failed to remove client from customer:', error);
    res.status(500).json({ error: 'Failed to remove client from customer' });
  }
});

// Get client's customer assignment
router.get('/by-client/:serverId/:clientName', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cc.*, c.name as customer_name, c.company as customer_company
       FROM customer_clients cc
       JOIN customers c ON cc.customer_id = c.id
       WHERE cc.server_id = ? AND cc.client_name = ? AND c.is_active = 1`,
      [req.params.serverId, req.params.clientName]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      res.json(null);
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    logger.error('Failed to get client customer:', error);
    res.status(500).json({ error: 'Failed to get client customer' });
  }
});

export default router;
