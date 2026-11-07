# Riza Oyangorin Demo Seed (Review Only)

**Status:** DRAFT - NOT EXECUTED  
**Target:** Link 8 fictional cases to `profiles.id = 46b21e4e-59a1-4861-9ddb-3a4396cd656d` (Riza Oyangorin)  
**Safety:** Idempotent, clearly marked SAMPLE, does not modify existing `AB-2026-0037` or Riza's profile/auth.

## Requirements Covered
- 8 cases across Civil/Criminal/Administrative
- Urgency: Critical/High/Normal mix
- Notice of Hearing
- Pangkat/conciliation path
- Amicable Settlement (with/without CFA path considerations)
- CFA scenario (NOT auto-issued - must follow workflow rules)
- PNP referral scenario (NOT automatic for all Criminal/Critical)
- All marked `SAMPLE — FOR CAPSTONE DEMONSTRATION ONLY`
- Uses existing schema (no destructive changes)

## Files
- `scripts/seed_riza_demo_cases.js` - Node script using service role key from `.env` (same pattern as existing scripts)
- `scripts/seed_riza_demo_cases.sql` - SQL equivalent for review

## Execution (after approval)
```bash
node scripts/seed_riza_demo_cases.js
```

The script will:
1. Verify Riza exists (profile + resident_profile) - fail if not found
2. Check for existing SAMPLE cases for Riza (skip if exist)
3. Insert 8 complaints with fictional details
4. Create related records: hearings, summons, lupon_panels, pangkat_trackers, case_resolutions, pnp_referral_requests/complaint_referrals as appropriate
5. Log activity entries marking as demo data

## Notes
- Reference numbers will be generated as `AB-2026-9XXX` to avoid collision with existing `AB-2026-0037`
- `resident_id` set to Riza's profile ID
- `source` = `staff_assisted` or `resident_portal` (varied for demo)
- `filing_channel` set appropriately
- No existing complaints will be modified
- CFA will NOT be auto-issued; the CFA case will have `cfa_required` set per workflow rules only where appropriate
- PNP referral only for the designated Criminal case, not all Criminal/Critical
