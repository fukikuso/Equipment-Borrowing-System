/**
 * Seeds the CSPC Equipment Borrowing System database with realistic sample
 * data: categories, equipment, users, requests/borrowings in various states,
 * notifications, maintenance logs, and audit trail entries.
 *
 * Run with:  npm run seed
 * (Make sure schema.sql has already been imported.)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cspc_ebs',
    multipleStatements: true
  });

  console.log('Clearing existing data...');
  await conn.query(`
    SET FOREIGN_KEY_CHECKS = 0;
    TRUNCATE TABLE audit_trail;
    TRUNCATE TABLE notifications;
    TRUNCATE TABLE maintenance_logs;
    TRUNCATE TABLE borrowings;
    TRUNCATE TABLE requests;
    TRUNCATE TABLE equipment;
    TRUNCATE TABLE categories;
    TRUNCATE TABLE users;
    SET FOREIGN_KEY_CHECKS = 1;
  `);

  // ---------------------------------------------------------------------
  // CATEGORIES
  // ---------------------------------------------------------------------
  console.log('Seeding categories...');
  const categories = [
    ['Laptops', 'laptop'],
    ['Projectors', 'projector'],
    ['Cameras', 'camera'],
    ['Microphones', 'mic'],
    ['Speakers', 'speaker'],
    ['Networking Equipment', 'router'],
    ['Cables', 'cable'],
    ['Tools', 'wrench'],
    ['Other Equipment', 'box']
  ];
  const categoryIds = {};
  for (const [name, icon] of categories) {
    const [r] = await conn.query('INSERT INTO categories (name, icon) VALUES (?, ?)', [name, icon]);
    categoryIds[name] = r.insertId;
  }

  // ---------------------------------------------------------------------
  // EQUIPMENT
  // ---------------------------------------------------------------------
  console.log('Seeding equipment...');
  const equipmentSeed = [
    // Laptops
    { name: 'Laptop', category: 'Laptops', brand: 'Dell Inspiron 15', qty: 15, avail: 12, cond: 'Good', loc: 'IT Lab Building - Room 203', specs: { Processor: 'Intel Core i5 (11th Gen)', RAM: '8 GB DDR4', Storage: '256 GB SSD', Display: '15.6" FHD (1920 x 1080)', 'Operating System': 'Windows 11', 'Battery Life': 'Up to 8 hours' } },
    { name: 'Laptop', category: 'Laptops', brand: 'Acer Aspire 5', qty: 6, avail: 5, cond: 'Good', loc: 'IT Lab Building - Room 203', specs: { Processor: 'AMD Ryzen 5', RAM: '8 GB DDR4', Storage: '512 GB SSD', Display: '15.6" FHD' } },
    { name: 'Laptop', category: 'Laptops', brand: 'HP ProBook 450', qty: 5, avail: 3, cond: 'Good', loc: 'IT Lab Building - Room 203', specs: { Processor: 'Intel Core i5 (10th Gen)', RAM: '8 GB DDR4', Storage: '256 GB SSD' } },
    { name: 'Laptop', category: 'Laptops', brand: 'Lenovo ThinkPad E14', qty: 4, avail: 4, cond: 'Excellent', loc: 'Instructor Room - 2nd Floor', specs: { Processor: 'Intel Core i7 (11th Gen)', RAM: '16 GB DDR4', Storage: '512 GB SSD' } },
    { name: 'MacBook Air', category: 'Laptops', brand: 'Apple M1', qty: 3, avail: 2, cond: 'Excellent', loc: 'Multimedia Arts Lab', specs: { Processor: 'Apple M1', RAM: '8 GB', Storage: '256 GB SSD' } },
    { name: 'Laptop', category: 'Laptops', brand: 'Asus Vivobook 14', qty: 6, avail: 6, cond: 'Fair', loc: 'IT Lab Building - Room 203', specs: { Processor: 'Intel Core i3 (10th Gen)', RAM: '4 GB DDR4', Storage: '256 GB SSD' } },

    // Projectors
    { name: 'Projector', category: 'Projectors', brand: 'Epson EB-X500', qty: 8, avail: 4, cond: 'Good', loc: 'AV Room - 2nd Floor', specs: { Brightness: '3600 Lumens', Resolution: 'XGA (1024x768)', Connectivity: 'HDMI, VGA, USB' } },
    { name: 'Projector', category: 'Projectors', brand: 'BenQ MX550', qty: 4, avail: 3, cond: 'Good', loc: 'AV Room - 2nd Floor', specs: { Brightness: '3600 Lumens', Resolution: 'XGA (1024x768)' } },
    { name: 'Mini Projector', category: 'Projectors', brand: 'Anker Nebula Capsule', qty: 2, avail: 2, cond: 'Excellent', loc: 'AV Room - 2nd Floor', specs: { Brightness: '200 ANSI Lumens', Resolution: '720p' } },
    { name: 'Projector Screen', category: 'Projectors', brand: 'Portable Tripod 84"', qty: 3, avail: 3, cond: 'Good', loc: 'AV Room - 2nd Floor', specs: { Size: '84 inches', Type: 'Tripod, matte white' } },

    // Cameras
    { name: 'Camera', category: 'Cameras', brand: 'Canon EOS 2000D', qty: 6, avail: 6, cond: 'Good', loc: 'Media Lab - Room 101', specs: { Sensor: '24.1 MP APS-C', Video: '1080p Full HD', Lens: '18-55mm kit lens' } },
    { name: 'Camera', category: 'Cameras', brand: 'Nikon D3500', qty: 3, avail: 3, cond: 'Good', loc: 'Media Lab - Room 101', specs: { Sensor: '24.2 MP APS-C', Video: '1080p Full HD' } },
    { name: 'Mirrorless Camera', category: 'Cameras', brand: 'Sony Alpha a6100', qty: 2, avail: 2, cond: 'Excellent', loc: 'Media Lab - Room 101', specs: { Sensor: '24.2 MP APS-C', Video: '4K UHD' } },
    { name: 'Action Camera', category: 'Cameras', brand: 'GoPro Hero 9', qty: 3, avail: 3, cond: 'Good', loc: 'Media Lab - Room 101', specs: { Video: '5K30', Waterproof: 'Up to 10m' } },
    { name: 'Camera Tripod', category: 'Cameras', brand: 'Manfrotto Compact', qty: 4, avail: 4, cond: 'Good', loc: 'Media Lab - Room 101', specs: { Height: 'Up to 1.5m', Material: 'Aluminum' } },

    // Microphones
    { name: 'Microphone', category: 'Microphones', brand: 'Shure SM58', qty: 5, avail: 5, cond: 'Good', loc: 'Audio Room - 3rd Floor', specs: { Type: 'Dynamic, cardioid', Connector: 'XLR' } },
    { name: 'Wireless Microphone Set', category: 'Microphones', brand: 'Shure BLX288', qty: 3, avail: 2, cond: 'Good', loc: 'Audio Room - 3rd Floor', specs: { Type: 'Dual wireless handheld', Range: 'Up to 90m' } },
    { name: 'Lavalier Microphone', category: 'Microphones', brand: 'Boya BY-M1', qty: 6, avail: 6, cond: 'Good', loc: 'Audio Room - 3rd Floor', specs: { Type: 'Clip-on lavalier', Connector: '3.5mm' } },
    { name: 'Podcast Microphone', category: 'Microphones', brand: 'Blue Yeti', qty: 2, avail: 1, cond: 'Excellent', loc: 'Media Lab - Room 101', specs: { Type: 'USB condenser', Pattern: 'Multi-pattern' } },

    // Speakers
    { name: 'Speaker', category: 'Speakers', brand: 'JBL EON 610', qty: 4, avail: 4, cond: 'Good', loc: 'Storage Room', specs: { Power: '1000W peak', Type: 'Powered PA speaker' } },
    { name: 'Portable PA System', category: 'Speakers', brand: 'Bose S1 Pro', qty: 2, avail: 2, cond: 'Good', loc: 'Storage Room', specs: { Power: '120W', Battery: 'Up to 11 hours' } },
    { name: 'Bluetooth Speaker', category: 'Speakers', brand: 'JBL Flip 5', qty: 5, avail: 4, cond: 'Good', loc: 'Storage Room', specs: { Power: '20W', Battery: 'Up to 12 hours' } },
    { name: 'Studio Monitor Speaker', category: 'Speakers', brand: 'Yamaha HS5 (Pair)', qty: 2, avail: 2, cond: 'Excellent', loc: 'Media Lab - Room 101', specs: { Power: '70W', Type: 'Near-field studio monitor' } },

    // Networking Equipment
    { name: 'Networking Device', category: 'Networking Equipment', brand: 'TP-Link Archer AX55 Router', qty: 5, avail: 3, cond: 'Good', loc: 'IT Office - 1st Floor', specs: { Standard: 'Wi-Fi 6 (802.11ax)', Ports: '4x Gigabit LAN' } },
    { name: 'Network Switch', category: 'Networking Equipment', brand: 'TP-Link 24-Port Gigabit', qty: 3, avail: 2, cond: 'Good', loc: 'IT Office - 1st Floor', specs: { Ports: '24x Gigabit', Type: 'Unmanaged' } },
    { name: 'Wi-Fi Extender', category: 'Networking Equipment', brand: 'TP-Link RE305', qty: 4, avail: 4, cond: 'Good', loc: 'IT Office - 1st Floor', specs: { Standard: 'AC1200 Dual Band' } },
    { name: 'Portable Hotspot', category: 'Networking Equipment', brand: 'Huawei E5576', qty: 3, avail: 3, cond: 'Good', loc: 'IT Office - 1st Floor', specs: { Standard: '4G LTE', Battery: 'Up to 6 hours' } },
    { name: 'Ethernet Cable Tester', category: 'Networking Equipment', brand: 'NF-388 Cable Tester', qty: 2, avail: 2, cond: 'Good', loc: 'IT Office - 1st Floor', specs: { Function: 'RJ45/RJ11 continuity test' } },

    // Cables
    { name: 'HDMI Cable', category: 'Cables', brand: '3m High-Speed HDMI', qty: 10, avail: 8, cond: 'Good', loc: 'IT Lab Building', specs: { Length: '3 meters', Standard: 'HDMI 2.0' } },
    { name: 'Extension Cord', category: 'Cables', brand: '10m Heavy Duty', qty: 12, avail: 10, cond: 'Good', loc: 'Storage Room', specs: { Length: '10 meters', Outlets: '4-gang' } },
    { name: 'VGA Cable', category: 'Cables', brand: '5m VGA to VGA', qty: 8, avail: 8, cond: 'Good', loc: 'AV Room - 2nd Floor', specs: { Length: '5 meters' } },
    { name: 'USB-C Cable', category: 'Cables', brand: '2m USB-C to USB-C', qty: 10, avail: 9, cond: 'Good', loc: 'IT Lab Building', specs: { Length: '2 meters', Standard: 'USB 3.1' } },
    { name: 'XLR Cable', category: 'Cables', brand: '5m XLR Microphone Cable', qty: 8, avail: 8, cond: 'Good', loc: 'Audio Room - 3rd Floor', specs: { Length: '5 meters' } },
    { name: 'Ethernet Cable', category: 'Cables', brand: '15m Cat6 Cable', qty: 10, avail: 10, cond: 'Good', loc: 'IT Office - 1st Floor', specs: { Length: '15 meters', Standard: 'Cat6' } },

    // Tools
    { name: 'Digital Multimeter', category: 'Tools', brand: 'Fluke 115', qty: 3, avail: 3, cond: 'Good', loc: 'Engineering Workshop', specs: { Function: 'Voltage, current, resistance' } },
    { name: 'Soldering Kit', category: 'Tools', brand: 'Weller WLC100', qty: 4, avail: 4, cond: 'Good', loc: 'Engineering Workshop', specs: { Power: '40W', Includes: 'Iron, stand, solder' } },
    { name: 'Toolbox Set', category: 'Tools', brand: 'Stanley 65-Piece', qty: 3, avail: 3, cond: 'Good', loc: 'Engineering Workshop', specs: { Pieces: '65-piece mixed set' } },

    // Other Equipment
    { name: 'Whiteboard (Mobile)', category: 'Other Equipment', brand: 'Mobile Magnetic Whiteboard', qty: 4, avail: 4, cond: 'Good', loc: 'Storage Room', specs: { Size: '4ft x 3ft' } },
    { name: 'Visualizer / Document Camera', category: 'Other Equipment', brand: 'IPEVO V4K', qty: 2, avail: 2, cond: 'Good', loc: 'AV Room - 2nd Floor', specs: { Resolution: '4K USB' } },
    { name: 'Power Bank', category: 'Other Equipment', brand: '20000mAh Fast Charge', qty: 6, avail: 5, cond: 'Good', loc: 'IT Office - 1st Floor', specs: { Capacity: '20000mAh' } },
    { name: 'Ring Light', category: 'Other Equipment', brand: '18" LED Ring Light w/ Stand', qty: 3, avail: 3, cond: 'Good', loc: 'Media Lab - Room 101', specs: { Size: '18 inches', Power: 'USB powered' } }
  ];

  const equipmentIds = [];
  let eqCounter = 1;
  for (const item of equipmentSeed) {
    const code = `EQ-${String(eqCounter).padStart(3, '0')}`;
    eqCounter += 1;
    const [r] = await conn.query(
      `INSERT INTO equipment (equipment_code, name, category_id, brand_model, description, specifications, condition_status,
        quantity_total, quantity_available, location, maintenance_status, borrowing_rules, status, last_maintenance, next_maintenance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Operational', ?, 'active', ?, ?)`,
      [
        code, item.name, categoryIds[item.category], item.brand,
        `${item.brand} — well-maintained ${item.name.toLowerCase()} available for academic and campus activities.`,
        JSON.stringify(item.specs), item.cond, item.qty, item.avail, item.loc,
        'Must be returned in the same condition as issued. Report any damage immediately to the IT Office.',
        dayjs().subtract(45, 'day').format('YYYY-MM-DD'),
        dayjs().add(45, 'day').format('YYYY-MM-DD')
      ]
    );
    equipmentIds.push({ id: r.insertId, code, name: item.name, category: item.category, qty: item.qty });

    // Generate a real QR code file for each item, same as the admin flow does.
    try {
      const dir = path.join(__dirname, '..', 'public', 'uploads', 'qr');
      fs.mkdirSync(dir, { recursive: true });
      const filepath = path.join(dir, `${code}.png`);
      await QRCode.toFile(filepath, JSON.stringify({ type: 'equipment', code }), { width: 400, margin: 1, color: { dark: '#174A8B', light: '#FFFFFF' } });
      await conn.query('UPDATE equipment SET qr_code_path = ? WHERE id = ?', [`/uploads/qr/${code}.png`, r.insertId]);
    } catch (e) { /* non-fatal for seeding */ }
  }

  // Mark two projectors under maintenance to mirror the mockup's "Under Maintenance (2)"
  const [[projectorA]] = await conn.query(`SELECT id FROM equipment WHERE equipment_code = 'EQ-007'`);
  const [[projectorB]] = await conn.query(`SELECT id FROM equipment WHERE equipment_code = 'EQ-008'`);
  for (const eq of [projectorA, projectorB]) {
    await conn.query('UPDATE equipment SET maintenance_status = "Under Maintenance" WHERE id = ?', [eq.id]);
    await conn.query(
      `INSERT INTO maintenance_logs (equipment_id, problem, date_reported, assigned_technician, status)
       VALUES (?, 'Projector lamp needs replacement — dim output reported by an instructor.', ?, 'Engr. Ramon Dizon', 'In Progress')`,
      [eq.id, dayjs().subtract(2, 'day').format('YYYY-MM-DD')]
    );
  }

  // ---------------------------------------------------------------------
  // USERS
  // ---------------------------------------------------------------------
  console.log('Seeding users...');
  const pass = async (p) => bcrypt.hash(p, 10);

  const users = [
    { id_number: '253801', name: 'Jhon Lloyd B. Barela', role: 'student', dept: 'College of Information Technology', program: 'BSIT 3D', email: 'jhonlloyd.barela@cspc.edu.ph', password: await pass('password123') },
    { id_number: '245102', name: 'Carlos M. Reyes', role: 'student', dept: 'College of Information Technology', program: 'BSIT 2C', email: 'carlos.reyes@cspc.edu.ph', password: await pass('password123') },
    { id_number: '249987', name: 'Ana P. Cruz', role: 'student', dept: 'College of Information Technology', program: 'BSIT 3D', email: 'ana.cruz@cspc.edu.ph', password: await pass('password123') },
    { id_number: '251134', name: 'Maria Santos', role: 'instructor', dept: 'College of Information Technology', program: null, email: 'maria.santos@cspc.edu.ph', password: await pass('password123') },
    { id_number: '252210', name: 'Miguel A. Torres', role: 'student', dept: 'College of Arts and Sciences', program: 'BSMA 2A', email: 'miguel.torres@cspc.edu.ph', password: await pass('password123') },
    { id_number: 'STF-001', name: 'Grace L. Fernandez', role: 'staff', dept: 'IT Office', program: null, email: 'grace.fernandez@cspc.edu.ph', password: await pass('staff123') },
    { id_number: 'ADM-001', name: 'Engr. Ramon Dizon', role: 'admin', dept: 'IT Office', program: null, email: 'ramon.dizon@cspc.edu.ph', password: await pass('admin123') }
  ];

  const userIds = {};
  for (const u of users) {
    const [r] = await conn.query(
      `INSERT INTO users (id_number, password_hash, full_name, email, role, department, program, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [u.id_number, u.password, u.name, u.email, u.role, u.dept, u.program]
    );
    userIds[u.id_number] = r.insertId;
  }

  console.log('Users, categories, and equipment seeded.');

  // ---------------------------------------------------------------------
  // REQUESTS & BORROWINGS (a realistic spread of statuses)
  // ---------------------------------------------------------------------
  console.log('Seeding requests and borrowings...');

  const findEq = (code) => equipmentIds.find((e) => e.code === code);
  let reqCounter = 1;
  const nextReqCode = () => `REQ-${String(reqCounter++).padStart(5, '0')}`;

  async function insertRequest({ userKey, eq, status, purpose, activity, dept, dateNeeded, returnDate, quantity = 1, rejectionReason = null, reviewedByKey = 'ADM-001' }) {
    const code = nextReqCode();
    const createdAt = dayjs(dateNeeded).subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss');
    const [r] = await conn.query(
      `INSERT INTO requests (request_code, user_id, equipment_id, quantity, purpose, activity_event, department_program,
        date_needed, expected_return_date, status, rejection_reason, reviewed_by, reviewed_at, ready_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code, userIds[userKey], eq.id, quantity, purpose, activity || null, dept || null,
        dateNeeded, returnDate, status, rejectionReason,
        ['submitted'].includes(status) ? null : userIds[reviewedByKey],
        ['submitted'].includes(status) ? null : createdAt,
        ['ready_for_pickup', 'borrowed', 'returned', 'completed'].includes(status) ? createdAt : null,
        createdAt
      ]
    );
    return { id: r.insertId, code };
  }

  async function insertBorrowing({ requestId, userKey, eq, borrowDate, dueDate, returnDate = null, conditionAfter = null, remarks = null, status = 'active' }) {
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    await conn.query(
      `INSERT INTO borrowings (request_id, user_id, equipment_id, qr_token, borrow_date, due_date, return_date,
        condition_before, condition_after, remarks, released_by, received_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Good', ?, ?, ?, ?, ?)`,
      [requestId, userIds[userKey], eq.id, token, borrowDate, dueDate, returnDate, conditionAfter, remarks,
        userIds['ADM-001'], returnDate ? userIds['STF-001'] : null, status]
    );
  }

  async function notifyUser(userKey, type, title, message, requestId = null) {
    await conn.query(
      'INSERT INTO notifications (user_id, type, title, message, related_request_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userIds[userKey], type, title, message, requestId, Math.random() > 0.5 ? 1 : 0, dayjs().subtract(Math.floor(Math.random() * 48), 'hour').format('YYYY-MM-DD HH:mm:ss')]
    );
  }

  // --- Jhon Lloyd: matches the mockup story (active laptop + camera, pending projector, overdue microphone)
  const laptop = findEq('EQ-001');
  const camera = findEq('EQ-011');
  const projector = findEq('EQ-009');
  const mic = findEq('EQ-016');
  const speaker = findEq('EQ-020');

  const r1 = await insertRequest({ userKey: '253801', eq: laptop, status: 'borrowed', purpose: 'Research / Project', activity: 'Thesis Data Gathering', dept: 'Information Technology (BSIT)', dateNeeded: dayjs().subtract(2, 'day').format('YYYY-MM-DD'), returnDate: dayjs().add(1, 'day').format('YYYY-MM-DD') });
  await insertBorrowing({ requestId: r1.id, userKey: '253801', eq: laptop, borrowDate: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), dueDate: dayjs().add(1, 'day').hour(17).minute(0).format('YYYY-MM-DD HH:mm:ss'), status: 'active' });
  await notifyUser('253801', 'approved', 'Request approved', `Your request for ${laptop.name} has been approved and is ready for pickup.`, r1.id);
  await notifyUser('253801', 'info', 'Equipment released', `${laptop.name} has been released to you. Please return it by the due date.`, r1.id);

  const r2 = await insertRequest({ userKey: '253801', eq: camera, status: 'borrowed', purpose: 'Documentation', activity: 'Campus Event Coverage', dept: 'Multimedia Arts (BSMA)', dateNeeded: dayjs().subtract(1, 'day').format('YYYY-MM-DD'), returnDate: dayjs().add(2, 'day').format('YYYY-MM-DD') });
  await insertBorrowing({ requestId: r2.id, userKey: '253801', eq: camera, borrowDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD HH:mm:ss'), dueDate: dayjs().add(2, 'day').hour(17).minute(0).format('YYYY-MM-DD HH:mm:ss'), status: 'active' });

  const r3 = await insertRequest({ userKey: '253801', eq: projector, status: 'submitted', purpose: 'Presentation', activity: 'Class Presentation', dept: 'Information Technology (BSIT)', dateNeeded: dayjs().add(1, 'day').format('YYYY-MM-DD'), returnDate: dayjs().add(1, 'day').format('YYYY-MM-DD') });
  await notifyUser('253801', 'info', 'Request submitted', `Your request for ${projector.name} has been submitted and is awaiting review.`, r3.id);

  const r4 = await insertRequest({ userKey: '253801', eq: mic, status: 'borrowed', purpose: 'Event / Seminar', activity: 'Student Org Seminar', dept: 'Student Activities', dateNeeded: dayjs().subtract(6, 'day').format('YYYY-MM-DD'), returnDate: dayjs().subtract(3, 'day').format('YYYY-MM-DD') });
  await insertBorrowing({ requestId: r4.id, userKey: '253801', eq: mic, borrowDate: dayjs().subtract(6, 'day').format('YYYY-MM-DD HH:mm:ss'), dueDate: dayjs().subtract(3, 'day').hour(17).minute(0).format('YYYY-MM-DD HH:mm:ss'), status: 'overdue' });
  await notifyUser('253801', 'overdue', 'Equipment overdue', `${mic.name} is now overdue. Please return it as soon as possible.`, r4.id);

  const r5 = await insertRequest({ userKey: '253801', eq: speaker, status: 'rejected', purpose: 'Off-campus event', activity: 'Barangay Outreach', dept: 'Student Activities', dateNeeded: dayjs().subtract(10, 'day').format('YYYY-MM-DD'), returnDate: dayjs().subtract(9, 'day').format('YYYY-MM-DD'), rejectionReason: 'Equipment may not be taken off-campus without a signed department endorsement.' });
  await notifyUser('253801', 'rejected', 'Request rejected', `Your request for ${speaker.name} was rejected: Equipment may not be taken off-campus without a signed department endorsement.`, r5.id);

  // A completed (returned) transaction for history variety
  const oldLaptop = findEq('EQ-002');
  const r6 = await insertRequest({ userKey: '253801', eq: oldLaptop, status: 'completed', purpose: 'Programming Requirement', activity: 'Software Engineering Lab', dept: 'Information Technology (BSIT)', dateNeeded: dayjs().subtract(20, 'day').format('YYYY-MM-DD'), returnDate: dayjs().subtract(17, 'day').format('YYYY-MM-DD') });
  await insertBorrowing({ requestId: r6.id, userKey: '253801', eq: oldLaptop, borrowDate: dayjs().subtract(20, 'day').format('YYYY-MM-DD HH:mm:ss'), dueDate: dayjs().subtract(17, 'day').hour(17).format('YYYY-MM-DD HH:mm:ss'), returnDate: dayjs().subtract(17, 'day').hour(16).format('YYYY-MM-DD HH:mm:ss'), conditionAfter: 'Good', status: 'returned' });
  await notifyUser('253801', 'returned', 'Return recorded', `Your return of ${oldLaptop.name} has been recorded as "Good". Thank you!`, r6.id);
  await notifyUser('253801', 'maintenance', 'Maintenance announcement', 'Some projectors are currently under maintenance and temporarily unavailable.');

  // --- Other users: history variety for equipment pages + admin dashboard stats
  const otherEquip = ['EQ-001', 'EQ-011', 'EQ-016', 'EQ-024', 'EQ-003'].map(findEq);
  const otherUsers = ['245102', '249987', '251134', '252210'];
  let dayOffset = 4;
  for (const key of otherUsers) {
    for (const eq of otherEquip.slice(0, 2)) {
      const bDate = dayjs().subtract(dayOffset, 'day');
      const dDate = bDate.add(2, 'day');
      const req = await insertRequest({
        userKey: key, eq, status: 'completed', purpose: 'Class Requirement', dept: 'Academic Use',
        dateNeeded: bDate.format('YYYY-MM-DD'), returnDate: dDate.format('YYYY-MM-DD')
      });
      await insertBorrowing({
        requestId: req.id, userKey: key, eq,
        borrowDate: bDate.format('YYYY-MM-DD HH:mm:ss'), dueDate: dDate.hour(17).format('YYYY-MM-DD HH:mm:ss'),
        returnDate: dDate.hour(15).format('YYYY-MM-DD HH:mm:ss'), conditionAfter: 'Good', status: 'returned'
      });
      dayOffset += 3;
    }
  }

  // A couple of pending requests from other users for the admin Requests queue
  await insertRequest({ userKey: '245102', eq: findEq('EQ-005'), status: 'submitted', purpose: 'Video Editing Project', dept: 'BSIT 2C', dateNeeded: dayjs().add(2, 'day').format('YYYY-MM-DD'), returnDate: dayjs().add(4, 'day').format('YYYY-MM-DD') });
  await insertRequest({ userKey: '249987', eq: findEq('EQ-018'), status: 'submitted', purpose: 'Podcast Recording', dept: 'BSIT 3D', dateNeeded: dayjs().add(1, 'day').format('YYYY-MM-DD'), returnDate: dayjs().add(2, 'day').format('YYYY-MM-DD') });
  await insertRequest({ userKey: '252210', eq: findEq('EQ-021'), status: 'under_review', purpose: 'Campus Broadcast', dept: 'BSMA 2A', dateNeeded: dayjs().add(1, 'day').format('YYYY-MM-DD'), returnDate: dayjs().add(3, 'day').format('YYYY-MM-DD') });

  // ---------------------------------------------------------------------
  // AUDIT TRAIL (a few seed entries so the page isn't empty)
  // ---------------------------------------------------------------------
  console.log('Seeding audit trail...');
  const auditSeed = [
    ['ADM-001', `Approved request ${r1.code}`, 'Requests', `Equipment: ${laptop.name}`],
    ['ADM-001', `Approved request ${r2.code}`, 'Requests', `Equipment: ${camera.name}`],
    ['ADM-001', `Rejected request ${r5.code}`, 'Requests', 'Off-campus restriction'],
    ['STF-001', `Released ${laptop.name} for request ${r1.code}`, 'Borrowings', `Borrower ID ${userIds['253801']}`],
    ['STF-001', `Processed return of ${oldLaptop.name} for request ${r6.code}`, 'Returns', 'Condition: Good'],
    ['ADM-001', `Logged maintenance issue for equipment #${projectorA.id}`, 'Maintenance', 'Projector lamp needs replacement'],
    ['ADM-001', 'Engr. Ramon Dizon logged in', 'Authentication', 'ID ADM-001']
  ];
  for (const [userKey, action, module, details] of auditSeed) {
    await conn.query(
      'INSERT INTO audit_trail (user_id, action, module, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userIds[userKey], action, module, details, '127.0.0.1', dayjs().subtract(Math.floor(Math.random() * 72), 'hour').format('YYYY-MM-DD HH:mm:ss')]
    );
  }

  console.log('Seed complete!');
  console.log('---------------------------------------------');
  console.log('Demo logins:');
  console.log('  Student : 253801 / password123');
  console.log('  Staff   : STF-001 / staff123');
  console.log('  Admin   : ADM-001 / admin123');
  console.log('---------------------------------------------');

  await conn.end();
}

module.exports = main;

if (require.main === module) {
  main().then(() => {
    console.log('Done.');
    process.exit(0);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
