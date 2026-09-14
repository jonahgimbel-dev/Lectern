# Lectern

Study desk for lectures. Record class, get a one-minute recap, flashcards, a practice quiz, and due dates — from Canvas or from what the professor said out loud.

Live app: [https://jolly-wolf-brave-charm.grok.me](https://jolly-wolf-brave-charm.grok.me)

## What it does

- **Record** a lecture (room mic or share tab audio), live captions, then file it to a class
- **Class hub** with lectures, syllabus, flashcards, practice quiz, exam cram, and a due-date calendar
- **Connect Canvas** without an API token — screenshot the dashboard, paste class names, or import the calendar feed
- **Accounts** (email, Google, X) so each student only sees their own empty desk until they add classes
- **Owner dashboard** (Jonah only): students, activity, invite codes, Stripe, restore leftover data

## Run it

```bash
npm install
npm run dev
```

Needs a Postgres-compatible database (`DATABASE_URL` / Neon) and `XAI_API_KEY` for transcription and recaps. Auth and Stripe keys are injected when you publish from Grok.

## Stack

TanStack Start, React 19, Tailwind, Better Auth, Neon/PGLite, Grok (STT + recap).
