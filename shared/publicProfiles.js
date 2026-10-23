// Public identifiers locate an archive; they never authenticate an account.
export const DOCTOR_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DOCTOR_ID_LENGTH = 4;
const doctorIdPattern = new RegExp(`^[${DOCTOR_ID_ALPHABET}]{${DOCTOR_ID_LENGTH}}$`);
export const PUBLIC_PROFILE_FIELDS = Object.freeze(['trophies', 'achievements', 'statistics', 'history', 'replays']);
export const PRIVATE_PROFILE = Object.freeze(Object.fromEntries(PUBLIC_PROFILE_FIELDS.map(key => [key, false])));
export function normalizeDoctorId(value) {
  if (typeof value !== 'string' || value.length > 32) return null;
  const id = value.trim().toUpperCase();
  return doctorIdPattern.test(id) ? id : null;
}
export function formatDoctorId(value) {
  return normalizeDoctorId(value) || '';
}
export function validVisibility(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => PUBLIC_PROFILE_FIELDS.includes(key) && typeof value[key] === 'boolean');
}
