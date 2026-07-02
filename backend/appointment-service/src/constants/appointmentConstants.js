'use strict';

/**
 * @hms/appointment-service — shared constant definitions.
 *
 * Immutable, dependency-free constants used across the appointment-service layers
 * (queues, repositories, validators, services, workers, schedulers). Keeping these in
 * one place prevents string-literal drift between layers.
 *
 * IMPORTANT: This module MUST stay in lock-step with the database contract owned by the
 * root `database/` folder (this service NEVER defines migrations — it only mirrors):
 *   - `appointment_status` enum  → database/migrations/0001_init_extensions_and_enums.sql
 *                                  (and database/schema/01_enums.sql)
 *   - doctor double-booking EXCLUDE constraint `appointments_no_double_booking`
 *     WHERE (status NOT IN ('cancelled','no_show'))
 *                                → database/migrations/0003_create_core_clinical.sql
 *                                  (and database/schema/03_core_clinical.sql)
 *
 * Conventions (mirror backend/shared): CommonJS, frozen object-literal exports,
 * zero runtime dependencies, zero side effects at import (no env reads, no I/O).
 */

/**
 * Appointment lifecycle status — mirror of the PostgreSQL `appointment_status` enum.
 * Keys are stable identifiers; values are the exact lowercase DB labels.
 */
const APPOINTMENT_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  CHECKED_IN: 'checked_in',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
});

/** All status values, in DB enum declaration order. */
const STATUS_VALUES = Object.freeze(Object.values(APPOINTMENT_STATUS));

/** The default status applied to a newly booked appointment (matches DB column DEFAULT). */
const DEFAULT_STATUS = APPOINTMENT_STATUS.SCHEDULED;

/**
 * Statuses that DO NOT occupy a doctor's calendar — the exact DB EXCLUDE
 * constraint's excluded set (`status NOT IN ('cancelled','no_show')`).
 */
const INACTIVE_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.CANCELLED,
  APPOINTMENT_STATUS.NO_SHOW,
]);

/**
 * Statuses that occupy a doctor's calendar (participate in overlap/conflict checks).
 * MUST equal STATUS_VALUES minus INACTIVE_STATUSES (lock-step with the DB EXCLUDE).
 */
const ACTIVE_STATUSES = Object.freeze(
  STATUS_VALUES.filter((s) => !INACTIVE_STATUSES.includes(s))
);

/* ----------------------------- Reminder queue / jobs ----------------------------- */

/** Single BullMQ queue name shared by queues/, workers/, schedulers/. */
const REMINDER_QUEUE_NAME = 'appointment-reminders';

/** BullMQ job name: send one reminder for a specific appointment + lead offset. */
const JOB_SEND_REMINDER = 'send-reminder';

/** BullMQ job name: repeatable scan that enqueues due reminders. */
const JOB_SCAN_REMINDERS = 'scan-reminders';

/**
 * Stable prefix for reminder idempotency keys / jobIds. The numeric lead offsets
 * themselves are env-tunable and live in serviceConfig; only the stable prefix +
 * key shape live here. Final shape: `hms:appt:reminder:<appointmentId>:<offset>`.
 */
const REMINDER_IDEMPOTENCY_PREFIX = 'hms:appt:reminder';

/**
 * Build the stable idempotency key / BullMQ jobId for a reminder.
 * Pure string composition — no side effects.
 * @param {string} appointmentId
 * @param {string|number} offset lead-time identifier from serviceConfig
 * @returns {string} e.g. "hms:appt:reminder:<appointmentId>:1440"
 */
function buildReminderIdempotencyKey(appointmentId, offset) {
  return `${REMINDER_IDEMPOTENCY_PREFIX}:${appointmentId}:${offset}`;
}

/* ----------------------------- Status transitions (data-only) ----------------------------- */

/**
 * Allowed status transitions for POST /appointments/:id/status.
 * DATA-ONLY allow-list — business enforcement lives in services/.
 * Terminal statuses map to an empty array.
 */
const STATUS_TRANSITIONS = Object.freeze({
  [APPOINTMENT_STATUS.SCHEDULED]: Object.freeze([
    APPOINTMENT_STATUS.CONFIRMED,
    APPOINTMENT_STATUS.CHECKED_IN,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ]),
  [APPOINTMENT_STATUS.CONFIRMED]: Object.freeze([
    APPOINTMENT_STATUS.CHECKED_IN,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ]),
  [APPOINTMENT_STATUS.CHECKED_IN]: Object.freeze([
    APPOINTMENT_STATUS.IN_PROGRESS,
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ]),
  [APPOINTMENT_STATUS.IN_PROGRESS]: Object.freeze([
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
  ]),
  [APPOINTMENT_STATUS.COMPLETED]: Object.freeze([]),
  [APPOINTMENT_STATUS.CANCELLED]: Object.freeze([]),
  [APPOINTMENT_STATUS.NO_SHOW]: Object.freeze([]),
});

/* ----------------------------- Pure helpers ----------------------------- */

/** @param {string} status @returns {boolean} true if a known appointment status. */
function isValidStatus(status) {
  return STATUS_VALUES.includes(status);
}

/** @param {string} status @returns {boolean} true if the status occupies the calendar. */
function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * @param {string} from current status
 * @param {string} to proposed next status
 * @returns {boolean} true if `from`→`to` is in the allow-list (data check only).
 */
function isValidStatusTransition(from, to) {
  const allowed = STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

module.exports = {
  APPOINTMENT_STATUS,
  STATUS_VALUES,
  DEFAULT_STATUS,
  ACTIVE_STATUSES,
  INACTIVE_STATUSES,
  REMINDER_QUEUE_NAME,
  JOB_SEND_REMINDER,
  JOB_SCAN_REMINDERS,
  REMINDER_IDEMPOTENCY_PREFIX,
  buildReminderIdempotencyKey,
  STATUS_TRANSITIONS,
  isValidStatus,
  isActiveStatus,
  isValidStatusTransition,
};
