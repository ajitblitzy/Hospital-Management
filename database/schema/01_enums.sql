-- 01_enums.sql
-- Enumerated types for the HMS schema. Run after 00_extensions.sql.

-- Account lifecycle for users (and staff status reuse).
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'locked', 'pending');

-- Patient demographic.
CREATE TYPE gender AS ENUM ('male', 'female', 'other', 'unknown');

-- Appointment lifecycle.
CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show');

-- Inpatient admission lifecycle.
CREATE TYPE admission_status AS ENUM ('admitted', 'discharged', 'transferred', 'cancelled');

-- Laboratory report lifecycle.
CREATE TYPE lab_report_status AS ENUM ('ordered', 'sample_collected', 'in_progress', 'completed', 'cancelled');

-- Invoice lifecycle (billing integrity; guarded further by CHECK constraints in 04_billing.sql).
CREATE TYPE invoice_status AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'refunded');

-- Supported payment methods (doc 02: "Support for multiple payment methods").
CREATE TYPE payment_method AS ENUM ('cash', 'credit_card', 'debit_card', 'bank_transfer', 'insurance', 'online');

-- Payment transaction lifecycle.
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- Insurance claim lifecycle (doc 02: "Insurance claims management").
CREATE TYPE claim_status AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'partially_approved', 'rejected', 'paid');
