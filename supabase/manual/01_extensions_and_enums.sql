
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "pg_trgm" SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM (
      'resident',
      'captain',
      'staff',
      'police',
      'admin'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'complaint_status') THEN
    CREATE TYPE complaint_status AS ENUM (
      'Pending Review',
      'Received',
      'In Progress',
      'Awaiting Meeting',
      'Resolved',
      'Closed',
      'Rejected'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_category') THEN
    CREATE TYPE case_category AS ENUM (
      'Criminal',
      'Civil',
      'Administrative'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'urgency_level') THEN
    CREATE TYPE urgency_level AS ENUM (
      'Critical',
      'High',
      'Normal'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
    CREATE TYPE account_status AS ENUM (
      'pending',
      'active',
      'suspended',
      'disabled'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kp_phase_type') THEN
    CREATE TYPE kp_phase_type AS ENUM (
      'Assessment',
      'Mediation',
      'Conciliation',
      'Conciliation Extension',
      'Completed',
      'Not Applicable'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kp_phase_status') THEN
    CREATE TYPE kp_phase_status AS ENUM (
      'Not Started',
      'Active',
      'Due Soon',
      'Settled',
      'Completed Without Settlement',
      'Period Elapsed',
      'Extended',
      'Completed'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hearing_status') THEN
    CREATE TYPE hearing_status AS ENUM (
      'Upcoming',
      'Completed',
      'Rescheduled',
      'Cancelled'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inquiry_status') THEN
    CREATE TYPE inquiry_status AS ENUM (
      'Open',
      'Responded',
      'Closed'
    );
  END IF;
END
$$;
