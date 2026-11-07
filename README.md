# Smart Complaint and Blotter Management System

Barangay Abuno complaint and blotter management application, built with Next.js, Supabase, and a local Python complaint classifier.

## Project layout

| Location | Purpose |
| --- | --- |
| `app/`, `components/`, `context/`, `hooks/` | Web app, pages, and UI |
| `lib/`, `repositories/`, `services/`, `types/`, `data/` | Shared logic, data access, and types |
| `public/`, `Files/`, `templates/` | Static assets and document templates |
| `supabase/` | Database scripts and edge functions |
| `ml-backend/` | Python classifier service and tests |
| `scripts/` | Development, verification, and template utilities |
| `docs/` | Setup guides, reports, data-flow and schema documentation |
| `FINALDATA.xlsx`, `NLP_Linear_SVM_Complaint_Classification.ipynb` | Source dataset and research notebook |

## Run locally

Install dependencies with `npm install`, configure the existing `.env` settings, then run `npm run dev`. The development script selects the local network interface for kiosk QR uploads and starts the local ML service when configured. See [kiosk setup](docs/KIOSK_LOCAL_HOTSPOT_SETUP.md), [Supabase setup](docs/SUPABASE_SETUP.md), and [ML setup](ml-backend/README.md) for the required configuration.

Use `npm run build` to check the production build. Other verification commands are listed in `package.json`.

## Production deployment

For the Vercel web app, separately hosted Python classifier, Supabase master
templates, kiosk uploads, and SMS scheduler prerequisites, see
[the deployment and staging checklist](docs/VERCEL_DEPLOYMENT.md).
