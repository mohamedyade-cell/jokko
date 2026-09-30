// Entretiens : heures saisies et affichées dans le fuseau de la plateforme
// (Africa/Dakar par défaut, soit GMT toute l'année), stockées en UTC.

const MODES = { presentiel: 'Sur place', visio: 'Visioconférence', telephone: 'Téléphone' };
const STATUSES = { proposed: 'En attente de réponse', confirmed: 'Confirmé', declined: 'Décliné', cancelled: 'Annulé' };

function timeZone() {
  return process.env.JOKKO_TZ || 'Africa/Dakar';
}

// Décalage (ms) du fuseau par rapport à UTC à un instant donné.
function offsetMs(utcMs, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs;
}

// « 2026-10-05T10:30 » (champ datetime-local, heure locale) → Date UTC, ou null si invalide.
function parseLocal(value, tz = timeZone()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Refuse les dates impossibles (31 février, 25 h…) que Date.UTC reporterait silencieusement.
  const check = new Date(guess);
  if (check.getUTCMonth() !== +m[2] - 1 || check.getUTCDate() !== +m[3] || check.getUTCHours() !== +m[4]) return null;
  const date = new Date(guess - offsetMs(guess, tz));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toSql(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromSql(value) {
  return new Date(String(value).replace(' ', 'T') + 'Z');
}

function formatWhen(value, tz = timeZone()) {
  return fromSql(value).toLocaleString('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function isPast(interview) {
  return fromSql(interview.starts_at).getTime() + interview.duration_min * 60000 < Date.now();
}

function icsEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Fichier calendrier (.ics) : s'ajoute à Google Agenda, Outlook ou au calendrier du téléphone.
function toIcs(interview, { title, description, baseUrl }) {
  const start = fromSql(interview.starts_at);
  const end = new Date(start.getTime() + interview.duration_min * 60000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jokko//Entretiens//FR',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:interview-${interview.id}@${new URL(baseUrl).host}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(interview.location || MODES[interview.mode])}`,
    `STATUS:${interview.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

module.exports = { MODES, STATUSES, timeZone, parseLocal, toSql, fromSql, formatWhen, isPast, toIcs };
