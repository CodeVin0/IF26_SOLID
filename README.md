# Face & Name Quiz (React + TypeScript)

A local-photo quiz app using Vite. No user photo uploads are needed. Photo assets are included in the app at build time.

## 1. Put the photo folders here

Place the existing 14 group folders inside:

```text
src/
  assets/
    kelompok/
      1_Golang/
        Rizki.jpg
        Bima.heic
        Nisa.pdf
      2_Java/
        ...
      3_Python/
        ...
      ...
      14_<NamaKelompok>/
        ...
```

Folder format: `[group number]_[group name]` (for example `6_Swift`).

Each person should have one photo file, and the filename without its extension becomes the answer. For example, `Rizki_A.` is displayed as `Rizki A`.

Supported file extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.avif`, `.heic`, `.heif`, and `.pdf`. The app renders the **first page** of a PDF as the quiz image. HEIC/HEIF images are converted to JPEG in the browser for display.

## 2. Install and run

Use Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in your terminal.

To test the production build:

```bash
npm run build
npm run preview
```

## Quiz behavior

- Select one or more groups.
- Each selected photo becomes one question; the question order is shuffled across selected groups.
- Each question offers four names: the correct person plus three random members from the same group.
- Every photo in the selected groups is used once.
- A group must contain at least four photo files to provide four options for each member.
- The score and results are shown after the final question.

## Notes

- The app discovers files using Vite's `import.meta.glob`, so assets under `src/assets/kelompok` are included in the build. Keep the folder there (not outside the project).
- Add or remove files while the dev server is running; if Vite does not pick up a new file, restart `npm run dev`.
- Use one photo file per person. If the same person has multiple files with different extensions, each file will be treated as a separate quiz entry.
- This starter does not contain the real photos; copy your existing folders into `src/assets/kelompok`.
