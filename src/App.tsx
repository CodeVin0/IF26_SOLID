import { useEffect, useMemo, useState } from "react";
import heic2any from "heic2any";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ASSET_ROOT = "/src/assets/kelompok/";
// Vite requires the glob pattern to be a literal string. These local assets are bundled
// into the app, so users do not need to upload their photos.
const importedAssets = import.meta.glob<string>(
  "/src/assets/kelompok/**/*.{jpg,jpeg,png,webp,gif,bmp,avif,heic,heif,pdf}", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface PersonPhoto {
  id: string;
  name: string;
  groupId: string;
  groupNumber: number;
  groupName: string;
  groupLabel: string;
  url: string;
  extension: string;
}

interface QuizQuestion {
  target: PersonPhoto;
  options: PersonPhoto[];
}

interface GroupInfo {
  id: string;
  number: number;
  name: string;
  label: string;
  members: PersonPhoto[];
}

const EXTENSION_RE = /\.([^.]+)$/;

function displayFileName(fileName: string): string {
  return fileName
    .replace(EXTENSION_RE, "")
    .replace(/[_]+/g, " ")
    .trim();
}

function loadPeople(): PersonPhoto[] {
  return Object.entries(importedAssets)
    .flatMap(([path, url]) => {
      const relativePath = path.startsWith(ASSET_ROOT)
        ? path.slice(ASSET_ROOT.length)
        : path.replace(/^.*?assets\/kelompok\//, "");
      const segments = relativePath.split("/");

      // Expected structure: kelompok/<number>_<group name>/<nickname>.<extension>
      if (segments.length !== 2) return [];

      const [folderName, fileName] = segments;
      const groupMatch = folderName.match(/^(\d+)_(.+)$/);
      if (!groupMatch) return [];

      const extensionMatch = fileName.match(EXTENSION_RE);
      if (!extensionMatch) return [];

      const extension = extensionMatch[1].toLowerCase();
      const groupNumber = Number(groupMatch[1]);
      const groupName = groupMatch[2].replace(/[_]+/g, " ").trim();
      const name = displayFileName(fileName);

      if (!name) return [];

      return [
        {
          id: `${folderName}/${fileName}`,
          name,
          groupId: folderName,
          groupNumber,
          groupName,
          groupLabel: `Kelompok: ${groupNumber} - ${groupName}`,
          url,
          extension,
        },
      ];
    })
    .sort((a, b) => {
      if (a.groupNumber !== b.groupNumber) return a.groupNumber - b.groupNumber;
      return a.name.localeCompare(b.name);
    });
}

const PEOPLE = loadPeople();

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildGroups(people: PersonPhoto[]): GroupInfo[] {
  const groupMap = new Map<string, GroupInfo>();

  for (const person of people) {
    if (!groupMap.has(person.groupId)) {
      groupMap.set(person.groupId, {
        id: person.groupId,
        number: person.groupNumber,
        name: person.groupName,
        label: person.groupLabel,
        members: [],
      });
    }
    groupMap.get(person.groupId)!.members.push(person);
  }

  return [...groupMap.values()].sort((a, b) => a.number - b.number);
}

const GROUPS = buildGroups(PEOPLE);

function buildQuestions(selectedGroupIds: string[]): QuizQuestion[] {
  const selectedPeople = PEOPLE.filter((person) =>
    selectedGroupIds.includes(person.groupId),
  );

  // Shuffle the entire list first, so group questions are mixed together.
  return shuffle(selectedPeople).map((target) => {
    // Distractors always come from the same group as the correct answer.
    const distractors = shuffle(
      PEOPLE.filter(
        (person) =>
          person.groupId === target.groupId && person.id !== target.id,
      ),
    ).slice(0, 3);

    return {
      target,
      options: shuffle([target, ...distractors]),
    };
  });
}

async function preparePhotoUrl(person: PersonPhoto): Promise<string> {
  if (person.extension !== "heic" && person.extension !== "heif" && person.extension !== "pdf") {
    return person.url;
  }

  const response = await fetch(person.url);
  if (!response.ok) {
    throw new Error(`Could not load ${person.name}.`);
  }
  const sourceBlob = await response.blob();

  if (person.extension === "heic" || person.extension === "heif") {
    const converted = await heic2any({
      blob: sourceBlob,
      toType: "image/jpeg",
      quality: 0.92,
    });
    const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
    if (!jpegBlob) throw new Error(`Could not convert ${person.name}.`);
    return URL.createObjectURL(jpegBlob);
  }

  // PDF support: render page 1 as the person's photo.
  const pdfDocument = await pdfjsLib.getDocument({
    data: await sourceBlob.arrayBuffer(),
  }).promise;
  try {
    const page = await pdfDocument.getPage(1);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot render the PDF.");

    // await page.render({ canvasContext: context, viewport }).promise;
    const renderedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PDF conversion failed."))),
        "image/jpeg",
        0.92,
      );
    });
    return URL.createObjectURL(renderedBlob);
  } finally {
    await pdfDocument.destroy();
  }
}

