// Use these lists across unit and integration tests.

export const IMAGE_FILENAMES: string[] = [
  'hello.png',
  'Hello-World.jpg',
  'mixed.Case.PNG',
  'screenshot-2025-09-18_21-03-47.jpeg',
  'multiple.dots.in.name.webp',
  'underscores_and-hyphens.gif',
  '12345.png',
  '(parentheses) & friends!.png',
  "rock'n'roll.png",
  'image with spaces.png',
  'image with spaces .png',
  'many   spaces   inside.jpg',
  'brackets[123].png',
  '#hash-at-start.png',
  'hash#in#middle.png',
  'percent%25.png',
  'dollar$-at@-caret^.png',
  'plus+equals=.png',
  'backtick`.png',
  'PHOTO.JPG',
  'animation.gif',
  'vector-illustration.svg',
  'IMG_1234.HEIC',
  'photo.TIFF',
  'Ελληνικά-δοκιμή.png',
  '中文-汉字-測試.png',
  '日本語-ひらがな-カタカナ.jpg',
  '한국어-테스트.png',
  'العربية-اختبار.png',
  'हिन्दी-परीक्षण.jpg',
  'ไทย-ทดสอบ.webp',
  'עברית-מבחן.png',
  'café.png',
  'cafe\u0301.png', // NFD variant: e + U+0301 combining (display as é)
  '😀-emoji.png',
  'family-👨‍👩‍👧‍👦.jpg',
  '.hidden-file.png',
  'nb\u00A0space.png', // includes non‑breaking space U+00A0
  'multi...dots.png'
];

export const NOTE_FILENAMES: string[] = [
  'Home.md',
  'Note with spaces.md',
  'many   spaces   note.md',
  '#hash-in-name.md',
  'brackets[page].md',
  "rock'n'roll.md",
  'café.md',
  'cafe\u0301.md', // NFD
  'Ελληνικά-δοκιμή.md',
  '中文-汉字-測試.md',
  '日本語のノート.md',
  '한국어-노트.md',
  'العربية-ملاحظة.md',
  '😀-emoji-note.md',
  '.hidden-note.md',
  '12345.md'
];

// These are invalid/reserved for Windows; use only in link-parsing tests, do not create on disk.
export const LINK_ONLY_INVALID: string[] = [
  'CON.png',
  'NUL.jpg',
  'AUX.svg',
  'LPT1.gif',
  'image?.png',
  'image*.jpg',
  'image:.png',
  'image|.webp',
  'quote".png',
  'trailing-space .png', // trailing space on base
  'trailingdot..png' // multiple trailing dots in base
];

export const PATH_CASES = {
  nested: [
    'Assets/image with spaces.png',
    '00 Inbox/中文-汉字-測試.png',
    'Assets & Media/(parentheses) & friends!.png',
    'αβγ/Ελληνικά-δοκιμή.png',
    'Emoji/😀-emoji.png',
  ],
  deep: [
    'Deep/Nested/路径/が/깊다/family-👨‍👩‍👧‍👦.jpg'
  ]
};