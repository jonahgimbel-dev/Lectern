export type TermCard = { term: string; definition: string };

export type Course = {
  id: string;
  name: string;
  code: string;
  term: string;
  instructor: string;
  accent: string;
  syllabus: string;
  masterSummary: string;
  lmsProvider: string | null;
  createdAt: string;
};

export type Lecture = {
  id: string;
  courseId: string;
  title: string;
  startedAt: number;
  durationSec: number;
  transcript: string;
  summary: string;
  outline: string[];
  terms: string[];
  actions: string[];
  examAsks: string[];
  traps: string[];
  source: string;
};

export type Flashcard = {
  id: string;
  courseId: string;
  lectureId: string | null;
  front: string;
  back: string;
  box: number;
  dueAt: string;
};

export type Exam = {
  id: string;
  courseId: string;
  title: string;
  examOn: string;
  notes: string;
  source?: string;
};

export type QuizItem = {
  prompt: string;
  choices: string[];
  answer: number;
  why: string;
};

export type CramSheet = {
  mustKnow: string[];
  traps: string[];
  drills: string[];
};

export type Desk = {
  courses: Course[];
  lectures: Lecture[];
  exams: Exam[];
  cards: Flashcard[];
};
