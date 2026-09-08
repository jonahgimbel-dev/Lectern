# Lectern

Study desk for lectures. Record class, get a one-minute recap, flashcards, a practice quiz, and due dates — from Canvas or from what the professor said out loud.

Live app: [https://jolly-wolf-brave-charm.grok.me](https://jolly-wolf-brave-charm.grok.me)

## What it does

- **Record** a lecture (mic + live captions), then file it to a class
- **Class hub** with lectures, syllabus, flashcards, practice quiz, exam cram
- **Calendar** from Canvas feed, recordings, and dates you add
- **Connect Canvas** without an API token (calendar feed, paste roster, snapshot)
- **Accounts** (email, Google, X) so each student’s desk is saved
- **Owner usage** page for Jonah to see who’s using Lectern

## Run it

```bash
npm install
npm run dev
```

Needs a Postgres-compatible database (`DATABASE_URL` / Neon) and `XAI_API_KEY` for transcription and recaps. Auth and Stripe keys are injected when you publish from Grok.

## Stack

TanStack Start, React 19, Tailwind, Better Auth, Neon/PGLite, Grok (STT + recap).
