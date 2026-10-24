import bcrypt from 'bcryptjs';
import { connectDb } from '../db.js';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { seedDefaults, seedMockRecords } from './data.js';

// Demo accounts. Passwords are for local development only.
const USERS = [
  { name: 'Administrator', email: 'admin@demo.local', password: 'Admin@12345', role: 'admin', institution: 'AICTE' },
  { name: 'Officer A. Rao', email: 'officer@demo.local', password: 'Officer@12345', role: 'officer', institution: 'AICTE', designation: 'Scrutiny officer' },
  { name: 'Greenfield Registrar', email: 'college@demo.local', password: 'College@12345', role: 'college', institution: 'Greenfield Institute of Technology' },
];

await connectDb();
await seedDefaults();
await seedMockRecords();
for (const u of USERS) {
  const { password, ...rest } = u;
  await User.updateOne({ email: u.email }, { $setOnInsert: { ...rest, passwordHash: await bcrypt.hash(password, 12), status: 'active' } }, { upsert: true });
}
console.log('Seeded checklist, mock authority records and demo users:');
USERS.forEach((u) => console.log(`  ${u.role.padEnd(8)} ${u.email}  ${u.password}`));
await mongoose.disconnect();
