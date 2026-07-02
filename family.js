'use strict';
/*
 * Map phone numbers (E.164) -> family member names.
 * Real numbers are personal data — in production load these from env/secrets and
 * keep this file out of version control. These are fake demo numbers.
 */
const MEMBERS = {
  '+15551230001': 'Mom',
  '+15551230002': 'Dad',
  '+15551230003': 'Ellie',
};

module.exports = { MEMBERS };
