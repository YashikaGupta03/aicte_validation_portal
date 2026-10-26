# AICTE Approval Validation Platform: frontend

React + Vite frontend for the AICTE validation portal. Authentication and the college, officer,
and administrator workflows communicate with the Node/Express API.

## Run
    npm install
    npm run dev       # http://localhost:5173
    npm run build

For local development, the Vite dev server proxies `/api` requests to `http://localhost:4000`.
For a separately hosted frontend, set `VITE_API_URL` to the backend's public origin before building
(see `.env.example`). The backend must allow the frontend origin in `CORS_ORIGIN`.

## Roles
Use `#/signup` to sign in or create an account. The Student sign-in option uses the backend's
`college` role and college dashboard. College accounts may be activated automatically depending on
backend configuration. Officer and administrator accounts require administrator approval.
Officer signups are submitted as verification requests and remain unable to sign in until an
administrator approves them in the officer verification queue. Rejected requests are recorded and
cannot be used to sign in.

## Routes (hash routing)
- `#/`                  Landing page
- `#/signup`            Sign up
- `#/college`           College dashboard
- `#/new-application`   College: new application
- `#/officer`           AICTE officer dashboard
- `#/admin`             Administrator dashboard
- `#/pages`             Index of all screens

## Notes
- Styles live in `src/index.css` (plain CSS classes). Move to Tailwind or components as you grow.
- The college dashboard and application form, officer queue/review, and admin overview/users/sources/audit
  are API-backed. Landing-page marketing content remains illustrative.
