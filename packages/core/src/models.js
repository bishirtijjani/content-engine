// Typed views of the content database — thin mappers over rows.
// Engines consume these instead of raw rows. JSON columns are decoded.
import { parseJson } from './db.js';

export function contentItem(row) {
  if (!row) return null;
  return { ...row, tags: parseJson(row.tags) };
}

export function asset(row) {
  return row ? { ...row } : null;
}

export function post(row) {
  if (!row) return null;
  return { ...row, hashtags: parseJson(row.hashtags) };
}

export function engagementItem(row) {
  return row ? { ...row } : null;
}

export function conversation(row) {
  return row ? { ...row } : null;
}

export function metricSet(row) {
  return row ? { ...row } : null;
}

export function insight(row) {
  return row ? { ...row } : null;
}

export function playbookRule(row) {
  if (!row) return null;
  return { ...row, applicability: parseJson(row.applicability) };
}

export function recordingSession(row) {
  return row ? { ...row } : null;
}

export function recording(row) {
  return row ? { ...row } : null;
}

export function contentLink(row) {
  return row ? { ...row } : null;
}

export function calendarEntry(row) {
  return row ? { ...row } : null;
}

export function gate(row) {
  return row ? { ...row } : null;
}

export function engineLog(row) {
  return row ? { ...row } : null;
}