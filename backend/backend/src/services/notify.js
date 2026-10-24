import { Notification } from '../models/Misc.js';
import { User } from '../models/User.js';
import { sendMail } from './mailer.js';

export async function notifyUser(userId, { title, body, applicationId }) {
  await Notification.create({ user: userId, application: applicationId, title, body });
  const user = await User.findById(userId).lean();
  await sendMail({ to: user?.email, subject: title, text: body });
}

export async function notifyOfficers({ title, body, applicationId }) {
  const officers = await User.find({ role: 'officer', status: 'active' }).lean();
  await Notification.insertMany(officers.map((o) => ({ user: o._id, application: applicationId, title, body })));
  await sendMail({ to: officers.map((o) => o.email), subject: title, text: body });
}
