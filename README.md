# DentVault

A cross-platform desktop dental patient management app for independent practitioners and small clinics. Built with Tauri 2, SvelteKit, Svelte 5, TypeScript, SQLite, and Tailwind CSS.

All data stays on your machine — no cloud, no subscriptions, no vendor lock-in. Your entire practice lives in a single folder you control.

---

> **IMPORTANT DISCLAIMER**
>
> **This software is not certified medical software. It is not a medical device and has not been evaluated, approved, or certified by any regulatory body (FDA, CE, MDR, or equivalent).**
>
> DentVault is provided strictly as an **organizational and record-keeping tool**, offered "as is" and at the user's own risk. The authors and contributors accept **no responsibility whatsoever** for:
>
> - Data loss, data corruption, or data breach
> - Any clinical, diagnostic, or treatment decisions made based on data stored in this application
> - Any harm to patients, practitioners, or third parties arising from the use of this software
> - Non-compliance with local healthcare data regulations (HIPAA, GDPR, DSGVO, or any other applicable law)
>
> **By using DentVault, you acknowledge that you are solely responsible for your data, your backups, and your compliance with all applicable laws and regulations in your jurisdiction.**
>
> If you require certified medical software, please use a product that has been formally evaluated and approved for clinical use.

---

## Features

- **Patient Management** — full patient records with demographics, medical history, emergency contacts, insurance, and clinical background
- **Clinical Timeline** — chronological treatment entries with rich text, treatment categories, outcomes, doctor attribution, and smart keyword detection
- **Dental Chart** — interactive SVG tooth chart with per-surface tagging, keyboard shortcuts, guided charting mode, bridge and prosthesis workflows
- **Periodontal Charting** — SVG bar-graph visualization with probing depths, recession, BOP, plaque, mobility, furcation, and comparison view
- **Treatment Plans** — multi-step plans with ordered procedures, progress tracking, and cost estimates
- **Documents & Attachments** — file management with configurable categories, thumbnails, and OS-native file opening
- **Appointment Scheduling** — day-view schedule with room columns, drag-to-create, schedule blocks, and staff absence tracking
- **Dashboard & Analytics** — period-based statistics, doctor activity, appointment analytics, time heatmap, and patient demographics
- **Dual Language** — full English and German support with instant switching
- **Fully Customizable** — document categories, clinical tags, staff roles, text blocks, complication types, entry types, dental chart appearance — all configurable from Settings
- **Template System** — define template files per document category that are automatically copied to every new patient
- **Audit Trail** — immutable append-only log of all data changes
- **Backup & Export** — one-click database backup, full vault backup, settings export/import

## Architecture

Everything lives in a single **Vault folder** the user picks during setup:

```
My DentVault/
  dentvault.db        ← SQLite database (all data + settings)
  audit.jsonl         ← audit trail
  !TEMPLATE/          ← files copied to every new patient
  Mustermann_Max_1/   ← per-patient document folders
    xrays/
    photos/
    documents/
    ...
```

**Full backup = copy the folder.** Restore = point DentVault at the backup.

## Development

Prerequisites: [Node.js](https://nodejs.org/) (v18+), [Rust](https://rustup.rs/), and platform-specific Tauri dependencies ([see Tauri docs](https://v2.tauri.app/start/prerequisites/)).

```sh
npm install
npm run tauri dev
```

Type checking:

```sh
npm run check
```

Production build:

```sh
npm run tauri build
```

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | SvelteKit + Svelte 5 |
| Language | TypeScript |
| Database | SQLite (via tauri-plugin-sql) |
| Styling | Tailwind CSS v4 + shadcn-svelte |
| Backend | Rust (Tauri commands) |

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

You are free to use, modify, and share this software for any **non-commercial** purpose. Commercial use — including selling, offering as a paid service, or incorporating into commercial products — is not permitted.

See the [LICENSE](LICENSE) file for the full text.
