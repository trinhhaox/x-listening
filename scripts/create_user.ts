import { Store } from "../src/db.js";
import { hashPassword, normalizePhone, type Role } from "../src/users.js";

const rawPhone = process.argv[2] || "0977496222";
const password = process.argv[3] || "Thatchat@123ok";
const name = process.argv[4] || "Admin";
const role = (process.argv[5] || "admin") as Role;
const dbPath = process.argv[6] || "./data/listening.db";

const phone = normalizePhone(rawPhone);
if (!phone) {
  console.error("Invalid phone number:", rawPhone);
  process.exit(1);
}

const store = Store.open(dbPath);
const existing = store.getUserByPhone(phone);

if (existing) {
  console.log(`User ${phone} already exists (${existing.id}). Updating password and role...`);
  store.updateUser(existing.id, { name, role, active: true });
  store.setUserPassword(existing.id, hashPassword(password));
  console.log(`User ${phone} updated successfully as ${role}.`);
} else {
  const created = store.insertUser({
    phone,
    name,
    role,
    passwordHash: hashPassword(password),
    at: new Date().toISOString(),
  });
  console.log(`User created successfully:`, {
    id: created.id,
    phone: created.phone,
    name: created.name,
    role: created.role,
  });
}

