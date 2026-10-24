# AICTE Approval Validation Platform: frontend (prototype UI)

React + Vite. Static screens with sample data, converted from the design canvas.

## Run
    npm install
    npm run dev       # http://localhost:5173
    npm run build

## Roles
On `#/signup` pick College, AICTE officer or Administrator; the button then lands on that role's dashboard.

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
- Figures, names and quotes are placeholder sample data. Connect to your Node/Express API next.
- Suggested next steps: split repeated markup (stat cards, tables, pills) into components,
  add Recharts for the dashboard charts, add JWT login with role-based redirects.
