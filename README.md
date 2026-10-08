# ÀRKIECO — full-stack architecture company portal

ÀRKIECO is a private architecture client-portal foundation: public company website → secure login → project workspace → documents/revisions → approvals → project chat → invoices/payments → Manager control center.

## What was added in this version

### Client Project Workspace
- Project-specific overview with status, budget, client/team and progress.
- **Milestones:** Consultation → Concept → Preliminary Design → 3D Visualization → Working Drawings → Final Delivery.
- **Drawings & Deliverables:** real file upload support up to 20 MB per file, revision number, category and status.
- **Document approvals:** client can **Approve** or **Request Changes**, with a comment and approval history.
- **Project chat:** conversations remain attached to a project.
- **Invoices:** invoice number, amount, due date and status inside the project workspace.

### Manager Control Center
- Create projects.
- Assign clients and team members.
- Update project status and progress.
- Add/update milestones.
- Upload deliverables.
- Create invoices.
- Confirm client payments.
- Record team payouts.
- Manage team accounts.
- View all company projects.

### Security / access model
- Passwords are hashed with bcrypt.
- Sessions use an HTTP-only JWT cookie.
- Clients only receive projects where they are the assigned client.
- Team members only receive projects assigned to them.
- Project chat, files, workspace data and document approvals are checked against project access.
- The Manager role is reserved for the configured Manager account.

## Database

PostgreSQL stores users, projects, messages, payments, payouts, milestones, deliverables, approval history and invoices. Database tables are created automatically on startup, including migration-safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for uploaded-file metadata.

## Run locally

1. Copy `.env.example` to `.env`.
2. Put a real PostgreSQL `DATABASE_URL` in `.env`.
3. Set a strong `JWT_SECRET` and `MANAGER_PASSWORD`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Payments

The portal supports Vodafone Cash and InstaPay as payment-record workflows. The client submits the amount/method/reference and the Manager confirms it. The existing Paymob intention endpoint remains available for a verified live merchant integration; credentials stay server-side.

## Production notes

This ZIP is a stronger working application foundation, not a claim that production infrastructure is already configured. Before public launch, add a managed PostgreSQL database, HTTPS, object storage/CDN for larger project files, automated backups, email/password-reset delivery, rate limiting, CSRF protection where applicable, audit logs, payment-provider webhooks, monitoring and legal/business verification.