function PhotoView({ person }: { person: PersonPhoto }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let temporaryUrl: string | null = null;

    setImageUrl(null);
    setError(null);

    preparePhotoUrl(person)
      .then((url) => {
        if (cancelled) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          return;
        }
        if (url.startsWith("blob:")) temporaryUrl = url;
        setImageUrl(url);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Could not display this photo.");
      });

    return () => {
      cancelled = true;
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    };
  }, [person]);

  if (error) {
    return (
      <div className="photo-placeholder photo-error" role="alert">
        <span className="placeholder-icon">!</span>
        <strong>Photo could not be displayed</strong>
        <span>{error}</span>
        <small>Check that the file is valid and try again.</small>
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div className="photo-placeholder" aria-live="polite">
        <span className="spinner" />
        <span>Preparing photo…</span>
      </div>
    );
  }

  return <img className="face-photo" src={imageUrl} alt="Guess whose face this is" />;
}

export default function App() {
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [chosenOptionId, setChosenOptionId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const totalSelectedPeople = useMemo(
    () => PEOPLE.filter((person) => selectedGroups.includes(person.groupId)).length,
    [selectedGroups],
  );

  const currentQuestion = questions[questionIndex];
  const score = questions.reduce(
    (total, question, index) => total + (answers[index] === question.target.id ? 1 : 0),
    0,
  );

  function toggleGroup(groupId: string) {
    setErrorMessage("");
    setSelectedGroups((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  }

  function startQuiz() {
    setErrorMessage("");

    if (selectedGroups.length === 0) {
      setErrorMessage("Choose at least one group to start the quiz.");
      return;
    }

    const tooSmallGroups = GROUPS.filter(
      (group) => selectedGroups.includes(group.id) && group.members.length < 4,
    );
    if (tooSmallGroups.length > 0) {
      setErrorMessage(
        `Each selected group needs at least 4 photo files to make 4 answer options. Please add more photos to: ${tooSmallGroups
          .map((group) => group.label)
          .join(", ")}.`,
      );
      return;
    }

    const nextQuestions = buildQuestions(selectedGroups);
    if (nextQuestions.some((question) => question.options.length !== 4)) {
      setErrorMessage("Some groups do not have enough unique people for four options.");
      return;
    }

    setQuestions(nextQuestions);
    setQuestionIndex(0);
    setAnswers({});
    setChosenOptionId(null);
    setFinished(false);
  }

  function chooseAnswer(personId: string) {
    if (chosenOptionId !== null) return;
    setChosenOptionId(personId);
    setAnswers((current) => ({ ...current, [questionIndex]: personId }));
  }

  function goToNextQuestion() {
    if (!chosenOptionId) return;
    if (questionIndex + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setQuestionIndex((current) => current + 1);
    setChosenOptionId(null);
  }

  function returnToSetup() {
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({});
    setChosenOptionId(null);
    setFinished(false);
    setErrorMessage("");
  }

  if (PEOPLE.length === 0) {
    return (
      <main className="page-shell">
        <section className="setup-card empty-state">
          <span className="eyebrow">FACE & NAME QUIZ</span>
          <h1>No photos found yet</h1>
          <p>
            Add photos to <code>src/assets/kelompok/</code> using the folder format
            <code> 1_Golang/Rizki.jpg</code>, then restart the dev server.
          </p>
          <p className="muted">
            Supported formats: JPG, JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, HEIF, and PDF.
          </p>
        </section>
      </main>
    );
  }

  if (questions.length === 0) {
    return (
      <main className="page-shell">
        <header className="hero">
          <span className="eyebrow">BERSIAPLAH UNTUK MENAMBAH TEMAN BARU</span>
          <h1>Tebak Wajah <span>IF'26</span></h1>
          <p>Select the groups you want to practice. Every photo in your selected groups will appear once.</p>
        </header>

        <section className="setup-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">STEP 1</span>
              <h2>Pilih kelompok</h2>
            </div>
            <span className="count-pill">{selectedGroups.length} selected</span>
          </div>

          <div className="selection-actions">
            <button className="text-button" onClick={() => setSelectedGroups(GROUPS.map((group) => group.id))}>
              Select all
            </button>
            <span aria-hidden="true">·</span>
            <button className="text-button" onClick={() => setSelectedGroups([])}>
              Clear selection
            </button>
          </div>

          <div className="group-grid">
            {GROUPS.map((group) => {
              const checked = selectedGroups.includes(group.id);
              return (
                <label className={`group-option ${checked ? "is-selected" : ""}`} key={group.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleGroup(group.id)}
                  />
                  <span className="custom-checkbox" aria-hidden="true">✓</span>
                  <span className="group-copy">
                    <strong>{group.number} - {group.name}</strong>
                    <small>{group.members.length} photo{group.members.length === 1 ? "" : "s"}</small>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="quiz-summary">
            <div>
              <span className="summary-label">TOTAL QUESTIONS</span>
              <strong>{totalSelectedPeople}</strong>
            </div>
            <p>Four name options per question, with all answer choices taken from that person's group.</p>
          </div>

          {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}

          <button className="primary-button" onClick={startQuiz}>
            Start quiz <span aria-hidden="true">→</span>
          </button>
          <p className="footnote">Each selected group needs at least 4 photo files.</p>
        </section>
        <footer className="page-footer">Your practice session starts when you are ready.</footer>
      </main>
    );
  }

  if (finished) {
    const percentage = Math.round((score / questions.length) * 100);
    const wrong = questions.length - score;
    return (
      <main className="page-shell results-shell">
        <section className="results-card">
          <div className="result-medallion" aria-hidden="true">{percentage >= 80 ? "★" : percentage >= 50 ? "✓" : "↗"}</div>
          <span className="eyebrow">QUIZ COMPLETE</span>
          <h1>{percentage >= 80 ? "Excellent work!" : percentage >= 50 ? "Nice effort!" : "Keep practicing!"}</h1>
          <p className="result-intro">You've gone through every photo in your selected groups.</p>
          <div className="score-panel">
            <span className="summary-label">YOUR SCORE</span>
            <div className="score-number">{score}<span> / {questions.length}</span></div>
            <div className="score-track"><span style={{ width: `${percentage}%` }} /></div>
            <strong>{percentage}% correct</strong>
          </div>
          <div className="result-stats">
            <div><strong>{score}</strong><span>Correct</span></div>
            <div><strong>{wrong}</strong><span>Incorrect</span></div>
            <div><strong>{selectedGroups.length}</strong><span>Groups</span></div>
          </div>
          <button className="primary-button" onClick={startQuiz}>Try again <span aria-hidden="true">↻</span></button>
          <button className="secondary-button" onClick={returnToSetup}>Choose different groups</button>
        </section>
      </main>
    );
  }

  if (!currentQuestion) return null;
  const hasAnswered = chosenOptionId !== null;
  const isCorrect = chosenOptionId === currentQuestion.target.id;

  return (
    <main className="page-shell quiz-shell">
      <header className="quiz-topbar">
        <button className="back-button" onClick={returnToSetup} aria-label="Back to group selection">←</button>
        <div className="quiz-brand"><span className="brand-dot" /> Face & Name Quiz</div>
        <span className="question-counter">{questionIndex + 1} <span>/ {questions.length}</span></span>
      </header>

      <div className="progress-track" aria-label={`Question ${questionIndex + 1} of ${questions.length}`}>
        <span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} />
      </div>

      <section className="question-heading">
        <span className="eyebrow">WHO IS THIS PERSON?</span>
        <h1>Siapakah Orang Ini?</h1>
        <p>Choose the correct name from the four options below.</p>
      </section>

      <section className="question-card">
        <div className="group-label"><span className="group-label-dot" />{currentQuestion.target.groupLabel}</div>
        <div className="photo-frame">
          <PhotoView person={currentQuestion.target} />
        </div>

        <div className="answer-heading">
          <h2>Pilih jawaban</h2>
          <span>Pick one answer</span>
        </div>
        <div className="answer-grid">
          {currentQuestion.options.map((option, index) => {
            const isThisChoice = chosenOptionId === option.id;
            const isTarget = option.id === currentQuestion.target.id;
            let className = "answer-option";
            if (hasAnswered && isTarget) className += " answer-correct";
            else if (hasAnswered && isThisChoice && !isCorrect) className += " answer-wrong";
            else if (isThisChoice) className += " answer-picked";

            return (
              <button
                className={className}
                key={option.id}
                onClick={() => chooseAnswer(option.id)}
                disabled={hasAnswered}
              >
                <span className="option-letter">{String.fromCharCode(65 + index)}</span>
                <span className="option-name">{option.name}</span>
                {hasAnswered && isTarget && <span className="option-mark">✓</span>}
                {hasAnswered && isThisChoice && !isCorrect && <span className="option-mark">×</span>}
              </button>
            );
          })}
        </div>

        {hasAnswered && (
          <div className={`answer-feedback ${isCorrect ? "feedback-correct" : "feedback-wrong"}`} role="status">
            <strong>{isCorrect ? "Correct! Well done." : `Not quite — the answer is ${currentQuestion.target.name}.`}</strong>
            <span>{currentQuestion.target.groupLabel}</span>
          </div>
        )}

        <button className="primary-button next-button" disabled={!hasAnswered} onClick={goToNextQuestion}>
          {questionIndex + 1 === questions.length ? "See results" : "Lanjuttt"}
          <span aria-hidden="true">→</span>
        </button>
      </section>
      <footer className="quiz-footer">Every photo appears once. Questions are shuffled across your selected groups.</footer>
    </main>
  );
}
