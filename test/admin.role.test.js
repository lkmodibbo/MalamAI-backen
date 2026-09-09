const request = require('supertest');
const express = require('express');

// Mock the database pool before importing the app
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const app = require('../src/app');
const jwt = require('jsonwebtoken');

describe('Admin role endpoint', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.JWT_SECRET = 'testsecret';
  });

  test('prevents demoting the last admin', async () => {
    // Simulate valid admin token
    jest.spyOn(jwt, 'verify').mockReturnValue({ id: 1 });

    // Sequence of DB calls during middleware + handler:
    // 1) adminOnly -> SELECT id,email,is_admin FROM users WHERE id = $1
    pool.query.mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 1, email: 'a@x', is_admin: true }] }));
    // 2) in handler when demoting -> SELECT COUNT(*) AS total FROM users WHERE is_admin = TRUE
    pool.query.mockImplementationOnce(() => Promise.resolve({ rows: [{ total: '1' }] }));
    // 3) SELECT is_admin FROM users WHERE id = $1 (target)
    pool.query.mockImplementationOnce(() => Promise.resolve({ rows: [{ is_admin: true }] }));

    const res = await request(app)
      .post('/api/admin/users/2/role')
      .set('Authorization', 'Bearer token')
      .send({ is_admin: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot demote the last admin/);
  });

  test('promotes a user successfully', async () => {
    jest.spyOn(jwt, 'verify').mockReturnValue({ id: 1 });

    // adminOnly check
    pool.query.mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 1, email: 'a@x', is_admin: true }] }));
    // handler: since promoting, no admin count check; perform UPDATE -> return row
    pool.query.mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 2, name: 'Bob', email: 'bob@x', is_admin: true }] }));

    const res = await request(app)
      .post('/api/admin/users/2/role')
      .set('Authorization', 'Bearer token')
      .send({ is_admin: true });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.is_admin).toBeTruthy();
  });
});
