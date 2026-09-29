const { STAGES } = require('./db');

const stageLabels = { ...Object.fromEntries(STAGES.map((s) => [s.key, s.label])), recue: 'Reçue', ecartee: 'Écartée' };
const sourceLabels = { jokko: 'Jokko', sourcing: 'CVthèque', linkedin: 'LinkedIn', indeed: 'Indeed' };
// Vu par le candidat : on ne détaille pas les refus.
const candidateStageLabels = { ...stageLabels, recue: 'Envoyée', ecartee: 'Non retenue', refuse: 'Non retenue' };
const levelLabels = { debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé' };
const LANGUAGES = { fr: 'Français', wo: 'Wolof', en: 'Anglais', pul: 'Pulaar', ser: 'Sérère', other: 'Autre' };

function stageLabel(key) {
  return stageLabels[key] || key;
}

function candidateStageLabel(key) {
  return candidateStageLabels[key] || key;
}

function levelLabel(key) {
  return levelLabels[key] || key || '';
}

function languageLabel(key) {
  return LANGUAGES[key] || '';
}

// « Moussa D. » : affiché tant que le CV n'est pas débloqué.
function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : parseDate(value);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function sourceLabel(key) {
  return sourceLabels[key] || key;
}

// Les dates SQLite sont en UTC au format "YYYY-MM-DD HH:MM:SS".
function parseDate(value) {
  return new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
}

function timeAgo(value) {
  const seconds = Math.max(0, Math.round((Date.now() - parseDate(value).getTime()) / 1000));
  if (seconds < 60) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  return parseDate(value).toLocaleDateString('fr-FR');
}

function formatSalary(min, max) {
  const fmt = (n) => Number(n).toLocaleString('fr-FR');
  if (min && max) return `${fmt(min)} – ${fmt(max)} FCFA / mois`;
  if (min) return `À partir de ${fmt(min)} FCFA / mois`;
  if (max) return `Jusqu'à ${fmt(max)} FCFA / mois`;
  return '';
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

function splitSkills(skills) {
  return String(skills || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  LANGUAGES,
  stageLabel,
  candidateStageLabel,
  sourceLabel,
  levelLabel,
  languageLabel,
  shortName,
  formatDate,
  timeAgo,
  formatSalary,
  initials,
  splitSkills,
  parseDate,
};
